#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import load_config, normalize  # noqa: E402

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}


def fetch_feed(query: str, start: int, max_results: int):
    params = {
        "search_query": query,
        "start": str(start),
        "max_results": str(max_results),
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    url = "http://export.arxiv.org/api/query?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as resp:
        return resp.read()


def text(node, expr, default=""):
    found = node.find(expr, ATOM_NS)
    return found.text.strip() if found is not None and found.text else default


def arxiv_id_from_entry(entry):
    raw_id = text(entry, "atom:id")
    return raw_id.rsplit("/", 1)[-1] if raw_id else ""


def entry_to_doc(entry):
    title = text(entry, "atom:title")
    summary = text(entry, "atom:summary")
    published = text(entry, "atom:published")
    updated = text(entry, "atom:updated")
    entry_id = arxiv_id_from_entry(entry)
    authors = [a.text.strip() for a in entry.findall("atom:author/atom:name", ATOM_NS) if a.text]
    categories = [c.attrib.get("term", "") for c in entry.findall("atom:category", ATOM_NS)]
    links = entry.findall("atom:link", ATOM_NS)
    pdf_url = ""
    primary_url = text(entry, "atom:id")
    for link in links:
        title_attr = link.attrib.get("title", "")
        href = link.attrib.get("href", "")
        if title_attr == "pdf":
            pdf_url = href
            break
    combined = normalize(" ".join([title, summary, " ".join(categories)]))
    return {
        "id": entry_id,
        "title": title,
        "summary": summary,
        "published": published,
        "updated": updated,
        "authors": authors,
        "categories": categories,
        "url": primary_url,
        "pdf_url": pdf_url,
        "search_blob": combined,
        "source": "arxiv",
        "source_label": "arXiv",
    }


def iso_to_dt(value: str):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def score_doc(doc, include_keywords):
    blob = doc["search_blob"]
    return sum(1 for kw in include_keywords if kw.lower() in blob)


def category_bonus(doc):
    categories = set(doc.get("categories", []))
    bonus = 0
    for cat in categories:
        if cat.startswith("q-bio.NC"):
            bonus += 3
        elif cat.startswith("q-bio"):
            bonus += 2
        elif cat.startswith("nlin.AO") or cat.startswith("physics.bio-ph"):
            bonus += 1
    return bonus


def main():
    parser = argparse.ArgumentParser(description="Fetch and filter recent arXiv papers.")
    parser.add_argument("--query", help="arXiv search query")
    parser.add_argument("--query-file", help="Simple YAML config file")
    parser.add_argument("--days", type=int, default=3)
    parser.add_argument("--max-results", type=int, default=15)
    parser.add_argument("--output", help="Write JSON to this file")
    args = parser.parse_args()

    config = load_config(args.query_file)
    query = args.query or config.get("query") or "all:neuroscience"
    include_keywords = [s.lower() for s in config.get("include_keywords", [])]
    exclude_keywords = [s.lower() for s in config.get("exclude_keywords", [])]
    max_results = int(config.get("max_results", args.max_results))
    days = args.days

    feed = fetch_feed(query, start=0, max_results=max_results)
    root = ET.fromstring(feed)
    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=days)

    docs = []
    seen = set()
    for entry in root.findall("atom:entry", ATOM_NS):
        doc = entry_to_doc(entry)
        if not doc["id"] or doc["id"] in seen:
            continue
        try:
            published_dt = iso_to_dt(doc["published"])
        except Exception:
            continue
        if published_dt < cutoff:
            continue
        blob = doc["search_blob"]
        if include_keywords and not any(kw in blob for kw in include_keywords):
            continue
        if exclude_keywords and any(kw in blob for kw in exclude_keywords):
            continue
        if "neural network" in blob and not any(term in blob for term in ["brain", "neuron", "neuronal", "cortex", "hippocampus", "spike", "synapse", "electrophysiology", "animal behavior", "behaviour", "zebrafish", "rodent", "mouse", "primate"]):
            continue
        doc["keyword_score"] = score_doc(doc, include_keywords)
        doc["relevance_score"] = doc.get("keyword_score", 0) + category_bonus(doc)
        docs.append(doc)
        seen.add(doc["id"])

    docs.sort(key=lambda d: (d.get("relevance_score", 0), d["published"]), reverse=True)
    payload = {
        "query": query,
        "generated_at": now.isoformat(),
        "days": days,
        "count": len(docs),
        "items": docs,
    }

    if args.output:
        out_path = Path(args.output)
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
