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

import argparse
import sys
import os
import shutil
from datetime import datetime


def main():
    parser = argparse.ArgumentParser(
        description="CLI for generating a single paper from the Paper Orchestra pipeline."
    )

    parser.add_argument(
        "--raw_materials_dir",
        required=True,
        help="Directory containing the raw materials (e.g. idea and experimental log).",
    )
    parser.add_argument(
        "--output_dir",
        default=None,
        help="Directory to output the generated paper. If not specified, an automatic folder is created.",
    )
    parser.add_argument(
        "--latex_template_dir",
        required=True,
        help="Directory containing the LaTeX template (e.g. cvpr2025/iclr2025).",
    )
    parser.add_argument(
        "--idea_filename",
        default="idea_sparse.md",
        help="Filename of the idea document within raw_materials. Default: idea_sparse.md",
    )
    parser.add_argument(
        "--experimental_log_filename",
        default="experimental_log.md",
        help="Filename of the experimental log within raw_materials. Default: experimental_log.md",
    )
    parser.add_argument(
        "--writer_model_name",
        default="gemini-3.1-pro-preview",
        help="LLM for writer and literature agents.",
    )
    parser.add_argument(
        "--reflection_model_name",
        default="gemini-3.1-pro-preview",
        help="LLM for reflection agents.",
    )
    parser.add_argument(
        "--research_cutoff",
        default=None,
        help="Year-Month cutoff date for literature review (e.g., 2024-11). If not provided, defaults to current Year-Month.",
    )
    parser.add_argument(
        "--use_plotting",
        type=lambda x: (str(x).lower() in ["true", "1", "yes"]),
        default=False,
        help="Enable plotting agent workflow to generate figures from code.",
    )
    parser.add_argument(
        "--plotting_model_name",
        default="gemini-3.1-pro-preview",
        help="LLM for the plotting agent.",
    )
    parser.add_argument(
        "--image_model_name",
        default="gemini-3-pro-image-preview",
        help="Vision model if required by plotting agent.",
    )
    parser.add_argument(
        "--plotting_max_critic_rounds",
        type=int,
        default=3,
        help="Maximum rounds of self-correction in the plotting agent.",
    )

    args = parser.parse_args()

    if args.research_cutoff is None:
        args.research_cutoff = datetime.now().strftime("%Y-%m")

    if not os.path.exists(args.raw_materials_dir):
        print(
            f"Error: Raw materials directory '{args.raw_materials_dir}' does not exist."
        )
        sys.exit(1)

    if args.output_dir:
        base_dir = args.output_dir
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_dir = f"./paper_output_{timestamp}"

    os.makedirs(base_dir, exist_ok=True)

    target_raw_materials = os.path.join(base_dir, "raw_materials")
    if os.path.abspath(target_raw_materials) != os.path.abspath(args.raw_materials_dir):
        if os.path.exists(target_raw_materials):
            shutil.rmtree(target_raw_materials)
        shutil.copytree(args.raw_materials_dir, target_raw_materials)

    if not args.use_plotting:
        has_figures = False
        figures_dir = os.path.join(args.raw_materials_dir, "figures")
        if os.path.exists(figures_dir):
            for f in os.listdir(figures_dir):
                if f.lower().endswith((".pdf", ".png", ".jpg", ".jpeg")):
                    has_figures = True
                    break

        if not has_figures:
            print("\n" + "=" * 80)
            print(
                f"⚠️ WARNING: No figures (.pdf, .png, .jpg) detected in the {figures_dir} directory."
            )
            print(
                "Since you are running WITHOUT plotting, we are using the provided materials directly."
            )
            print(
                f"Please make sure you provide all necessary figures inside {figures_dir}."
            )
            print("If figures are missing, compilation may fail.")
            print(
                f"If you don't have figures, you can use the plotting agent to generate them by running with --use_plotting."
            )
            print("=" * 80 + "\n")

    if args.use_plotting:
        from methods.paper_writer_with_plotting import write_single_paper

        print(f"🚀 Starting Paper Generation (WITH PLOTTING) in {base_dir}")
        write_single_paper(
            base_dir=base_dir,
            latex_template_dir=args.latex_template_dir,
            idea_filename=args.idea_filename,
            experimental_log_filename=args.experimental_log_filename,
            writer_model_name=args.writer_model_name,
            reflection_model_name=args.reflection_model_name,
            plotting_model_name=args.plotting_model_name,
            image_model_name=args.image_model_name,
            research_cutoff=args.research_cutoff,
            plotting_max_critic_rounds=args.plotting_max_critic_rounds,
        )
    else:
        from methods.paper_writer import write_single_paper

        provided_figures_dir = os.path.join(args.raw_materials_dir, "figures")
        print(
            f"🚀 Starting Paper Generation (WITHOUT PLOTTING), with figures stored in {provided_figures_dir}"
        )
        write_single_paper(
            base_dir=base_dir,
            latex_template_dir=args.latex_template_dir,
            idea_filename=args.idea_filename,
            experimental_log_filename=args.experimental_log_filename,
            writer_model_name=args.writer_model_name,
            reflection_model_name=args.reflection_model_name,
            research_cutoff=args.research_cutoff,
        )


if __name__ == "__main__":
    main()

