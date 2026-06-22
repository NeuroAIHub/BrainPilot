"""Hypothesis Engine CLI Reference - for agent use.

The executable CLI lives in core/knowledge_graph/phase3.py.
This file documents the usage patterns for agent reference.

Usage (run from project root):

    # Batch generate hypotheses across the entire graph
    python -m core.knowledge_graph.phase3 batch --output data/hypotheses.json

    # Load and re-rank saved hypotheses
    python -m core.knowledge_graph.phase3 rank --input data/hypotheses.json --top 20

    # Interactive queries
    python -m core.knowledge_graph.phase3 paths "hippocampus" "Alzheimer Disease"
    python -m core.knowledge_graph.phase3 bridge "hippocampus" --target-domain disease
    python -m core.knowledge_graph.phase3 contradictions --domain disease
    python -m core.knowledge_graph.phase3 gaps --domain-a neuroanatomy --domain-b disease
    python -m core.knowledge_graph.phase3 explore "hippocampus"
    python -m core.knowledge_graph.phase3 stats

Programmatic usage:
    from core.knowledge_graph import load_graph, HypothesisEngine

    kg = load_graph()
    engine = HypothesisEngine(kg)

    # batch generate
    hypotheses = engine.batch_generate()
    engine.save_hypotheses(hypotheses, "data/hypotheses.json")

    # load and rank
    hypotheses = engine.load_hypotheses("data/hypotheses.json")
    ranked = engine.rank_hypotheses(hypotheses, top_n=50)

    # each hypothesis has 4 scores:
    #   confidence_score - evidence quality
    #   novelty_score - how unexpected
    #   evidence_score - statistical strength
    #   testability_score - can NeuroClaw execute this?
    #   composite_score - combined ranking
"""
