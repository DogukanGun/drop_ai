"""DropAI plugin: drives a hosted maestro instance over its REST API.

Setup (one-time):
  1. Run a maestro server separately (its own docker compose / install).
  2. Set MAESTRO_USERNAME / MAESTRO_PASSWORD in env (or DROPAI_MAESTRO_TOKEN).
  3. Point baseUrl at the running instance.

Behaviour:
  Creates a chat → posts the task → polls for the resulting research mission
  to complete, emitting a `progress` event each time its status field changes.
  Returns the final report markdown when done.

Maestro is treated as an external service; we only call its public HTTP API.
"""

from __future__ import annotations

import asyncio
import os


async def run(ctx, config, msg):
	task = (config.get("task") or "").strip()
	if not task and isinstance(msg, str):
		task = msg.strip()
	if not task:
		raise ValueError("maestro node needs non-empty 'task' (config or string input)")

	base_url = str(config.get("baseUrl") or "http://localhost:8000").rstrip("/")
	poll_interval = float(config.get("pollInterval") or 5)
	max_wait = float(config.get("maxWaitSeconds") or 1800)

	ctx.emit("start", payload={"task": task, "baseUrl": base_url})

	# Lazy import so the plugin can register without httpx installed yet.
	import httpx

	async with httpx.AsyncClient(base_url=base_url, timeout=60) as http:
		token = await _login(http)

		headers = {"Authorization": f"Bearer {token}"} if token else {}

		# 1. Create a chat.
		chat = (await http.post("/api/chats", json={"name": "DropAI run"}, headers=headers)).json()
		chat_id = chat.get("id") or chat.get("chat_id")
		ctx.emit("progress", payload={"phase": "chat-created", "chatId": chat_id})

		# 2. Send the task message.
		await http.post(
			f"/api/chats/{chat_id}/messages",
			json={"content": task, "use_web_search": True},
			headers=headers,
		)
		ctx.emit("progress", payload={"phase": "task-submitted"})

		# 3. Poll until a mission appears and reaches a terminal state.
		deadline = asyncio.get_event_loop().time() + max_wait
		seen_status: str | None = None
		mission_id: str | None = None
		report: str = ""

		while True:
			if asyncio.get_event_loop().time() > deadline:
				raise RuntimeError(f"maestro mission did not finish within {max_wait}s")

			missions = (await http.get(f"/api/chats/{chat_id}/missions", headers=headers)).json()
			items = missions if isinstance(missions, list) else missions.get("items", [])
			if items:
				mission = items[-1]
				mission_id = mission.get("id")
				status = mission.get("status")
				if status != seen_status:
					seen_status = status
					ctx.emit("progress", payload={"phase": "mission", "missionId": mission_id, "status": status})
				if status in {"completed", "succeeded", "done"}:
					report = mission.get("final_report") or mission.get("report") or ""
					break
				if status in {"failed", "error", "cancelled"}:
					raise RuntimeError(f"maestro mission ended with status={status}")

			await asyncio.sleep(poll_interval)

		# 4. Final report.
		if not report and mission_id:
			detail = (await http.get(f"/api/missions/{mission_id}", headers=headers)).json()
			report = detail.get("final_report") or detail.get("report") or ""

	ctx.emit("output", payload={"reportMd": report[:4000], "missionId": mission_id})
	ctx.emit("end")
	return {"reportMd": report, "missionId": mission_id}


async def _login(http) -> str | None:
	# Token short-circuits username/password.
	token = os.environ.get("DROPAI_MAESTRO_TOKEN")
	if token:
		return token

	user = os.environ.get("MAESTRO_USERNAME")
	pw = os.environ.get("MAESTRO_PASSWORD")
	if not user or not pw:
		return None

	resp = await http.post("/api/auth/login", json={"username": user, "password": pw})
	resp.raise_for_status()
	body = resp.json()
	return body.get("access_token") or body.get("token")
