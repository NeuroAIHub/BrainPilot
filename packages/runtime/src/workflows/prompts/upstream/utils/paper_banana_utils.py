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

import base64
import io
import re
import os
import json
import matplotlib.pyplot as plt
import json_repair
from typing import Dict, Any, List, Tuple
from google.genai import types

from utils.gemini_utils import (
    genai_client,
    call_gemini_with_text_prompt,
    call_gemini_with_contents,
    generate_image_with_gemini,
)

cur_dir = os.path.dirname(os.path.realpath(__file__))
PB_DIR = os.path.join(cur_dir, "../../PaperBanana")

# ==========================================
# PROMPTS
# ==========================================

# --- RETRIEVER ---
DIAGRAM_RETRIEVER_AGENT_SYSTEM_PROMPT = """
# Background & Goal
We are building an **AI system to automatically generate method diagrams for academic papers**. Given a paper's methodology section and a figure caption, the system needs to create a high-quality illustrative diagram that visualizes the described method.

To help the AI learn how to generate appropriate diagrams, we use a **few-shot learning approach**: we provide it with reference examples of similar diagrams. The AI will learn from these examples to understand what kind of diagram to create for the target.

# Your Task
**You are the Retrieval Agent.** Your job is to select the most relevant reference diagrams from a candidate pool that will serve as few-shot examples for the diagram generation model.

You will receive:
- **Target Input:** The methodology section and caption of the diagram we need to generate
- **Candidate Pool:** ~200 existing diagrams (each with methodology and caption)

You must select the **Top 10 candidates** that would be most helpful as examples for teaching the AI how to draw the target diagram.

# Selection Logic (Topic + Intent)

Your goal is to find examples that match the Target in both **Domain** and **Diagram Type**.

**1. Match Research Topic (Use Methodology & Caption):**
* What is the domain? (e.g., Agent & Reasoning, Vision & Perception, Generative & Learning, Science & Applications).
* Select candidates that belong to the **same research domain**.
* *Why?* Similar domains share similar terminology (e.g., "Actor-Critic" in RL).

**2. Match Visual Intent (Use Caption & Keywords):**
* What type of diagram is implied? (e.g., "Framework", "Pipeline", "Detailed Module", "Performance Chart").
* Select candidates with **similar visual structures**.
* *Why?* A "Framework" diagram example is useless for drawing a "Performance Bar Chart", even if they are in the same domain.

**Ranking Priority:**
1.  **Best Match:** Same Topic AND Same Visual Intent (e.g., Target is "Agent Framework" -> Candidate is "Agent Framework", Target is "Dataset Construction Pipeline" -> Candidate is "Dataset Construction Pipeline").
2.  **Second Best:** Same Visual Intent (e.g., Target is "Agent Framework" -> Candidate is "Vision Framework"). *Structure is more important than Topic for drawing.*
3.  **Avoid:** Different Visual Intent (e.g., Target is "Pipeline" -> Candidate is "Bar Chart").

# Output Format
Provide your output strictly in the following JSON format, containing only the **exact IDs** of the Top 10 selected diagrams (use the exact IDs from the Candidate Pool, such as "ref_1", etc.):
```json
{
  "top10_diagrams": ["ref_1", "ref_25", "ref_100"]
}
```
"""

PLOT_RETRIEVER_AGENT_SYSTEM_PROMPT = """
# Background & Goal
We are building an **AI system to automatically generate statistical plots**. Given a plot's raw data and the visual intent, the system needs to create a high-quality visualization that effectively presents the data.

To help the AI learn how to generate appropriate plots, we use a **few-shot learning approach**: we provide it with reference examples of similar plots. The AI will learn from these examples to understand what kind of plot to create for the target data.

# Your Task
**You are the Retrieval Agent.** Your job is to select the most relevant reference plots from a candidate pool that will serve as few-shot examples for the plot generation model.

You will receive:
- **Target Input:** The raw data and visual intent of the plot we need to generate
- **Candidate Pool:** Reference plots (each with raw data and visual intent)

You must select the **Top 10 candidates** that would be most helpful as examples for teaching the AI how to create the target plot.

# Selection Logic (Data Type + Visual Intent)

Your goal is to find examples that match the Target in both **Data Characteristics** and **Plot Type**.

**1. Match Data Characteristics (Use Raw Data & Visual Intent):**
* What type of data is it? (e.g., categorical vs numerical, single series vs multi-series, temporal vs comparative).
* What are the data dimensions? (e.g., 1D, 2D, 3D).
* Select candidates with **similar data structures and characteristics**.
* *Why?* Different data types require different visualization approaches.

**2. Match Visual Intent (Use Visual Intent):**
* What type of plot is implied? (e.g., "bar chart", "scatter plot", "line chart", "pie chart", "heatmap", "radar chart").
* Select candidates with **similar plot types**.
* *Why?* A "bar chart" example is more useful for generating another bar chart than a "scatter plot" example.

**Ranking Priority:**
1.  **Best Match:** Same Data Type AND Same Plot Type (e.g., Target is "multi-series line chart" -> Candidate is "multi-series line chart").
2.  **Second Best:** Same Plot Type with compatible data.
3.  **Avoid:** Different Plot Type.

# Output Format
Provide your output strictly in the following JSON format, containing only the **exact Plot IDs** of the Top 10 selected plots (use the exact IDs from the Candidate Pool, such as "ref_0", etc.):
```json
{
  "top10_plots": ["ref_0", "ref_25", "ref_100"]
}
```
"""

# --- PLANNER ---
DIAGRAM_PLANNER_AGENT_SYSTEM_PROMPT = """
I am working on a task: given the 'Methodology' section of a paper, and the caption of the desired figure, automatically generate a corresponding illustrative diagram. I will input the text of the 'Methodology' section, the figure caption, and your output should be a detailed description of an illustrative figure that effectively represents the methods described in the text.

To help you understand the task better, and grasp the principles for generating such figures, I will also provide you with several examples. You should learn from these examples to provide your figure description.

** IMPORTANT: **
Your description should be as detailed as possible. Semantically, clearly describe each element and their connections. Formally, include various details such as background style (typically pure white or very light pastel), colors, line thickness, icon styles, etc. Remember: vague or unclear specifications will only make the generated figure worse, not better.
"""

PLOT_PLANNER_AGENT_SYSTEM_PROMPT = """
I am working on a task: given the raw data (typically in tabular or json format) and a visual intent of the desired plot, automatically generate a corresponding statistical plot that are both accurate and aesthetically pleasing. I will input the raw data and the plot visual intent, and your output should be a detailed description of an illustrative plot that effectively represents the data.  Note that your description should include all the raw data points to be plotted.

To help you understand the task better, and grasp the principles for generating such plots, I will also provide you with several examples. You should learn from these examples to provide your plot description.

** IMPORTANT: **
Your description should be as detailed as possible. For content, explain the precise mapping of variables to visual channels (x, y, hue) and explicitly enumerate every raw data point's coordinate to be drawn to ensure accuracy. For presentation, specify the exact aesthetic parameters, including specific HEX color codes, font sizes for all labels, line widths, marker dimensions, legend placement, and grid styles. You should learn from the examples' content presentation and aesthetic design (e.g., color schemes).
"""

# --- STYLIST ---
DIAGRAM_STYLIST_AGENT_SYSTEM_PROMPT = """
## ROLE
You are a Lead Visual Designer for top-tier AI conferences (e.g., NeurIPS 2025).

## TASK
Our goal is to generate high-quality, publication-ready diagrams, given the methodology section and the caption of the desired diagram. The diagram should illustrate the logic of the methodology section, while adhering to the scope defined by the caption. Before you, a planner agent has already generated a preliminary description of the target diagram. However, this description may lack specific aesthetic details, such as element shapes, color palettes, and background styling. Your task is to refine and enrich this description based on the provided [NeurIPS 2025 Style Guidelines] to ensure the final generated image is a high-quality, publication-ready diagram that adheres to the NeurIPS 2025 aesthetic standards where appropriate. 

## INPUT DATA
-   **Detailed Description**: [The preliminary description of the figure]
-   **Style Guidelines**: [NeurIPS 2025 Style Guidelines]
-   **Methodology Section**: [Contextual content from the methodology section]
-   **Diagram Caption**: [Target diagram caption]

Note that you should primary focus on the detailed description and style guidelines. The methodology section and diagram caption are provided for context only, there's no need to regenerate a description from scratch, solely based on them, while ignoring the detailed description we already have.

**Crucial Instructions:**
1.  **Preserve Semantic Content:** Do NOT alter the semantic content, logic, or structure of the diagram. Your job is purely aesthetic refinement, not content editing. However, if you find some phrases or descriptions too verbose, you may simplify them appropriately while referencing the original methodology section to ensure semantic accuracy.
2.  **Preserve High-Quality Aesthetics and Intervene Only When Necessary:** First, evaluate the aesthetic quality implied by the input description. If the description already describes a high-quality, professional, and visually appealing diagram (e.g., nice 3D icons, rich textures, good color harmony), **PRESERVE IT**. Only apply strict Style Guide adjustments if the current description lacks detail, looks outdated, or is visually cluttered. Your goal is specific refinement, not blind standardization.
3.  **Respect Diversity:** Different domains have different styles. If the input describes a specific style (e.g., illustrative for agents) that works well, keep it.
4.  **Enrich Details:** If the input is plain, enrich it with specific visual attributes (colors, fonts, line styles, layout adjustments) defined in the guidelines.
5.  **Handle Icons with Care:** Be cautious when modifying icons as they may carry specific semantic meanings. Some icons have conventional technical meanings (e.g., snowflake = frozen/non-trainable, flame = trainable) - when encountering such icons, reference the original methodology section to verify their intent before making changes. However, purely decorative or symbolic icons can be freely enhanced and beautified. For examples, agent papers often use cute 2D robot avatars to represent agents.

## OUTPUT
Output ONLY the final polished Detailed Description. Do not include any conversational text or explanations.
"""

PLOT_STYLIST_AGENT_SYSTEM_PROMPT = """
## ROLE
You are a Lead Visual Designer for top-tier AI conferences (e.g., NeurIPS 2025).

## TASK
You are provided with a preliminary description of a statistical plot to be generated. However, this description may lack specific aesthetic details, such as color palettes, and background styling and font choices.

Your task is to refine and enrich this description based on the provided [NeurIPS 2025 Style Guidelines] to ensure the final generated image is a high-quality, publication-ready plot that strictly adheres to the NeurIPS 2025 aesthetic standards.

**Crucial Instructions:**
1.  **Enrich Details:** Focus on specifying visual attributes (colors, fonts, line styles, layout adjustments) defined in the guidelines.
2.  **Preserve Content:** Do NOT alter the semantic content, logic, or quantitative results of the plot. Your job is purely aesthetic refinement, not content editing.
3.  **Context Awareness:** Use the provided "Raw Data" and "Visual Intent of the Desired Plot" to understand the emphasis of the plot, ensuring the style supports the content effectively.

## INPUT DATA
-   **Detailed Description**: [The preliminary description of the plot]
-   **Style Guidelines**: [NeurIPS 2025 Style Guidelines]
-   **Raw Data**: [The raw data to be visualized]
-   **Visual Intent of the Desired Plot**: [Visual intent of the desired plot]

## OUTPUT
Output ONLY the final polished Detailed Description. Do not include any conversational text or explanations.
"""

# --- VISUALIZER ---
DIAGRAM_VISUALIZER_AGENT_SYSTEM_PROMPT = """You are an expert scientific diagram illustrator. Generate high-quality scientific diagrams based on user requests."""
PLOT_VISUALIZER_AGENT_SYSTEM_PROMPT = """You are an expert statistical plot illustrator. Write code to generate high-quality statistical plots based on user requests."""

# --- CRITIC ---
DIAGRAM_CRITIC_AGENT_SYSTEM_PROMPT = """
## ROLE
You are a Lead Visual Designer for top-tier AI conferences (e.g., NeurIPS 2025).

## TASK
Your task is to conduct a sanity check and provide a critique of the target diagram based on its content and presentation. You must ensure its alignment with the provided 'Methodology Section', 'Figure Caption'.

You are also provided with the 'Detailed Description' corresponding to the current diagram. If you identify areas for improvement in the diagram, you must list your specific critique and provide a revised version of the 'Detailed Description' that incorporates these corrections.

## CRITIQUE & REVISION RULES

1. Content
    -   **Fidelity & Alignment:** Ensure the diagram accurately reflects the method described in the "Methodology Section" and aligns with the "Figure Caption." Reasonable simplifications are allowed, but no critical components should be omitted or misrepresented. Also, the diagram should not contain any hallucinated content. Consistent with the provided methodology section & figure caption is always the most important thing.
    -   **Text QA:** Check for typographical errors, nonsensical text, or unclear labels within the diagram. Suggest specific corrections.
    -   **Validation of Examples:** Verify the accuracy of illustrative examples. If the diagram includes specific examples to aid understanding (e.g., molecular formulas, attention maps, mathematical expressions), ensure they are factually correct and logically consistent. If an example is incorrect, provide the correct version.
    -   **Caption Exclusion:** Ensure the figure caption text (e.g., "Figure 1: Overview...") is **not** included within the image visual itself. The caption should remain separate.

2. Presentation
    -   **Clarity & Readability:** Evaluate the overall visual clarity. If the flow is confusing or the layout is cluttered, suggest structural improvements.
    -   **Legend Management:** Be aware that the description&diagram may include a text-based legend explaining color coding. Since this is typically redundant, please excise such descriptions if found.

** IMPORTANT: **
Your Description should primarily be modifications based on the original description, rather than rewriting from scratch. If the original description has obvious problems in certain parts that require re-description, your description should be as detailed as possible. Semantically, clearly describe each element and their connections. Formally, include various details such as background, colors, line thickness, icon styles, etc. Remember: vague or unclear specifications will only make the generated figure worse, not better.

## INPUT DATA
-   **Target Diagram**: [The generated figure]
-   **Detailed Description**: [The detailed description of the figure]
-   **Methodology Section**: [Contextual content from the methodology section]
-   **Figure Caption**: [Target figure caption]

## OUTPUT
Provide your response strictly in the following JSON format.

```json
{
    "critic_suggestions": "Insert your detailed critique and specific suggestions for improvement here. If the diagram is perfect, write 'No changes needed.'",
    "revised_description": "Insert the fully revised detailed description here, incorporating all your suggestions. If no changes are needed, write 'No changes needed.'",
}
```
"""

PLOT_CRITIC_AGENT_SYSTEM_PROMPT = """
## ROLE
You are a Lead Visual Designer for top-tier AI conferences (e.g., NeurIPS 2025).

## TASK
Your task is to conduct a sanity check and provide a critique of the target plot based on its content and presentation. You must ensure its alignment with the provided 'Raw Data' and 'Visual Intent'.

You are also provided with the 'Detailed Description' corresponding to the current plot. If you identify areas for improvement in the plot, you must list your specific critique and provide a revised version of the 'Detailed Description' that incorporates these corrections.

## CRITIQUE & REVISION RULES

1. Content
    -   **Data Fidelity & Alignment:** Ensure the plot accurately represents all data points from the "Raw Data" and aligns with the "Visual Intent." All quantitative values must be correct. No data should be hallucinated, omitted, or misrepresented.
    -   **Text QA:** Check for typographical errors, nonsensical text, or unclear labels within the plot (axis labels, legend entries, annotations). Suggest specific corrections.
    -   **Validation of Values:** Verify the accuracy of all numerical values, axis scales, and data points. If any values are incorrect or inconsistent with the raw data, provide the correct values.
    -   **Caption Exclusion:** Ensure the figure caption text (e.g., "Figure 1: Performance comparison...") is **not** included within the image visual itself. The caption should remain separate.

2. Presentation
    -   **Clarity & Readability:** Evaluate the overall visual clarity. If the plot is confusing, cluttered, or hard to interpret, suggest structural improvements (e.g., better axis labeling, clearer legend, appropriate plot type).
    -   **Overlap & Layout:** Check for any overlapping elements that reduce readability, such as text labels being obscured by heavy hatching, grid lines, or other chart elements (e.g., pie chart labels inside dark slices). If overlaps exist, suggest adjusting element positions (e.g., moving labels outside the chart, using leader lines, or adjusting transparency).
    -   **Legend Management:** Be aware that the description&plot may include a text-based legend explaining symbols or colors. Since this is typically redundant in well-designed plots, please excise such descriptions if found.

3. Handling Generation Failures
    -   **Invalid Plot:** If the target plot is missing or replaced by a system notice (e.g., "[SYSTEM NOTICE]"), it means the previous description generated invalid code.
    -   **Action:** You must carefully analyze the "Detailed Description" for potential logical errors, complex syntax, or missing data references.
    -   **Revision:** Provide a simplified and robust version of the description to ensure it can be correctly rendered. Do not just repeat the same description.

## INPUT DATA
-   **Target Plot**: [The generated plot]
-   **Detailed Description**: [The detailed description of the plot]
-   **Raw Data**: [The raw data to be visualized]
-   **Visual Intent**: [Visual intent of the desired plot]

## OUTPUT
Provide your response strictly in the following JSON format.

```json
{
    "critic_suggestions": "Insert your detailed critique and specific suggestions for improvement here. If the plot is perfect, write 'No changes needed.'",
    "revised_description": "Insert the fully revised detailed description here, incorporating all your suggestions. If no changes are needed, write 'No changes needed.'",
}
```
"""


# ==========================================
# WORKERS AND UTILS
# ==========================================


def execute_plot_code_worker(code_text: str) -> str:
    """
    Independent plot code execution worker:
    1. Extract code
    2. Execute plotting
    3. Return JPEG as Base64 string
    """
    match = re.search(r"```python(.*?)```", code_text, re.DOTALL)
    code_clean = match.group(1).strip() if match else code_text.strip()

    plt.switch_backend("Agg")
    plt.close("all")
    plt.rcdefaults()

    try:
        exec_globals = {}
        exec(code_clean, exec_globals)
        if plt.get_fignums():
            buf = io.BytesIO()
            plt.savefig(buf, format="jpeg", bbox_inches="tight", dpi=300)
            plt.close("all")

            buf.seek(0)
            img_bytes = buf.read()
            return base64.b64encode(img_bytes).decode("utf-8")
        else:
            return None

    except Exception as e:
        print(f"Error executing plot code: {e}")
        return None


def identity_parse(response: str):
    return response


# ==========================================
# FULL PIPELINE AGENT STEPS
# ==========================================


def retrieve_few_shot_examples(
    task_name: str,
    raw_content: str,
    description: str,
    model_name: str = "gemini-3.1-pro-preview",
) -> List[Dict]:
    """
    Retrieves Top-10 relevant examples from PaperBanana reference dataset.
    """
    if task_name == "plot":
        system_prompt = PLOT_RETRIEVER_AGENT_SYSTEM_PROMPT
        target_labels = ["Visual Intent", "Raw Data"]
        candidate_labels = ["Plot ID", "Visual Intent", "Raw Data"]
        candidate_type = "Plot"
        output_key = "top10_plots"
        limit = None
    else:
        system_prompt = DIAGRAM_RETRIEVER_AGENT_SYSTEM_PROMPT
        target_labels = ["Caption", "Methodology section"]
        candidate_labels = ["Diagram ID", "Caption", "Methodology section"]
        candidate_type = "Diagram"
        output_key = "top10_diagrams"
        limit = 200

    ref_file = os.path.join(PB_DIR, f"data/PaperBananaBench/{task_name}/ref.json")
    if not os.path.exists(ref_file):
        print(f"Warn: {ref_file} not found. Proceeding without few-shot.")
        return []

    with open(ref_file, "r", encoding="utf-8") as f:
        candidate_pool = json.load(f)
        if limit:
            candidate_pool = candidate_pool[:limit]

    user_prompt = f"**Target Input**\n- {target_labels[0]}: {description}\n- {target_labels[1]}: {raw_content}\n\n**Candidate Pool**\n"

    for idx, item in enumerate(candidate_pool):
        user_prompt += f"Candidate {candidate_type} {idx+1}:\n"
        user_prompt += f"- {candidate_labels[0]}: {item['id']}\n"
        user_prompt += f"- {candidate_labels[1]}: {item.get('visual_intent', item.get('caption', ''))}\n"
        user_prompt += f"- {candidate_labels[2]}: {str(item.get('content', ''))}\n\n"

    user_prompt += "Now, based on the Target Input and the Candidate Pool, select the Top 10 most relevant examples."

    response_dict = call_gemini_with_contents(
        contents=[
            types.Part.from_text(text=system_prompt),
            types.Part.from_text(text=user_prompt),
        ],
        model_name=model_name,
        result_parsing_func=identity_parse,
    )

    raw_response = response_dict["parsed_response"].strip()
    try:
        parsed = json_repair.loads(raw_response)
        retrieved_ids = parsed.get(output_key, [])
    except Exception as e:
        print(f"Warning: Failed to parse retrieval result: {e}")
        retrieved_ids = []

    id_to_item = {item["id"]: item for item in candidate_pool}
    examples = [id_to_item[ref_id] for ref_id in retrieved_ids if ref_id in id_to_item]
    return examples


def generate_figure_caption(
    task_name: str,
    raw_content: str,
    description: str,
    figure_desc: str,
    base64_image: str = None,
    model_name: str = "gemini-3.1-pro-preview",
) -> str:
    """
    Generates a caption for the figure based on its final description and context.
    Requirements:
    - The caption should be concise and informative, and can be directly used as a caption for academic papers.
    - The caption should NOT contain "Figure X:" prefix, as the latex template will add it automatically.
    - The caption should NOT contain any markdown formatting, it should be a plain text.
    """
    prompt = f"""
    ## INPUT DATA
    -   Task Type: {task_name}
    -   Contextual Section: {raw_content}
    -   Overall Figure Intent: {description}
    -   Detailed Figure Description: {figure_desc}
    
    Please provide the final caption for this figure based on the system instructions.
    Requirements:
    - The caption should be concise and informative, and can be directly used as a caption for academic papers.
    - The caption MUST NOT contain a "Figure X:" or "Caption X:" prefix, as the latex template will add it automatically.
    - The caption MUST NOT contain any markdown formatting (like bold, italics, etc), it should be plain text.
    
    Respond with the plain text caption only.
    """

    generation_configs = {
        "temperature": 0.5,
    }

    if base64_image and len(base64_image) > 100:
        contents = [
            types.Part.from_text(text=prompt),
            types.Part.from_bytes(
                data=base64.b64decode(base64_image), mime_type="image/jpeg"
            ),
        ]
        response_dict = call_gemini_with_contents(
            contents=contents,
            model_name=model_name,
            result_parsing_func=identity_parse,
            generation_configs=generation_configs,
            check_parsed_response_not_none=True,
        )
    else:
        response_dict = call_gemini_with_text_prompt(
            prompt=prompt,
            model_name=model_name,
            result_parsing_func=identity_parse,
            generation_configs=generation_configs,
            check_parsed_response_not_none=True,
        )

    res = response_dict.get("parsed_response", "")
    if res.startswith("Caption:"):
        res = res.replace("Caption:", "").strip()
    elif res.startswith("**Caption:**"):
        res = res.replace("**Caption:**", "").strip()

    return res


def predict_figure_content(
    task_name: str,
    raw_content: str,
    description: str,
    examples: List[Dict],
    model_name: str = "gemini-3.1-pro-preview",
) -> str:
    """
    Predicts the detailed figure description using LLM and few-shot examples.
    """
    if task_name == "plot":
        system_prompt = PLOT_PLANNER_AGENT_SYSTEM_PROMPT
        content_label = "Plot Raw Data"
        visual_intent_label = "Visual Intent of the Desired Plot"
    else:
        system_prompt = DIAGRAM_PLANNER_AGENT_SYSTEM_PROMPT
        content_label = "Methodology Section"
        visual_intent_label = "Diagram Caption"

    user_prompt = ""
    contents = [types.Part.from_text(text=system_prompt)]

    for idx, item in enumerate(examples):
        user_prompt += f"Example {idx+1}:\n"

        item_content = item["content"]
        if isinstance(item_content, (dict, list)):
            item_content = json.dumps(item_content)

        user_prompt += f"{content_label}: {item_content}\n"
        user_prompt += f"{visual_intent_label}: {item.get('visual_intent', item.get('caption', ''))}\nReference {task_name.capitalize()}: "
        contents.append(types.Part.from_text(text=user_prompt))

        # Resolve related image base64
        image_path = os.path.join(
            PB_DIR, f"data/PaperBananaBench/{task_name}", item["path_to_gt_image"]
        )
        if os.path.exists(image_path):
            with open(image_path, "rb") as f:
                ref_image_base64 = base64.b64encode(f.read()).decode("utf-8")
                contents.append(
                    types.Part.from_bytes(
                        data=base64.b64decode(ref_image_base64), mime_type="image/jpeg"
                    )
                )

        user_prompt = ""

    user_prompt += f"Now, based on the following {content_label.lower()} and {visual_intent_label.lower()}, provide a detailed description for the figure to be generated.\n"
    user_prompt += (
        f"{content_label}: {raw_content}\n{visual_intent_label}: {description}\n"
    )
    user_prompt += "Detailed description of the target figure to be generated"
    if task_name == "diagram":
        user_prompt += " (do not include figure titles)"
    user_prompt += ":"

    contents.append(types.Part.from_text(text=user_prompt))

    response_dict = call_gemini_with_contents(
        contents=contents,
        model_name=model_name,
        result_parsing_func=identity_parse,
    )
    return response_dict["parsed_response"].strip()


def style_figure_content(
    task_name: str,
    raw_content: str,
    description: str,
    figure_desc: str,
    model_name: str = "gemini-3.1-pro-preview",
) -> str:
    """
    Refines the basic figure description into a professionally styled description.
    """
    if task_name == "plot":
        system_prompt = PLOT_STYLIST_AGENT_SYSTEM_PROMPT
        context_labels = ["Raw Data", "Visual Intent of the Desired Plot"]
    else:
        system_prompt = DIAGRAM_STYLIST_AGENT_SYSTEM_PROMPT
        context_labels = ["Methodology Section", "Diagram Caption"]

    style_guide_path = os.path.join(
        PB_DIR, f"style_guides/neurips2025_{task_name}_style_guide.md"
    )
    style_guide = ""
    if os.path.exists(style_guide_path):
        with open(style_guide_path, "r", encoding="utf-8") as f:
            style_guide = f.read()

    user_prompt = (
        f"Detailed Description: {figure_desc}\nStyle Guidelines: {style_guide}\n"
    )
    user_prompt += f"{context_labels[0]}: {raw_content}\n"
    user_prompt += f"{context_labels[1]}: {description}\nYour Output:"

    response_dict = call_gemini_with_contents(
        contents=[
            types.Part.from_text(text=system_prompt),
            types.Part.from_text(text=user_prompt),
        ],
        model_name=model_name,
        result_parsing_func=identity_parse,
    )
    return response_dict["parsed_response"].strip()


def critique_and_revise_figure(
    task_name: str,
    raw_content: str,
    description: str,
    figure_desc: str,
    base64_image: str,
    round_idx: int,
    model_name: str = "gemini-3.1-pro-preview",
) -> Tuple[str, str]:
    """
    Critiques the generated figure and provides revised descriptions.
    """
    if task_name == "plot":
        system_prompt = PLOT_CRITIC_AGENT_SYSTEM_PROMPT
        critique_target = "Target Plot for Critique:"
        context_labels = ["Raw Data", "Visual Intent"]
    else:
        system_prompt = DIAGRAM_CRITIC_AGENT_SYSTEM_PROMPT
        critique_target = "Target Diagram for Critique:"
        context_labels = ["Methodology Section", "Figure Caption"]

    contents = [
        types.Part.from_text(text=system_prompt),
        types.Part.from_text(text=critique_target),
    ]

    if base64_image and len(base64_image) > 100:
        contents.append(
            types.Part.from_bytes(
                data=base64.b64decode(base64_image), mime_type="image/jpeg"
            )
        )
    else:
        contents.append(
            types.Part.from_text(
                text="\n[SYSTEM NOTICE] The plot image could not be generated based on the current description (likely due to invalid code). Please check the description for errors (e.g., syntax issues, missing data) and provide a revised version."
            )
        )

    user_prompt = f"\nDetailed Description: {figure_desc}\n{context_labels[0]}: {raw_content}\n{context_labels[1]}: {description}\nYour Output:"
    contents.append(types.Part.from_text(text=user_prompt))

    response_dict = call_gemini_with_contents(
        contents=contents,
        model_name=model_name,
        result_parsing_func=identity_parse,
    )

    cleaned_response = (
        response_dict["parsed_response"]
        .replace("```json", "")
        .replace("```", "")
        .strip()
    )
    try:
        eval_result = json_repair.loads(cleaned_response)
        if not isinstance(eval_result, dict):
            eval_result = {}
    except Exception as e:
        eval_result = {}

    critic_suggestions = eval_result.get("critic_suggestions", "No changes needed.")
    revised_description = eval_result.get("revised_description", "No changes needed.")

    if revised_description.strip() == "No changes needed.":
        revised_description = figure_desc

    return revised_description, critic_suggestions


def generate_figure_visuals(
    task_name: str,
    figure_description: str,
    model_name: str = "gemini-3.1-pro-preview",
    image_model_name: str = "gemini-3-pro-image-preview",
    aspect_ratio: str = "16:9",
) -> str:
    """
    Generates the figure based on the task type.
    """
    if task_name == "plot":
        prompt_text = f"Use python matplotlib to generate a statistical plot based on the following detailed description: {figure_description}\n Only provide the code without any explanations. Code:"
        contents = [
            types.Part.from_text(text=PLOT_VISUALIZER_AGENT_SYSTEM_PROMPT),
            types.Part.from_text(text=prompt_text),
        ]
        response_dict = call_gemini_with_contents(
            contents=contents,
            model_name=model_name,
            result_parsing_func=identity_parse,
        )
        code_text = response_dict["parsed_response"]
        base64_img = execute_plot_code_worker(code_text)
        return base64_img
    else:
        # Prompt for diagram image generation
        prompt_text = f"Render an image based on the following detailed description: {figure_description}\n Note that do not include figure titles in the image. Diagram: "

        return generate_image_with_gemini(
            model_name=image_model_name,
            prompt=prompt_text,
            aspect_ratio=aspect_ratio,
            generation_configs={
                "system_instruction": DIAGRAM_VISUALIZER_AGENT_SYSTEM_PROMPT
            },
        )

