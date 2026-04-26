"""Subprocess bridge for running DropAI plugins written in Python.

Protocol (matches apps/orchestrator/src/runtime/pythonBridge.ts):

  STDIN: a single JSON line with the job spec, then EOF:
    {
      "entry": "module:function",
      "pluginRoot": "/abs/path/to/plugin",
      "runId": "...",
      "nodeId": "...",
      "config": {...},
      "msg": <any>
    }

  STDOUT: newline-delimited JSON messages, one of:
    {"kind": "event", "event": {"kind": "start|progress|output|error|end", "channel": "...?", "payload": ...?}}
    {"kind": "log",   "level": "debug|info|warn|error", "message": "...", "meta": ...?}
    {"kind": "result", "result": <any>}      # exactly once on success
    {"kind": "error",  "message": "...", "traceback": "..."}

  Exit code: 0 on success, 1 on error.

The plugin's run() can be sync or async. ctx.emit() forwards an AgentEvent.
"""

import asyncio
import importlib
import inspect
import json
import sys
import traceback
from pathlib import Path


def _send(obj: dict) -> None:
	sys.stdout.write(json.dumps(obj, default=str) + "\n")
	sys.stdout.flush()


class Ctx:
	def __init__(self, run_id: str, node_id: str) -> None:
		self.run_id = run_id
		self.node_id = node_id
		self._aborted = False

	def emit(self, kind: str, payload=None, channel: str | None = None) -> None:
		event: dict = {"kind": kind}
		if channel is not None:
			event["channel"] = channel
		if payload is not None:
			event["payload"] = payload
		_send({"kind": "event", "event": event})

	def log(self, level: str, message: str, meta=None) -> None:
		entry: dict = {"kind": "log", "level": level, "message": message}
		if meta is not None:
			entry["meta"] = meta
		_send(entry)

	@property
	def aborted(self) -> bool:
		return self._aborted

	def _abort(self) -> None:
		self._aborted = True


async def _run() -> int:
	raw = sys.stdin.readline()
	if not raw:
		_send({"kind": "error", "message": "no job spec on stdin"})
		return 1

	try:
		spec = json.loads(raw)
	except json.JSONDecodeError as e:
		_send({"kind": "error", "message": f"bad job spec JSON: {e}"})
		return 1

	entry = spec.get("entry") or ""
	plugin_root = spec.get("pluginRoot")
	if plugin_root:
		root = str(Path(plugin_root).resolve())
		if root not in sys.path:
			sys.path.insert(0, root)

	if ":" not in entry:
		_send({
			"kind": "error",
			"message": f"entry must be 'module:function', got {entry!r}",
		})
		return 1
	module_name, fn_name = entry.split(":", 1)

	try:
		module = importlib.import_module(module_name)
	except Exception as e:
		_send({
			"kind": "error",
			"message": f"failed to import {module_name}: {e}",
			"traceback": traceback.format_exc(),
		})
		return 1

	fn = getattr(module, fn_name, None)
	if fn is None or not callable(fn):
		_send({
			"kind": "error",
			"message": f"module {module_name} has no callable {fn_name}",
		})
		return 1

	ctx = Ctx(spec.get("runId", ""), spec.get("nodeId", ""))

	try:
		result = fn(ctx, spec.get("config", {}), spec.get("msg"))
		if inspect.iscoroutine(result):
			result = await result
		_send({"kind": "result", "result": result})
		return 0
	except Exception as e:
		_send({
			"kind": "error",
			"message": str(e),
			"traceback": traceback.format_exc(),
		})
		return 1


def main() -> None:
	exit_code = asyncio.run(_run())
	sys.exit(exit_code)


if __name__ == "__main__":
	main()
