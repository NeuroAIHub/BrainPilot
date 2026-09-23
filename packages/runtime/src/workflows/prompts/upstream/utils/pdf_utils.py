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

import os
import subprocess
import json
import shutil
import rich
import traceback
import subprocess
import os.path as osp

import pymupdf4llm  # type: ignore
import pymupdf  # type: ignore
import numpy as np
import cv2
from pypdf import PdfReader  # type: ignore


def load_paper(pdf_path, num_pages=None, min_size=100):
    try:
        doc = pymupdf.open(pdf_path)
        if num_pages:
            doc = doc[:num_pages]
        text = ""
        for page in doc:
            text += page.get_text()
        if len(text) < min_size:
            raise Exception("Text too short")
    except Exception as e:
        print(f"Error with pymupdf, falling back to pypdf: {e}")
        reader = PdfReader(pdf_path)
        if num_pages is None:
            pages = reader.pages
        else:
            pages = reader.pages[:num_pages]
        text = "".join(page.extract_text() for page in pages)
        if len(text) < min_size:
            raise Exception("Text too short")
    return text


def has_blacklist_words(text: str):
    blacklists = ["corresponding author"]
    for word in blacklists:
        if word in text.lower():
            return True
    return False


def parse_sections(json_data, output_folder=""):
    if not output_folder:
        output_folder = os.path.dirname(json_data)

    output_path = os.path.join(output_folder, "paper_sections.json")
    section_results = []

    if "abstractText" in json_data:
        abstract_data = json_data["abstractText"]["text"]
        if abstract_data.startswith("Abstract"):
            abstract_data = abstract_data[len("Abstract") :]
        section_results.append({"title": "Abstract", "content": abstract_data})

    section_data = json_data["sections"]
    for section in section_data:
        title = section["title"]["text"] if "title" in section else None

        content = ""
        for para in section["paragraphs"]:
            if has_blacklist_words(para["text"]):
                continue
            content += para["text"]

        if title:
            section_results.append({"title": title, "content": content})
        else:
            section_results[-1]["content"] += content

    with open(output_path, "w") as f:
        json.dump(section_results, f, indent=4)
        print(f"Dumped paper sections to {output_path}.")

    return section_results


papaer_text_to_reference_text_prompt_template = """
You are a specialized academic data extraction engine. Your task is to extract the "References" or "Bibliography" section from the raw text of a research paper and return it in a specific single-line string format.

### INPUT DATA
You will receive raw text extracted from a PDF. This text may contain:
- Noise (headers, footers, page numbers).
- Arbitrary line breaks (sentences broken across lines).
- The body of the paper followed by the references.

### INSTRUCTIONS
1. **Locate:** Find the start of the "References" or "Bibliography" section. Ignore all text preceding this section.
2. **Extract:** Identify individual reference entries. These typically start with bracketed numbers (e.g., [1], [2]) or bare numbers (1., 2.).
3. **Clean:** - Merge multi-line citations into a single line. 
   - Remove any page numbers or running headers that interrupt a citation.
4. **Format:** Output the citations as a single continuous string. Ensure every citation starts with its bracketed ID (e.g., `[1]`). If the source text uses `1.` format, convert it to `[1]`.

### OUTPUT FORMAT
Your output must be a single string containing ONLY the references, formatted exactly as follows:
"[1] First citation text [2] Second citation text [3] Third citation text [4] ... "

### CONSTRAINTS
- Do NOT output JSON, Markdown lists, or XML.
- Do NOT output the word "References" or "Bibliography" at the start.
- Do NOT output any conversational text (e.g., "Here are the references").
- Do NOT change the content/wording of the citation titles or authors, only clean up the whitespace.

Here is the paper text:
[PAPER CONTENT]
{paper_text}
[END PAPER CONTENT]
"""


def extract_reference_from_pdf_text(
    paper_text: str, model_name: str = "gemini-3.1-pro-preview"
) -> str:
    from utils.llm_backend_utils import call_llm_with_text_prompt

    instructions = papaer_text_to_reference_text_prompt_template.format(
        paper_text=paper_text
    )
    response_dict = call_llm_with_text_prompt(
        prompt=instructions,
        model_name=model_name,
        check_parsed_response_not_none=False,
        return_json=False,
    )
    return response_dict["raw_response"].strip()


def get_paper_references_from_pdf(
    pdf_path: str, model_name: str = "gemini-3.1-pro-preview"
):
    try:
        paper_text = load_paper(pdf_path)
        reference_text = extract_reference_from_pdf_text(
            paper_text, model_name=model_name
        )
        if reference_text:
            return reference_text
        else:
            print(
                f"Method 2: Failed to extract references from {pdf_path}.\nReturn None for refernces."
            )
    except Exception as e:
        print(
            f"Method 2: Failed to extract references from {pdf_path} due to {str(e)}.\nReturn None for refernces."
        )

    return None


def compile_latex(cwd, pdf_file, texfile_name="template", timeout=30):
    import os, shutil, subprocess, traceback, rich

    source_pdf = os.path.join(cwd, f"{texfile_name}.pdf")
    if os.path.exists(source_pdf):
        os.remove(source_pdf)

    env = dict(os.environ)
    for var in ["TEXINPUTS", "TEXMFHOME", "TEXMF", "TEXMFVAR", "TEXMFCONFIG"]:
        env.pop(var, None)

    commands = [
        ["pdflatex", "-interaction=nonstopmode", f"{texfile_name}.tex"],
        ["bibtex", texfile_name],
        ["pdflatex", "-interaction=nonstopmode", f"{texfile_name}.tex"],
        ["pdflatex", "-interaction=nonstopmode", f"{texfile_name}.tex"],
    ]

    execution_logs = []

    for command in commands:
        cmd_str = " ".join(command)
        try:
            result = subprocess.run(
                command,
                cwd=cwd,
                capture_output=True,  # Captures stdout/stderr silently
                text=True,
                timeout=timeout,
                env=env,
            )

            execution_logs.append(
                {
                    "cmd": cmd_str,
                    "returncode": result.returncode,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                }
            )

        except subprocess.TimeoutExpired:
            execution_logs.append(
                {"cmd": cmd_str, "error": f"TIMEOUT after {timeout}s"}
            )
        except Exception as e:
            execution_logs.append({"cmd": cmd_str, "error": str(e)})

    has_timeout = any(
        "error" in log and "TIMEOUT" in log["error"] for log in execution_logs
    )

    if os.path.exists(source_pdf) and not has_timeout:
        try:
            shutil.move(source_pdf, pdf_file)
        except Exception:
            rich.print(f"[bold red]Error moving generated PDF to {pdf_file}[/bold red]")
            print(traceback.format_exc())
    else:
        rich.print(
            f"\n[bold red]❌ PDF Generation Failed (No PDF file produced)[/bold red]"
        )

        for log in execution_logs:
            if "error" in log:
                header_color = "red"
            elif log["returncode"] == 0:
                header_color = "green"
            else:
                header_color = "yellow"  # Warning/Error

            rich.print(
                f"\n[bold {header_color}]---> Ran: {log['cmd']}[/bold {header_color}]"
            )

            if "error" in log:
                rich.print(f"[bold red]SYSTEM ERROR: {log['error']}[/bold red]")
            else:
                if log["stdout"].strip():
                    rich.print(f"[dim]{log['stdout'].strip()}[/dim]")
                if log["stderr"].strip():
                    rich.print(f"[red]{log['stderr'].strip()}[/red]")


def pdf_to_grid_images(pdf_path, output_dir, scale=2.0):
    """Converts a PDF to 2x2 grid images of its pages.
    Returns a list of paths to the generated grid images.
    """
    doc = pymupdf.open(pdf_path)
    os.makedirs(output_dir, exist_ok=True)

    mat = pymupdf.Matrix(scale, scale)
    pixmaps = []
    for page in doc:
        pix = page.get_pixmap(matrix=mat)
        pixmaps.append(pix)

    grid_image_paths = []

    for i in range(0, len(pixmaps), 4):
        chunk = pixmaps[i : i + 4]

        img_list = []
        for pix in chunk:
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.h, pix.w, pix.n
            )
            img_list.append(img)

        while len(img_list) < 4:
            ref_img = img_list[0]
            white_img = np.ones_like(ref_img) * 255
            img_list.append(white_img)

        row1 = np.hstack((img_list[0], img_list[1]))
        row2 = np.hstack((img_list[2], img_list[3]))
        grid = np.vstack((row1, row2))

        grid_path = os.path.join(output_dir, f"grid_{i//4 + 1}.png")
        grid_bgr = cv2.cvtColor(grid, cv2.COLOR_RGB2BGR)
        cv2.imwrite(grid_path, grid_bgr)

        grid_image_paths.append(grid_path)

    return grid_image_paths

