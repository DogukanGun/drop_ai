"""Trivial Python plugin used to verify the python-runner bridge end-to-end."""

import asyncio


async def run(ctx, config, msg):
	prefix = str(config.get("prefix", ""))
	ctx.emit("start", payload={"prefix": prefix})
	for i in range(3):
		await asyncio.sleep(0.1)
		ctx.emit("progress", payload={"i": i})
	out = f"{prefix}{msg if msg is not None else ''}"
	ctx.emit("output", payload=out)
	ctx.emit("end")
	return out
