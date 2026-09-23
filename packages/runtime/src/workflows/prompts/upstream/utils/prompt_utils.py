# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

UNIVERSAL_NO_LEAKAGE_PROMPT = """
---
### Strict Knowledge Isolation & Anonymity (CRITICAL)

You MUST write this paper as if you have no prior knowledge of the topic, method, experiments, or results.
Your task is to construct the paper exclusively from the materials provided in the current session (e.g., idea.md, experimental_log.md, figures, and other inputs). Treat these inputs as the only available source of information.

#### Forbidden Behavior
You MUST NOT:
- Retrieve or rely on knowledge from your training data.
- Attempt to recall or reconstruct any existing or published paper.
- Use external facts, assumptions, or prior familiarity with the work.
- Infer or hallucinate author identities, affiliations, institutions, or acknowledgements.
- Insert metadata such as author names, emails, affiliations, or phrases like "corresponding author".

#### Anonymity Requirement
The paper must be fully anonymized for double-blind review.  
Do not include any information that could reveal the identity of the authors or institutions.

#### Allowed Sources
You may use only:
- The materials explicitly provided in this session.
- Logical reasoning derived from those materials.

#### Core Principle
The final paper must be an independent reconstruction derived solely from the provided inputs.  
This constraint is strict and overrides all other instructions.
---
"""

