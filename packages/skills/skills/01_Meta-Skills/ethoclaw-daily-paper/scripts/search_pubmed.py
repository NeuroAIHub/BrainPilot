#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import load_config, normalize  # noqa: E402

BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"


def http_get(url: str, params: dict):
    full_url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full_url, headers={"User-Agent": "OpenClaw neuro-paper-monitor/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def search_pubmed(term: str, retmax: int, days: int):
    payload = http_get(
        BASE_URL + "esearch.fcgi",
        {
            "db": "pubmed",
            "term": term,
            "retmax": str(retmax),
            "retmode": "json",
            "sort": "pub date",
            "datetype": "pdat",
            "reldate": str(days),
        },
    )
    data = json.loads(payload.decode("utf-8"))
    return data.get("esearchresult", {}).get("idlist", [])


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def text_join(node, path_expr):
    found = node.findall(path_expr)
    values = []
    for item in found:
        txt = "".join(item.itertext()).strip()
        if txt:
            values.append(txt)
    return " ".join(values).strip()


def parse_pub_date(article):
    pub_date = article.find(".//PubDate")
    if pub_date is None:
        return ""
    year = text_join(pub_date, "Year") or text_join(pub_date, "MedlineDate")[:4]
    month_raw = text_join(pub_date, "Month")
    day = text_join(pub_date, "Day") or "01"
    month_map = {
        "Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04", "May": "05", "Jun": "06",
        "Jul": "07", "Aug": "08", "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12",
    }
    month = month_map.get(month_raw[:3], month_raw.zfill(2) if month_raw.isdigit() else "01")
    if not year:
        return ""
    return f"{year}-{month}-{day.zfill(2)}"


def fetch_details(pmids):
    docs = []
    for batch in chunked(pmids, 100):
        payload = http_get(
            BASE_URL + "efetch.fcgi",
            {
                "db": "pubmed",
                "id": ",".join(batch),
                "retmode": "xml",
            },
        )
        root = ET.fromstring(payload)
        for article in root.findall(".//PubmedArticle"):
            pmid = text_join(article, ".//PMID")
            title = text_join(article, ".//ArticleTitle")
            abstract = text_join(article, ".//Abstract/AbstractText")
            journal = text_join(article, ".//Journal/Title")
            published = parse_pub_date(article)
            doi = ""
            for el in article.findall(".//ArticleId"):
                if el.attrib.get("IdType") == "doi" and (el.text or "").strip():
                    doi = el.text.strip()
                    break
            authors = []
            for author in article.findall(".//Author"):
                last = text_join(author, "LastName")
                fore = text_join(author, "ForeName")
                collective = text_join(author, "CollectiveName")
                name = collective or " ".join(part for part in [fore, last] if part).strip()
                if name:
                    authors.append(name)
            mesh_terms = [text_join(mh, ".") for mh in article.findall(".//MeshHeading/DescriptorName")]
            keywords = [text_join(kw, ".") for kw in article.findall(".//Keyword")]
            blob = normalize(" ".join([title, abstract, journal, " ".join(mesh_terms), " ".join(keywords)]))
            docs.append(
                {
                    "id": pmid,
                    "pmid": pmid,
                    "doi": doi,
                    "title": title,
                    "summary": abstract,
                    "published": published,
                    "updated": published,
                    "authors": authors,
                    "journal": journal,
                    "mesh_terms": mesh_terms,
                    "keywords": keywords,
                    "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
                    "pdf_url": "",
                    "search_blob": blob,
                    "source": "pubmed",
                    "source_label": "PubMed",
                }
            )
        time.sleep(0.34)
    return docs


def score_doc(doc, include_keywords):
    blob = doc.get("search_blob", "")
    return sum(1 for kw in include_keywords if kw.lower() in blob)


def main():
    parser = argparse.ArgumentParser(description="Fetch and filter recent PubMed papers.")
    parser.add_argument("--query", help="PubMed query")
    parser.add_argument("--query-file", help="Simple YAML config file")
    parser.add_argument("--days", type=int, default=3)
    parser.add_argument("--max-results", type=int, default=15)
    parser.add_argument("--output", help="Write JSON to this file")
    args = parser.parse_args()

    config = load_config(args.query_file)
    default_query = '(("Neurosciences"[mh] OR neuroscience[tiab] OR neuroethology[tiab]) AND ("Behavior, Animal"[mh] OR "animal behavior"[tiab] OR behaviour[tiab] OR behavior[tiab] OR electrophysiology[tiab] OR "calcium imaging"[tiab] OR hippocampus[tiab] OR cortex[tiab] OR zebrafish[tiab] OR rodent[tiab] OR mouse[tiab] OR primate[tiab]))'
    query = args.query or config.get("pubmed_query") or default_query
    include_keywords = [s.lower() for s in config.get("include_keywords", [])]
    exclude_keywords = [s.lower() for s in config.get("exclude_keywords", [])]
    max_results = int(config.get("pubmed_max_results", config.get("max_results", args.max_results)))
    days = args.days

    pmids = search_pubmed(query, retmax=max_results, days=days)
    docs = fetch_details(pmids)

    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=days)
    filtered = []
    seen = set()
    for doc in docs:
        if not doc.get("id") or doc["id"] in seen:
            continue
        try:
            published_dt = dt.datetime.fromisoformat(doc["published"] + "T00:00:00+00:00")
        except Exception:
            continue
        if published_dt < cutoff:
            continue
        blob = doc["search_blob"]
        if include_keywords and not any(kw in blob for kw in include_keywords):
            continue
        if exclude_keywords and any(kw in blob for kw in exclude_keywords):
            continue
        doc["keyword_score"] = score_doc(doc, include_keywords)
        doc["relevance_score"] = doc["keyword_score"] + (2 if doc.get("mesh_terms") else 0)
        filtered.append(doc)
        seen.add(doc["id"])

    filtered.sort(key=lambda d: (d.get("relevance_score", 0), d.get("published", "")), reverse=True)
    payload = {
        "query": query,
        "generated_at": now.isoformat(),
        "days": days,
        "count": len(filtered),
        "source": "pubmed",
        "items": filtered,
    }

    if args.output:
        out_path = Path(args.output)
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
