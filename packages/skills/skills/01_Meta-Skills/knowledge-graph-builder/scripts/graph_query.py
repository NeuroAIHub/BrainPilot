"""Quick graph query helpers for knowledge graph exploration.

Usage:
    python scripts/graph_query.py stats
    python scripts/graph_query.py search "hippocampus"
    python scripts/graph_query.py neighbors "NN:11" --relation part_of
    python scripts/graph_query.py paths "NN:11" "DOID:10652" --max-hops 3
    python scripts/graph_query.py domain neuroanatomy
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from core.knowledge_graph.src.storage import load_graph


def cmd_stats(kg):
    stats = kg.stats()
    print(json.dumps(stats, indent=2))


def cmd_search(kg, query, limit=20):
    results = kg.search_by_name(query, limit)
    for node in results:
        tags = ", ".join(node.domain_tags)
        print(f"  {node.id:30s} {node.preferred_name:30s} [{tags}]")


def cmd_neighbors(kg, concept_id, relation=None, direction="out"):
    neighbors = kg.get_neighbors(concept_id, relation_type=relation, direction=direction)
    if not neighbors:
        print(f"No neighbors found for {concept_id}")
        return
    for target_id, edge in neighbors:
        print(f"  {edge.source_id} --[{edge.relation_type}]--> {edge.target_id}  (conf={edge.confidence:.2f})")


def cmd_paths(kg, source, target, max_hops=3):
    paths = kg.find_paths(source, target, max_hops)
    if not paths:
        print(f"No paths found between {source} and {target}")
        return
    print(f"Found {len(paths)} path(s):")
    for i, path in enumerate(paths):
        hops = " -> ".join(f"{n}[{r}]" for n, r in path)
        print(f"  Path {i+1}: {hops}")


def cmd_domain(kg, domain_tag):
    nodes = kg.search_by_domain(domain_tag)
    print(f"Domain '{domain_tag}': {len(nodes)} concepts")
    for node in nodes[:20]:
        print(f"  {node.id:30s} {node.preferred_name}")
    if len(nodes) > 20:
        print(f"  ... and {len(nodes) - 20} more")


def main():
    parser = argparse.ArgumentParser(description="Knowledge graph query tool")
    parser.add_argument("--graph", default=None, help="Path to graph JSON")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("stats")

    p_search = sub.add_parser("search")
    p_search.add_argument("query")
    p_search.add_argument("--limit", type=int, default=20)

    p_neighbors = sub.add_parser("neighbors")
    p_neighbors.add_argument("concept_id")
    p_neighbors.add_argument("--relation", default=None)
    p_neighbors.add_argument("--direction", default="out", choices=["out", "in", "both"])

    p_paths = sub.add_parser("paths")
    p_paths.add_argument("source")
    p_paths.add_argument("target")
    p_paths.add_argument("--max-hops", type=int, default=3)

    p_domain = sub.add_parser("domain")
    p_domain.add_argument("domain_tag")

    args = parser.parse_args()

    graph_path = Path(args.graph) if args.graph else Path("core/knowledge_graph/data/knowledge_graph.json")
    kg = load_graph(graph_path)

    if args.command == "stats":
        cmd_stats(kg)
    elif args.command == "search":
        cmd_search(kg, args.query, args.limit)
    elif args.command == "neighbors":
        cmd_neighbors(kg, args.concept_id, args.relation, args.direction)
    elif args.command == "paths":
        cmd_paths(kg, args.source, args.target, args.max_hops)
    elif args.command == "domain":
        cmd_domain(kg, args.domain_tag)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
