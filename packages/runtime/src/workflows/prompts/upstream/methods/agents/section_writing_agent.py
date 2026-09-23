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

"""
This agent takes in a latex file with partially filled sections and fills in the missing sections.

Input:
- outline.json: A JSON file containing the outline of the paper, including section headings and key points to cover in each section.
- template.tex: A LaTeX file with some sections (intro & related work) filled and others missing.
- idea.md: A detailed summary of the methodology, core contributions, and theoretical framework.
- experimental_log.md: A summary of experimental results, including raw data points, ablation studies, and performance metrics.
- conference_guidelines.md: The submission guidelines for the target conference.
- figures: A list of figures to be included in the paper, each with:
  - figure_path: str
  - figure_caption: str

Output:
- completed_paper.tex: The completed LaTeX file with all sections filled in.
"""

import json
from typing import List, Dict

from methods.prompts.section_writing_agent import section_writing_agent_prompt
from utils.gemini_utils import parse_gemini_latex_results
from utils.llm_backend_utils import call_llm_with_images

import json
from typing import List, Dict


class SectionWritingAgent:
    def __init__(
        self,
        outline_path: str,
        template_path: str,
        idea_path: str,
        experimental_log_path: str,
        citation_map_path: str,
        figures_info_path: str,
        guidelines_path: str,
        model_name: str = "gemini-3.1-pro-preview",
    ):

        self.model_name = model_name
        self.system_prompt = section_writing_agent_prompt

        self.outline_path = outline_path
        self.template_path = template_path
        self.idea_path = idea_path
        self.experimental_log_path = experimental_log_path
        self.citation_map_path = citation_map_path
        self.figures_info_path = figures_info_path
        self.guidelines_path = guidelines_path

    def _read_file(self, file_path: str) -> str:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return f"[Error: File {file_path} not found]"

    def _read_json(self, file_path: str) -> Dict:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _format_figures_context(self, figures_info: List[Dict]) -> str:
        """
        Parses the specific figures_info.json format.
        Extracts 'name' -> used as filename (now includes extension).
        Extracts 'caption' -> used as caption.
        """
        if not figures_info:
            return "No figures provided."

        context = "### AVAILABLE FIGURES LIST\n"
        for idx, fig in enumerate(figures_info, 1):
            name = fig.get("name", f"figure_{idx}.jpg")
            if (
                name
                and not name.endswith(".png")
                and not name.endswith(".jpg")
                and not name.endswith(".pdf")
            ):
                name += ".png"
            caption = fig.get("caption", "No caption provided.")

            context += f"Item {idx}:\n"
            context += f"  - Filename: {name}\n"
            context += f"  - Caption: {caption}\n"
            context += "--------------------------------------------------\n"
        return context

    def _format_citation_library(self, citation_map: Dict) -> str:
        if not citation_map:
            return "No citation data provided."

        context = "### REFERENCE LIBRARY (Use these keys for \\cite{})\n"
        for key, data in citation_map.items():
            title = data.get("title", "Unknown Title")
            authors_list = data.get("authors", [])
            authors = ", ".join(authors_list[:3])
            if len(authors_list) > 3:
                authors += " et al."
            year = data.get("year", "N/A")
            abstract = data.get("abstract", "No abstract available.")

            context += f"--- Key: {key} ---\n"
            context += f"Title: {title}\n"
            context += f"Authors: {authors} ({year})\n"
            context += f"Abstract: {abstract}\n\n"
        return context

    def run(self, output_path: str) -> str:
        print(f" > Agent {self.__class__.__name__} starting...")

        try:
            outline_content = self._read_file(self.outline_path)
            template_content = self._read_file(self.template_path)
            idea_content = self._read_file(self.idea_path)
            log_content = self._read_file(self.experimental_log_path)
            guidelines_content = self._read_file(self.guidelines_path)

            citation_map = self._read_json(self.citation_map_path)
            citation_library_content = self._format_citation_library(citation_map)

            figures_info = self._read_json(self.figures_info_path)
            figures_content = self._format_figures_context(figures_info)

            import os

            figures_dir = os.path.dirname(self.figures_info_path)
            image_paths = []
            if figures_info:
                for fig in figures_info:
                    name = fig.get("name", "")
                    if name:
                        if (
                            not name.endswith(".png")
                            and not name.endswith(".jpg")
                            and not name.endswith(".pdf")
                        ):
                            name += ".png"
                        img_path = os.path.join(figures_dir, name)
                        if os.path.exists(img_path) and not name.endswith(
                            ".pdf"
                        ):  # We can only pass raster images, not PDFs, to Vertex Vision
                            image_paths.append(img_path)

        except Exception as e:
            return f"Error reading input files: {str(e)}"

        user_prompt = f"""
Here are the input materials for the paper.

--- INPUT: outline.json (Structure & Citation Candidates) ---
{outline_content}

--- INPUT: citation_map.json (Reference Library) ---
{citation_library_content}

--- INPUT: idea.md (Technical Method Details) ---
{idea_content}

--- INPUT: experimental_log.md (Raw Data for Tables) ---
{log_content}

--- INPUT: figures_list (Available Figure Files) ---
{figures_content}

--- INPUT: conference_guidelines.md ---
{guidelines_content}

--- INPUT: template.tex (DO NOT CHANGE EXISTING TEXT. FILL MISSING SECTIONS.) ---
{template_content}

**INSTRUCTION**: 
1. Identify missing sections in `template.tex`.
2. Generate LaTeX content for those sections based on `outline.json`.
3. Construct tables using data from `experimental_log.md`.
4. Insert figures using the filenames from the 'figures_list' input.
5. Use citations from the Reference Library.
6. Return the **full** compilable LaTeX file.
"""

        print(" > Generating paper content with Multimodal Images...")
        response_dict = call_llm_with_images(
            prompt=user_prompt,
            images=image_paths,
            generation_configs={
                "system_instruction": self.system_prompt,
                "temperature": 0.7,
            },
            model_name=self.model_name,
            result_parsing_func=parse_gemini_latex_results,
            check_parsed_response_not_none=True,
        )
        cleaned_latex = response_dict["parsed_response"]

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(cleaned_latex)

        print(f" > Paper saved to {output_path}")
        return cleaned_latex

