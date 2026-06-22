"""Reusable entity resolution for knowledge graph construction.

Resolves entity names to concept IDs using a 5-level cascading strategy:
1. Exact match on preferred_name
2. Case-insensitive match
3. Alias match
4. Substring match (prefer shortest name)
5. Create new concept if no match

Usage:
    from scripts.entity_resolution import EntityResolver
    resolver = EntityResolver(kg)
    concept_id = resolver.resolve("hippocampus", entity_type="brain_region")
"""

from __future__ import annotations

import logging
from typing import Optional

from core.knowledge_graph.src.schema import ConceptNode, DomainTag
from core.knowledge_graph.src.graph_manager import KnowledgeGraph

logger = logging.getLogger(__name__)

# Map entity type strings to DomainTag values
ENTITY_TYPE_TO_DOMAIN = {
    "brain_region": DomainTag.NEUROANATOMY,
    "disease": DomainTag.DISEASE,
    "gene": DomainTag.GENE,
    "neurotransmitter": DomainTag.NEUROTRANSMITTER,
    "protein": DomainTag.GENE,
    "drug": DomainTag.DRUG,
    "network": DomainTag.CONNECTIVITY,
    "biomarker": DomainTag.BIOMARKER,
    "cognitive_function": DomainTag.COGNITIVE_FUNCTION,
}


class EntityResolver:
    """Resolve entity names to concept IDs in a knowledge graph."""

    def __init__(self, kg: KnowledgeGraph):
        self.kg = kg

    def resolve(
        self,
        entity_name: str,
        entity_type: str = "",
        source_vocab: str = "entity_resolution",
    ) -> Optional[str]:
        """Resolve an entity name to a concept ID.

        Args:
            entity_name: The entity name to resolve.
            entity_type: Entity type string (maps to DomainTag).
            source_vocab: Source vocabulary for new concepts.

        Returns:
            Concept ID string, or None if entity_name is empty.
        """
        if not entity_name:
            return None

        # 1. Exact match
        for node in self.kg._index.values():
            if node.preferred_name == entity_name:
                return node.id

        # 2. Case-insensitive match
        entity_lower = entity_name.lower()
        for node in self.kg._index.values():
            if node.preferred_name.lower() == entity_lower:
                return node.id

        # 3. Alias match
        for node in self.kg._index.values():
            for alias in node.aliases:
                if alias.lower() == entity_lower:
                    return node.id

        # 4. Substring match
        candidates = []
        for node in self.kg._index.values():
            name_lower = node.preferred_name.lower()
            if entity_lower in name_lower or name_lower in entity_lower:
                candidates.append(node)
                continue
            for alias in node.aliases:
                if entity_lower in alias.lower() or alias.lower() in entity_lower:
                    candidates.append(node)
                    break

        if len(candidates) == 1:
            return candidates[0].id
        elif len(candidates) > 1:
            candidates.sort(key=lambda n: len(n.preferred_name))
            return candidates[0].id

        # 5. Not found — create new concept
        return self._create_new_concept(entity_name, entity_type, source_vocab)

    def _create_new_concept(
        self,
        name: str,
        entity_type: str,
        source_vocab: str,
    ) -> str:
        """Create a new concept node for an unresolved entity."""
        domain = ENTITY_TYPE_TO_DOMAIN.get(entity_type, DomainTag.DISEASE)
        new_id = f"CLM_CONCEPT:{name.replace(' ', '_')}"

        self.kg.add_concept(ConceptNode(
            id=new_id,
            preferred_name=name,
            domain_tags=[domain.value],
            source_vocab=source_vocab,
        ))
        logger.info(f"created new concept: {new_id} ({name})")
        return new_id
