#!/usr/bin/env python3
import argparse
import hashlib
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import normalize  # noqa: E402


def make_key(item):
    if item.get("doi"):
        return "doi:" + normalize(item["doi"])
    if item.get("pmid"):
        return "pmid:" + normalize(item["pmid"])
    if item.get("id") and item.get("source") == "arxiv":
        return "arxiv:" + normalize(item["id"])
    title_key = normalize(item.get("title", ""))
    if title_key:
        return "title:" + hashlib.md5(title_key.encode("utf-8")).hexdigest()
    return "fallback:" + hashlib.md5(json.dumps(item, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def choose_better(existing, candidate):
    source_priority = {"pubmed": 3, "arxiv": 2}
    existing_p = source_priority.get(existing.get("source"), 0)
    candidate_p = source_priority.get(candidate.get("source"), 0)
    if candidate_p > existing_p:
        base, other = candidate.copy(), existing
    else:
        base, other = existing.copy(), candidate

    for field in ["doi", "pmid", "pdf_url", "journal", "summary", "url", "published", "updated"]:
        if not base.get(field) and other.get(field):
            base[field] = other[field]
    if len(base.get("authors", [])) < len(other.get("authors", [])):
        base["authors"] = other.get("authors", [])
    base_sources = []
    for value in [existing.get("source"), candidate.get("source")]:
        if value and value not in base_sources:
            base_sources.append(value)
    base["sources"] = base_sources
    if len(base_sources) > 1:
        base["source_label"] = "+".join(s.capitalize() for s in base_sources)
    return base


def main():
    parser = argparse.ArgumentParser(description="Merge multi-source paper results and deduplicate.")
    parser.add_argument("inputs", nargs="+", help="Input JSON files")
    parser.add_argument("--output", help="Write merged JSON to this file")
    parser.add_argument("--pubmed-weight", type=float, default=1.25)
    parser.add_argument("--arxiv-weight", type=float, default=1.0)
    args = parser.parse_args()

    merged = {}
    queries = []
    generated_at = []
    source_counts = {}

    for path_str in args.inputs:
        payload = json.loads(Path(path_str).read_text(encoding="utf-8-sig"))
        query = payload.get("query")
        if query:
            queries.append(query)
        if payload.get("generated_at"):
            generated_at.append(payload["generated_at"])
        for item in payload.get("items", []):
            key = make_key(item)
            if key in merged:
                merged[key] = choose_better(merged[key], item)
            else:
                merged[key] = item
            src = item.get("source", "unknown")
            source_counts[src] = source_counts.get(src, 0) + 1

    items = []
    for item in merged.values():
        source = item.get("source")
        weight = args.pubmed_weight if source == "pubmed" else args.arxiv_weight if source == "arxiv" else 1.0
        item["weighted_score"] = round(item.get("relevance_score", item.get("keyword_score", 0)) * weight, 3)
        item["source_weight"] = weight
        items.append(item)

    items.sort(key=lambda d: (d.get("weighted_score", 0), d.get("published", "")), reverse=True)
    payload = {
        "query": " || ".join(queries),
        "generated_at": max(generated_at) if generated_at else "",
        "count": len(items),
        "source_counts": source_counts,
        "items": items,
    }

    if args.output:
        Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
