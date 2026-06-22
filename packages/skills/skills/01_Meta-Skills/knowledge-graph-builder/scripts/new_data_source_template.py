"""Template: Ingest a new data source into the knowledge graph.

Usage:
    python scripts/new_data_source_template.py --input data.tsv

Replace TODO sections with your source-specific logic.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

# Adjust import path for your project structure
from core.knowledge_graph.src.schema import ConceptNode, Edge, DomainTag
from core.knowledge_graph.src.graph_manager import KnowledgeGraph
from core.knowledge_graph.src.storage import load_graph, save_graph

logger = logging.getLogger(__name__)


def parse_data(data_path: str) -> list[dict]:
    """TODO: Parse your source data file.

    Returns list of dicts with at minimum:
        - id: unique identifier
        - name: preferred display name
        - type: entity type (maps to DomainTag)
        - parent_id: optional, for hierarchical edges
        - synonyms: optional, list of alternate names
    """
    records = []
    # TODO: implement parsing logic
    # Example TSV parsing:
    # with open(data_path) as f:
    #     reader = csv.DictReader(f, delimiter='\t')
    #     for row in reader:
    #         records.append({
    #             "id": f"SRC:{row['id']}",
    #             "name": row["name"],
    #             "type": "disease",
    #             "parent_id": row.get("parent_id"),
    #             "synonyms": row.get("synonyms", "").split("|"),
    #         })
    return records


def ingest_source(kg: KnowledgeGraph, data_path: str) -> dict:
    """Parse source data and add concepts + edges to graph.

    Returns summary dict.
    """
    records = parse_data(data_path)
    concepts_added = 0
    edges_added = 0

    for rec in records:
        # 1. Create ConceptNode
        # TODO: map your entity types to DomainTag values
        domain = DomainTag.DISEASE  # adjust as needed

        node = ConceptNode(
            id=rec["id"],
            preferred_name=rec["name"],
            domain_tags=[domain.value],
            source_vocab="your_source_name",
            aliases=rec.get("synonyms", []),
        )
        kg.add_concept(node)
        concepts_added += 1

        # 2. Create hierarchical edge (if applicable)
        parent_id = rec.get("parent_id")
        if parent_id:
            edge = Edge(
                source_id=rec["id"],
                target_id=parent_id,
                relation_type="is_a",  # or "part_of" for anatomy
                source="your_source_name",
            )
            before = kg.G.number_of_edges()
            kg.add_edge(edge)
            if kg.G.number_of_edges() > before:
                edges_added += 1

    summary = {
        "concepts_added": concepts_added,
        "edges_added": edges_added,
        "total_records": len(records),
    }
    logger.info(f"ingestion complete: {summary}")
    return summary


def main():
    parser = argparse.ArgumentParser(description="Ingest data from a new source")
    parser.add_argument("--input", required=True, help="Path to source data file")
    parser.add_argument("--graph", default=None, help="Path to existing graph JSON")
    parser.add_argument("--output", default=None, help="Output graph path")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    graph_path = Path(args.graph) if args.graph else Path("core/knowledge_graph/data/knowledge_graph.json")
    kg = load_graph(graph_path)

    summary = ingest_source(kg, args.input)

    out_path = Path(args.output) if args.output else graph_path
    save_graph(kg, out_path)
    logger.info(f"saved graph to {out_path}")


if __name__ == "__main__":
    main()
