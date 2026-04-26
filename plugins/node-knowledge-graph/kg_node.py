"""DropAI plugin: extract a knowledge graph from text.

Pipeline:
  1. Split the input into overlapping word windows.
  2. For each window, ask the LLM to return SPO triples as JSON.
  3. Normalize and deduplicate entities/predicates.
  4. Render an interactive HTML visualization with PyVis.

Inputs (from config or upstream message):
  text       — source document
  model      — LLM model name (default "gpt-4o-mini")
  baseUrl    — OpenAI-compatible endpoint (default OpenAI public API)
  chunkSize  — words per window
  overlap    — words shared between consecutive windows
  temperature, maxTokens — LLM sampling parameters

Required env: OPENAI_API_KEY
Output: { triples: [...], totalTriples: int, artifactUrl: "/api/artifacts/<run>/<node>/graph.html" }
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class Triple:
	subject: str
	predicate: str
	obj: str

	def to_dict(self) -> dict:
		return {"subject": self.subject, "predicate": self.predicate, "object": self.obj}


SYSTEM_PROMPT = (
	"You are a structured information extractor. From the user's passage, extract the core "
	"factual relationships as subject-predicate-object triples.\n"
	"Rules:\n"
	"- subject and object: short canonical noun phrases, lowercased, no articles\n"
	"- predicate: 1-3 lowercase words, no auxiliary verbs (use 'founded' not 'has founded')\n"
	"- skip vague triples (e.g. subject 'it', predicate 'is')\n"
	"- if no clear triples are present, return an empty array\n"
	'Output ONLY a JSON array like [{"subject":"...","predicate":"...","object":"..."}], no prose.'
)


def run(ctx, config, msg):
	text = (config.get("text") or "").strip()
	if not text and isinstance(msg, str):
		text = msg.strip()
	if not text:
		raise ValueError("knowledge-graph node needs non-empty 'text' (config or input)")

	model = str(config.get("model") or "gpt-4o-mini")
	base_url = str(config.get("baseUrl") or "https://api.openai.com/v1")
	chunk_size = max(40, int(config.get("chunkSize") or 200))
	overlap = max(0, int(config.get("overlap") or 40))
	temperature = float(config.get("temperature") or 0.2)
	max_tokens = int(config.get("maxTokens") or 1024)

	ctx.emit("start", payload={"chars": len(text), "model": model})

	api_key = os.environ.get("OPENAI_API_KEY")
	if not api_key:
		raise RuntimeError("OPENAI_API_KEY is not set in the orchestrator environment")

	from openai import OpenAI

	client = OpenAI(api_key=api_key, base_url=base_url)

	chunks = list(_chunk_words(text, chunk_size, overlap))
	ctx.emit("progress", payload={"phase": "chunking", "chunks": len(chunks)})

	all_triples: list[Triple] = []
	for i, chunk in enumerate(chunks, start=1):
		ctx.emit("progress", payload={"phase": "extracting", "chunk": i, "of": len(chunks)})
		try:
			triples = _extract_chunk(client, model, chunk, temperature, max_tokens)
		except Exception as e:
			ctx.emit("progress", payload={"phase": "extract-error", "chunk": i, "error": str(e)})
			continue
		all_triples.extend(triples)

	deduped = _dedupe(all_triples)

	artifact_dir = _artifact_dir()
	out_html = artifact_dir / "graph.html"
	_render_pyvis(deduped, out_html)

	rel_url = _artifact_url("graph.html")
	preview = [t.to_dict() for t in deduped[:50]]

	ctx.emit("output", payload={"triples": preview, "totalTriples": len(deduped), "artifactUrl": rel_url})
	ctx.emit("end")
	return {"triples": [t.to_dict() for t in deduped], "totalTriples": len(deduped), "artifactUrl": rel_url}


def _chunk_words(text: str, size: int, overlap: int) -> Iterable[str]:
	words = re.findall(r"\S+", text)
	if not words:
		return
	step = max(1, size - overlap)
	for start in range(0, len(words), step):
		window = words[start : start + size]
		if not window:
			break
		yield " ".join(window)
		if start + size >= len(words):
			break


def _extract_chunk(client, model: str, chunk: str, temperature: float, max_tokens: int) -> list[Triple]:
	resp = client.chat.completions.create(
		model=model,
		messages=[
			{"role": "system", "content": SYSTEM_PROMPT},
			{"role": "user", "content": f"Passage:\n\n{chunk}\n\nReturn the JSON array now."},
		],
		temperature=temperature,
		max_tokens=max_tokens,
		response_format={"type": "json_object"} if _supports_json_mode(model) else None,  # type: ignore[arg-type]
	)
	content = (resp.choices[0].message.content or "").strip()
	return list(_parse_triples(content))


def _supports_json_mode(model: str) -> bool:
	# OpenAI's response_format requires the prompt to mention "json"; ours does
	# implicitly via the system instruction. Some compatible providers don't
	# accept this kwarg, so default off and only enable for known-good models.
	low = model.lower()
	return low.startswith("gpt-4") or low.startswith("gpt-3.5") or low.startswith("o1") or low.startswith("o3")


def _parse_triples(raw: str) -> Iterable[Triple]:
	body = _strip_code_fence(raw)
	# Accept either a top-level array, or a {"triples": [...]} envelope (json_object mode).
	try:
		parsed = json.loads(body)
	except json.JSONDecodeError:
		# Try to salvage the first JSON array in the text.
		m = re.search(r"\[\s*\{.*?\}\s*\]", body, re.DOTALL)
		if not m:
			return
		try:
			parsed = json.loads(m.group(0))
		except json.JSONDecodeError:
			return

	items: list = parsed if isinstance(parsed, list) else parsed.get("triples", []) if isinstance(parsed, dict) else []
	for item in items:
		if not isinstance(item, dict):
			continue
		s = _norm(item.get("subject"))
		p = _norm(item.get("predicate"))
		o = _norm(item.get("object"))
		if not (s and p and o):
			continue
		if s == o:
			continue
		yield Triple(s, p, o)


def _strip_code_fence(s: str) -> str:
	s = s.strip()
	if s.startswith("```"):
		s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
		s = re.sub(r"\n?```\s*$", "", s)
	return s.strip()


def _norm(v) -> str:
	if v is None:
		return ""
	s = str(v).strip().lower()
	# collapse whitespace, drop leading articles
	s = re.sub(r"\s+", " ", s)
	s = re.sub(r"^(a |an |the )", "", s)
	return s.strip(" .,:;'\"")


def _dedupe(triples: list[Triple]) -> list[Triple]:
	seen: set[tuple[str, str, str]] = set()
	out: list[Triple] = []
	for t in triples:
		key = (t.subject, t.predicate, t.obj)
		if key in seen:
			continue
		seen.add(key)
		out.append(t)
	return out


def _render_pyvis(triples: list[Triple], out_html: Path) -> None:
	from pyvis.network import Network

	net = Network(
		height="100%",
		width="100%",
		bgcolor="#0b0f17",
		font_color="#d8dde7",
		directed=True,
		notebook=False,
		cdn_resources="remote",
	)
	net.barnes_hut(spring_length=160, spring_strength=0.04, damping=0.5)

	# Color nodes by their connection count so high-degree entities stand out.
	degree: dict[str, int] = {}
	for t in triples:
		degree[t.subject] = degree.get(t.subject, 0) + 1
		degree[t.obj] = degree.get(t.obj, 0) + 1

	added: set[str] = set()
	for entity, deg in degree.items():
		size = 16 + min(40, deg * 4)
		net.add_node(entity, label=entity, value=deg, size=size, color=_node_color(deg))
		added.add(entity)

	for t in triples:
		if t.subject not in added or t.obj not in added:
			continue
		net.add_edge(t.subject, t.obj, title=t.predicate, label=t.predicate, color="#6aa6ff")

	out_html.parent.mkdir(parents=True, exist_ok=True)
	net.write_html(str(out_html), notebook=False, open_browser=False)


def _node_color(deg: int) -> str:
	# Cool palette ramping from blue to violet to gold as degree grows.
	if deg >= 6:
		return "#ffb454"
	if deg >= 3:
		return "#b07bff"
	return "#6aa6ff"


def _artifact_dir() -> Path:
	root = os.environ.get("DROPAI_ARTIFACTS_DIR")
	if not root:
		raise RuntimeError("DROPAI_ARTIFACTS_DIR not set; bridge should provide it")
	node_id = os.environ.get("DROPAI_NODE_ID", "kg")
	d = Path(root) / node_id
	d.mkdir(parents=True, exist_ok=True)
	return d


def _artifact_url(filename: str) -> str:
	run_id = os.environ.get("DROPAI_RUN_ID", "")
	node_id = os.environ.get("DROPAI_NODE_ID", "kg")
	return f"/api/artifacts/{run_id}/{node_id}/{filename}"
