"""DropAI plugin: drives an LLM-powered browser agent (`browser-use` package).

Required environment:
  OPENAI_API_KEY              if model name starts with gpt-/o
  ANTHROPIC_API_KEY           if model name starts with claude-

Setup (one-time, in this plugin directory):
  uv venv
  uv pip install -r requirements.txt

Per-step events stream live via the bridge so the visualizer pulses on every
browser action.
"""

from __future__ import annotations

import asyncio
import os


async def run(ctx, config, msg):
	task = (config.get("task") or "").strip()
	if not task and isinstance(msg, str):
		task = msg.strip()
	if not task:
		raise ValueError("browser-use node needs a non-empty 'task' (config or string input)")

	max_steps = int(config.get("maxSteps") or 20)
	model_name = str(config.get("model") or "gpt-4o-mini")
	headless = bool(config.get("headless", False))

	ctx.emit("start", payload={"task": task, "model": model_name, "maxSteps": max_steps})

	llm = _build_llm(model_name)

	# Lazy import so the plugin can be registered even before its venv is created;
	# we want the error to surface at run time, not registry load time.
	from browser_use import Agent, Browser

	browser = Browser(headless=headless)
	agent = Agent(task=task, llm=llm, browser=browser)

	def on_step(state, output, step_n: int) -> None:
		# state: BrowserStateSummary  output: AgentOutput  step_n: int (1-indexed)
		actions = []
		try:
			for a in (output.action or []):
				dumped = a.model_dump(exclude_none=True) if hasattr(a, "model_dump") else dict(a)
				# action models are { name: {...params} } — flatten
				if isinstance(dumped, dict) and len(dumped) == 1:
					name, params = next(iter(dumped.items()))
					actions.append({"name": name, "params": params})
				else:
					actions.append(dumped)
		except Exception:
			pass

		ctx.emit("progress", payload={
			"step": step_n,
			"url": getattr(state, "url", None),
			"title": getattr(state, "title", None),
			"thinking": getattr(output, "thinking", None),
			"next_goal": getattr(output, "next_goal", None),
			"actions": actions,
		})

	try:
		# Plumb the callback into Agent — the API accepts it via kwarg in __init__,
		# but versions may differ; prefer setattr after construction for robustness.
		try:
			agent.register_new_step_callback = on_step  # type: ignore[attr-defined]
		except Exception:
			pass

		history = await agent.run(max_steps=max_steps)
		final_text = _extract_final_text(history)
		ctx.emit("output", payload={"finalText": final_text, "steps": _history_summary(history)})
		ctx.emit("end")
		return {"finalText": final_text}
	finally:
		# Best-effort cleanup
		close = getattr(browser, "close", None)
		if close is not None:
			try:
				maybe = close()
				if asyncio.iscoroutine(maybe):
					await maybe
			except Exception:
				pass


def _build_llm(model: str):
	# OpenAI is the most common path; route by prefix.
	low = model.lower()
	if low.startswith("claude") or low.startswith("anthropic"):
		from browser_use.llm import ChatAnthropic
		_require_env("ANTHROPIC_API_KEY")
		return ChatAnthropic(model=model)
	# default: OpenAI / OpenAI-compatible
	from browser_use.llm import ChatOpenAI
	_require_env("OPENAI_API_KEY")
	return ChatOpenAI(model=model)


def _require_env(name: str) -> None:
	if not os.environ.get(name):
		raise RuntimeError(
			f"{name} is not set. Export it in the orchestrator's environment before running."
		)


def _history_summary(history) -> list[dict]:
	out: list[dict] = []
	try:
		for item in getattr(history, "history", []) or []:
			out.append({
				"url": getattr(getattr(item, "state", None), "url", None),
				"actions": _action_names(item),
			})
	except Exception:
		pass
	return out


def _action_names(item) -> list[str]:
	model_output = getattr(item, "model_output", None)
	if model_output is None:
		return []
	names: list[str] = []
	for a in getattr(model_output, "action", []) or []:
		try:
			d = a.model_dump(exclude_none=True) if hasattr(a, "model_dump") else dict(a)
			if isinstance(d, dict) and d:
				names.append(next(iter(d.keys())))
		except Exception:
			pass
	return names


def _extract_final_text(history) -> str:
	# Common API: history.final_result() returns the agent's final answer string,
	# or the last action's "done" text.
	for attr in ("final_result", "final_text", "final_output"):
		fn = getattr(history, attr, None)
		if callable(fn):
			try:
				v = fn()
				if v:
					return str(v)
			except Exception:
				pass
	# Fall back to scanning history for a "done" action's text.
	try:
		for item in reversed(getattr(history, "history", []) or []):
			model_output = getattr(item, "model_output", None)
			if model_output is None:
				continue
			for a in getattr(model_output, "action", []) or []:
				d = a.model_dump(exclude_none=True) if hasattr(a, "model_dump") else dict(a)
				if isinstance(d, dict) and "done" in d:
					done = d["done"]
					if isinstance(done, dict):
						text = done.get("text") or done.get("answer") or ""
						if text:
							return str(text)
	except Exception:
		pass
	return ""
