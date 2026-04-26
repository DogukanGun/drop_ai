"""DropAI plugin: run Python code against a real Chrome session via the
`browser-harness` CLI (Chrome DevTools Protocol over a Unix socket).

Setup:
  1. Launch Chrome with `--remote-debugging-port=9222`, then in chrome://inspect
     enable "Allow access".
  2. Install the harness CLI globally so it's on PATH:
       uv tool install browser-harness
     or `pip install browser-harness` into the orchestrator's environment.

Config:
  code     — Python code string. Helpers from the harness (goto_url, page_info,
             click_at_xy, type_text, js, ...) are pre-imported.
  name     — daemon name (BU_NAME); allows multiple isolated sessions.
  timeout  — seconds before killing the subprocess.

Output: { stdout, stderr, exitCode }
"""

from __future__ import annotations

import os
import shutil
import subprocess


def run(ctx, config, msg):
	code = (config.get("code") or "").strip()
	if not code and isinstance(msg, str):
		code = msg.strip()
	if not code:
		raise ValueError("browser-harness node needs non-empty 'code' (config or input)")

	name = str(config.get("name") or "default")
	timeout = float(config.get("timeout") or 30)

	ctx.emit("start", payload={"name": name, "codeBytes": len(code)})

	cli = shutil.which("browser-harness")
	if cli is None:
		raise RuntimeError(
			"browser-harness CLI not found on PATH. Install it with "
			"`uv tool install browser-harness` (or `pip install browser-harness`) "
			"and ensure Chrome is running with --remote-debugging-port=9222."
		)

	env = os.environ.copy()
	env["BU_NAME"] = name

	ctx.emit("progress", payload={"phase": "spawning", "cli": cli})

	try:
		proc = subprocess.run(
			[cli, "-c", code],
			capture_output=True,
			text=True,
			timeout=timeout,
			env=env,
			check=False,
		)
	except subprocess.TimeoutExpired as e:
		raise RuntimeError(f"browser-harness timed out after {timeout}s") from e

	if proc.returncode != 0:
		raise RuntimeError(
			f"browser-harness exited {proc.returncode}\n"
			f"stderr:\n{proc.stderr.strip()[:1000]}\n"
			f"stdout:\n{proc.stdout.strip()[:1000]}"
		)

	ctx.emit("output", payload={
		"exitCode": 0,
		"stdoutPreview": proc.stdout[:500],
	})
	ctx.emit("end")
	return {"stdout": proc.stdout, "stderr": proc.stderr, "exitCode": proc.returncode}
