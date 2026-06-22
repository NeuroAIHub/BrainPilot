"""
Academic section phrase bank and move orders for manuscript writing.

Derived from nature-skills/nature-polishing (MIT License, Copyright 2026 Yuan Yizhe).
Source: https://github.com/Yuan1z0825/nature-skills
"""

SECTION_MOVES = {
    "introduction": {
        "questions": [
            "Why does the topic matter?",
            "What is already known?",
            "What is still missing or contested?",
            "What does the present study ask or do?",
        ],
        "move_order": [
            "establish importance",
            "summarize what is known",
            "identify a gap, limitation, or controversy",
            "state the study aim",
            "indicate value or approach",
        ],
        "useful_phrases": [
            "Recent years have seen increasing interest in ...",
            "X is a central issue in ...",
            "Previous studies have shown that ...",
            "However, the mechanisms underlying ... remain poorly understood.",
            "Few studies have examined ...",
            "Here, we investigate whether ...",
            "This work provides ...",
        ],
        "avoid": [
            "long historical throat-clearing",
            "detailed results",
            "inflated novelty claims before the gap is defined",
        ],
    },
    "literature_review": {
        "questions": [
            "What lines of work define the field?",
            "What has been established?",
            "Where do findings diverge or remain incomplete?",
            "Which gap matters for the present paper?",
        ],
        "move_order": [
            "describe the scope of existing work",
            "identify dominant approaches",
            "state what has been established",
            "note disagreements or contradictions",
            "isolate the missing piece",
        ],
        "useful_phrases": [
            "A substantial body of work has focused on ...",
            "Most studies have relied on ...",
            "Previous work has established that ...",
            "Findings have been mixed regarding ...",
            "By contrast, little attention has been paid to ...",
            "No study has yet examined ...",
        ],
        "avoid": [
            "citation-by-citation summary",
            "treating all prior work as uniformly weak",
        ],
    },
    "methods": {
        "questions": [
            "Could another group reproduce the work from this description?",
        ],
        "move_order": [
            "design or cohort",
            "materials or data source",
            "procedure",
            "outcome measures",
            "analysis and statistics",
            "ethics when relevant",
        ],
        "useful_phrases": [
            "A cross-sectional study was undertaken to ...",
            "Samples were collected from ...",
            "X was quantified using ...",
            "We used ... to assess ...",
            "Differences were analysed using ...",
            "All analyses were performed in ...",
        ],
        "avoid": [
            "under standard conditions",
            "using routine methods",
            "data were analysed statistically",
        ],
    },
    "results": {
        "questions": [
            "What was observed, under which condition, and with what evidence?",
        ],
        "move_order": [
            "orient the reader to the figure, table, or experiment",
            "state the main observation",
            "add quantitative detail",
            "note expected or unexpected patterns",
            "compare with prior work only if it clarifies the result",
        ],
        "useful_phrases": [
            "Figure 1 shows ...",
            "As shown in Table 1, ...",
            "The most notable finding was that ...",
            "Contrary to expectations, ...",
            "No significant difference was observed in ...",
            "These results are consistent with ...",
            "In contrast to earlier reports, ...",
        ],
        "avoid": [
            "discussion-length mechanism explanations",
            "repeating every visual detail from the figure",
        ],
    },
    "discussion": {
        "questions": [
            "What do the main findings mean?",
            "How do they relate to earlier work?",
            "Which explanations are plausible?",
            "What limitations constrain interpretation?",
            "What follows from the findings, and what does not?",
        ],
        "move_order": [
            "restate the main finding",
            "explain plausible reasons",
            "compare with earlier work",
            "note limitations",
            "state implications",
            "point to future work if needed",
        ],
        "useful_phrases": [
            "Taken together, these findings suggest that ...",
            "A possible explanation is that ...",
            "This discrepancy may reflect ...",
            "These results should be interpreted with caution because ...",
            "An implication of this is that ...",
            "Further work is needed to determine whether ...",
        ],
        "avoid": [
            "repeating the Results section in new words",
            "claiming mechanism when only association was shown",
        ],
    },
    "conclusion": {
        "questions": [
            "What was the central contribution?",
            "Which finding matters most?",
            "What implication follows, with what boundary?",
        ],
        "move_order": [
            "return to the aim",
            "summarize the decisive finding",
            "state contribution or significance",
            "give a boundary or forward look",
        ],
        "useful_phrases": [
            "This study set out to ...",
            "The present findings indicate that ...",
            "These results extend our understanding of ...",
            "Notwithstanding these limitations, ...",
            "Further studies are required to ...",
        ],
        "avoid": [
            "introducing new experiments",
            "ending on vague praise of the work",
        ],
    },
    "abstract": {
        "questions": [
            "What problem or gap is being addressed?",
            "What was done?",
            "What was found?",
            "Why should the reader care?",
        ],
        "move_order": [
            "broad context",
            "concrete gap",
            "approach",
            "key result with numbers if available",
            "implication",
        ],
        "useful_phrases": [
            "X remains challenging because ...",
            "Here, we ...",
            "Using ... , we found that ...",
            "We show that ...",
            "These findings suggest ...",
        ],
        "avoid": [],
    },
    "title": {
        "questions": [
            "Which few words make the paper searchable, accurate, and interesting without overclaiming?",
        ],
        "target_properties": ["searchable", "specific", "restrained", "defensible"],
        "useful_patterns": [
            "[Core entity] in/through/by [mechanism or context]",
            "[Process] shapes [outcome] in [system]",
            "[Signature/pattern/framework] of [phenomenon]",
        ],
        "avoid": [
            "A study of ...",
            "vague hooks",
            "unverified 'first'",
            "stacked jargon",
        ],
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Evidence Strength Verbs
# ─────────────────────────────────────────────────────────────────────────────

EVIDENCE_VERBS = {
    "strong": [
        "demonstrate", "establish", "confirm", "show", "reveal",
    ],
    "moderate": [
        "suggest", "indicate", "support", "point to",
    ],
    "speculative": [
        "may reflect", "could imply", "is consistent with", "appears to",
    ],
}

# ─────────────────────────────────────────────────────────────────────────────
# Transition Families
# ─────────────────────────────────────────────────────────────────────────────

TRANSITIONS = {
    "contrast": [
        "However,", "By contrast,", "In contrast,", "Nevertheless,",
        "On the other hand,", "Conversely,",
    ],
    "addition": [
        "Moreover,", "Furthermore,", "In addition,", "Additionally,",
    ],
    "consequence": [
        "Therefore,", "Consequently,", "As a result,", "Thus,",
    ],
    "qualification": [
        "Notwithstanding,", "Although,", "Despite this,", "While",
    ],
}
