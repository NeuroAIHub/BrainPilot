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

from utils.common_utils import load_md_file
from utils.gemini_utils import call_gemini_with_contents
import json
from google.genai import types  # type: ignore

from methods.prompts.outline_agent import outline_agent_system_prompt


class OutlineAgent:
    def __init__(
        self, model_name: str = "gemini-3.1-pro-preview", cutoff_date: str = "2024-10"
    ):
        self.model_name = model_name
        self.cutoff_date = cutoff_date

    def run(
        self,
        idea_file: str,
        experimental_log_file: str,
        latex_template_file: str,
        conference_guidelines_file: str,
        output_filepath: str = None,
    ):
        contents = [
            types.Part.from_text(
                text=outline_agent_system_prompt.format(cutoff_date=self.cutoff_date)
            ),
            types.Part.from_text(text="'idea.md':\n" + load_md_file(idea_file)),
            types.Part.from_text(
                text="'experimental_log.md':\n" + load_md_file(experimental_log_file)
            ),
            types.Part.from_text(
                text="'template.tex':\n" + load_md_file(latex_template_file)
            ),
            types.Part.from_text(text=load_md_file(conference_guidelines_file)),
        ]
        response_dict = call_gemini_with_contents(
            contents=contents,
            model_name=self.model_name,
        )
        json_result = response_dict["parsed_response"]
        if output_filepath is not None:
            with open(output_filepath, "w") as f:
                json.dump(json_result, f, indent=4)
                print(f"outline.json output written to {output_filepath}")
        return json_result

