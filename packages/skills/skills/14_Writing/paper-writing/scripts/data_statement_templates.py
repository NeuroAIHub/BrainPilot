"""
Data Availability statement templates for Nature-family journal submissions.

Derived from nature-skills/nature-data (MIT License, Copyright 2026 Yuan Yizhe).
Source: https://github.com/Yuan1z0825/nature-skills
"""

STATEMENT_TEMPLATES = {
    "single_public_repo": {
        "template": (
            "The {data_type} data supporting the findings of this study are available in "
            "{repository} under accession {accession} / at {doi}. The deposited record "
            "contains {contents}."
        ),
        "fields": ["data_type", "repository", "accession", "doi", "contents"],
        "note": "Raw/processed/source data deposited in a formal repository with an accession number, DOI, or persistent URL.",
    },
    "multiple_repos": {
        "template": (
            "The datasets generated in this study are available as follows: "
            "{dataset_family_1} in {repo_1} under {id_1}; "
            "{dataset_family_2} in {repo_2} under {id_2}; "
            "and figure source data in {source_location} under {source_id}."
        ),
        "fields": [
            "dataset_family_1", "repo_1", "id_1",
            "dataset_family_2", "repo_2", "id_2",
            "source_location", "source_id",
        ],
        "note": "Different data types go to different repositories or files; list each one explicitly instead of a vague 'see supplementary materials'.",
    },
    "data_in_paper": {
        "template": (
            "All data supporting the findings of this study are included in the paper, "
            "its Supplementary Information, and Source Data files. {supplementary_details}"
        ),
        "fields": ["supplementary_details"],
        "note": "Use only when all supporting data genuinely reside in the main text, supplementary materials, and Source Data.",
    },
    "reused_public_data": {
        "template": (
            "This study used publicly available {dataset_name} from {repository}, "
            "available under {identifier}. We used {version_info}. "
            "No new primary {data_type} data were generated for this part of the analysis."
        ),
        "fields": ["dataset_name", "repository", "identifier", "version_info", "data_type"],
        "note": "When reusing public databases, specify the database name, version/release/accession, and cite the dataset.",
    },
    "mixed_data": {
        "template": (
            "Data generated in this study are available in {repository} under {identifier}. "
            "Public datasets reused in the analysis were obtained from {source_1} and {source_2}. "
            "Source data for {figure_table_refs} are provided in {location}."
        ),
        "fields": ["repository", "identifier", "source_1", "source_2", "figure_table_refs", "location"],
        "note": "Separate newly generated data from reused public data to avoid implying all data originated from this study.",
    },
    "controlled_access": {
        "template": (
            "The {data_type} data supporting this study are not publicly available because "
            "{restriction_reason}. A metadata record is available at {metadata_location}. "
            "Qualified researchers may request access from {access_body} at {contact}. "
            "Access requires {conditions} and will be reviewed according to {policy}."
        ),
        "fields": [
            "data_type", "restriction_reason", "metadata_location",
            "access_body", "contact", "conditions", "policy",
        ],
        "note": "For human participant or privacy-restricted data, state the request route and review conditions — not just 'not available due to privacy'.",
    },
    "third_party_licensed": {
        "template": (
            "The {data_type} data used in this study were obtained from {provider} under "
            "licence and are not publicly redistributable by the authors. "
            "Requests for access should be directed to {contact}. "
            "Derived data that can be shared are available in {repository} under {identifier}."
        ),
        "fields": ["data_type", "provider", "contact", "repository", "identifier"],
        "note": "For third-party licensed data that cannot be redistributed, identify the data owner and how readers should request access.",
    },
    "commercially_restricted": {
        "template": (
            "The {data_type} data are subject to commercial restrictions and cannot be made "
            "publicly available. Requests for access may be directed to {contact} and are "
            "subject to {terms}. The authors provide {available_materials} in {location} "
            "to support interpretation of the results."
        ),
        "fields": ["data_type", "contact", "terms", "available_materials", "location"],
        "note": "For commercially restricted data, state the restriction, the contact for access, and whether summary data or metadata are publicly available.",
    },
    "embargoed": {
        "template": (
            "The {data_type} data have been deposited in {repository} under {identifier} "
            "and are under embargo until {embargo_date}. "
            "Reviewers can access the data using {reviewer_access}. "
            "The data will become publicly available at {identifier} when the embargo ends."
        ),
        "fields": ["data_type", "repository", "identifier", "embargo_date", "reviewer_access"],
        "note": "For embargoed data, a repository record, reviewer access route, and a clear embargo end date or condition are required.",
    },
    "request_based": {
        "template": (
            "The {data_type} data are not publicly available because {reason}. "
            "Requests for access may be sent to {contact}, and will be considered for "
            "{eligible_purpose} subject to {conditions}. "
            "{public_materials} are available at {location}."
        ),
        "fields": ["data_type", "reason", "contact", "eligible_purpose", "conditions", "public_materials", "location"],
        "note": "'Reasonable request' is acceptable only when the reason, receiving institution, review conditions, and publicly available metadata are specified.",
    },
    "no_datasets": {
        "template": "No datasets were generated or analysed during the current study.",
        "fields": [],
        "note": "Use only when genuinely no datasets were generated or analysed; typically not applicable to empirical studies.",
    },
    "theory_paper": {
        "template": "This work is theoretical and does not generate or analyse empirical datasets.",
        "fields": [],
        "note": "For theory papers only.",
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# Anti-patterns: weak wording to flag and revise
# ─────────────────────────────────────────────────────────────────────────────

ANTI_PATTERNS = {
    "Data are available upon request.": {
        "why": "No reason, route, eligibility, or durability.",
        "fix": "Add restriction reason, responsible access body, conditions, and metadata.",
    },
    "Data are available from the corresponding author on reasonable request.": {
        "why": "Often a literal translation of Chinese; not durable or specific enough.",
        "fix": "Use an institutional/repository access route and define review conditions.",
    },
    "Data will be uploaded after acceptance.": {
        "why": "No current repository or durable identifier.",
        "fix": "Deposit before submission or provide a private reviewer link.",
    },
    "All data are in the manuscript.": {
        "why": "Often false for figures/statistics.",
        "fix": "Name exact source data, supplementary files, and omitted raw data.",
    },
    "Data are proprietary.": {
        "why": "Does not say who controls access.",
        "fix": "Name owner/provider and access route.",
    },
    "N/A": {
        "why": "Nature-style instructions usually require an explanation.",
        "fix": "State why no datasets were generated or analysed.",
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# FAIR Metadata Audit Questions
# ─────────────────────────────────────────────────────────────────────────────

FAIR_AUDIT_QUESTIONS = [
    "Which result would fail if this dataset were unavailable?",
    "Is the route durable beyond the corresponding author's current email address?",
    "Can a reader tell what each identifier contains?",
    "Are restrictions specific enough for an editor to judge them?",
    "Are reused datasets cited, not merely mentioned?",
]
