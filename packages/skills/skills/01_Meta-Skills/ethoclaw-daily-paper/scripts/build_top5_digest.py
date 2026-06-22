#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


REQUIRED_AGENT_FIELDS =[
    "title",
    "summary",
    "selection_reason",
]


def parse_index_list(raw_value):
    values =[]
    for chunk in (raw_value or "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            values.append(int(chunk))
        except ValueError as exc:
            raise SystemExit(f"Invalid paper index: {chunk}") from exc
    return values


def join_authors(authors, limit=10):
    if not authors:
        return "Unknown"
    return ", ".join(authors[:limit])


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def selected_papers_from_merged(merged_payload, selected_indexes):
    items = merged_payload.get("items",[])
    if not items:
        raise SystemExit("Merged input contains no papers.")

    selected_papers =[]
    seen = set()
    for slot, candidate_index in enumerate(selected_indexes, start=1):
        if candidate_index in seen:
            raise SystemExit(f"Duplicate candidate index: {candidate_index}")
        seen.add(candidate_index)

        zero_based = candidate_index - 1
        if zero_based < 0 or zero_based >= len(items):
            raise SystemExit(f"Candidate index out of range: {candidate_index}")

        item = items[zero_based]
        selected_papers.append(
            {
                "slot": slot,
                "candidate_index": candidate_index,
                "title": item.get("title", ""),
                "source": item.get("source_label") or item.get("source", "unknown"),
                "authors": item.get("authors", []),
                "published": item.get("published", "")[:10],
                "journal": item.get("journal", ""),
                "url": item.get("url", ""),
                "pdf_url": item.get("pdf_url", ""),
                "abstract": item.get("summary", ""),
                "weighted_score": item.get("weighted_score", item.get("relevance_score", "")),
                "title": "",
                "summary": "",
                "selection_reason": "",
            }
        )
    return selected_papers


def build_agent_packet(merged_payload, selected_indexes):
    return {
        "generated_at": merged_payload.get("generated_at", ""),
        "candidate_count": merged_payload.get("count", 0),
        "selected_indexes": selected_indexes,
        "selection_policy": {
            "rank_on_titles_only": True,
            "draft_from_title_and_abstract": True,
            "draft_in_single_session": True,
        },
        "agent_guidance": {
            "goal": "First filter the Top 5 by looking only at candidate titles, then read the English titles and abstracts one by one in the same session, and write the  titles and  summaries.",
            "recommended_process":[
                "First, read candidate_titles.md and determine the Top 5 based solely on the titles.",
                "After determining the Top 5, read the titles and English abstracts of these 5 papers. Do not re-read the full candidate pool.",
                "Complete the  title, selection reason, and  summary one by one.",
                "Write the  summary in one or a few natural paragraphs without using subheadings, but ensure the content covers the background, methods, findings, significance, and limitations.",
                "Write the content directly into the final Markdown, or fill in the JSON first and then render the Markdown.",
            ],
            "required_sections": [
                "title",
                "summary",
                "selection_reason",
            ],
            "style_rules":[
                "The  summary must cover the background, methods, findings, significance, and limitations. Do not just write a generic abstract.",
                "Do not split the  summary with subheadings like 'Background/Methods/Findings'. Use natural paragraph breaks to improve readability.",
                "Prioritize retaining key information such as species, brain regions, behavioral paradigms, and recording or manipulation methods.",
                "Explicitly state limitations when the abstract lacks sufficient evidence; do not fabricate information.",
            ],
        },
        "selected_papers": selected_papers_from_merged(merged_payload, selected_indexes),
    }


def render_agent_review_markdown(packet):
    lines =[
        "# Top 5 Review Packet",
        "",
        f"- Generated At: {packet.get('generated_at', '')}",
        f"- Candidate Count: {packet.get('candidate_count', 0)}",
        f"- Selected Indexes: {', '.join(str(value) for value in packet.get('selected_indexes', []))}",
        "",
        "> First complete the Top 5 screening using only titles. Once selected, read only the English titles and abstracts of these 5 papers, and complete the  summaries in the same session.",
        "",
    ]

    guidance = packet.get("agent_guidance", {})
    if guidance:
        lines.extend([
                "## Packet Guidance",
                "",
                f"- Goal: {guidance.get('goal', '')}",
                "- Recommended Process:",
            ]
        )
        for step in guidance.get("recommended_process",[]):
            lines.append(f"  - {step}")
        lines.append("- Style Rules:")
        for rule in guidance.get("style_rules",[]):
            lines.append(f"  - {rule}")
        lines.extend(["", "## Required JSON Fields", ""])
        for field in guidance.get("required_sections",[]):
            lines.append(f"- {field}")
        lines.append("")

    for paper in packet.get("selected_papers",[]):
        lines.extend(
            [
                f"## Slot {paper['slot']}: {paper.get('title', '').strip() or '(untitled)'}",
                "",
                f"- Candidate Index: {paper['candidate_index']}",
                f"- Source: {paper.get('source', 'unknown')}",
                f"- Authors: {join_authors(paper.get('authors',[]))}",
                f"- Published: {paper.get('published', '') or 'Unknown'}",
                f"- Journal: {paper.get('journal') or 'Unknown'}",
                f"- URL: {paper.get('url') or 'N/A'}",
                f"- PDF URL: {paper.get('pdf_url') or 'N/A'}",
                f"- Weighted Score: {paper.get('weighted_score', 'N/A')}",
                "",
                "### Title + Abstract",
                "",
                f"- English Title: {paper.get('title', '').strip() or '(untitled)'}",
                "",
                paper.get("abstract", "").strip() or "No abstract available.",
                "",
                "### JSON Fields To Fill",
                "",
                "- title:",
                "- summary:",
                "- selection_reason:",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def render_paper_block(paper):
    return "\n".join(
        [
            f"## {paper['slot']}. {paper.get('title', '').strip() or '(untitled)'}",
            "",
            f"- Title: {paper.get('title', '').strip() or 'To be added'}",
            f"- Source: {paper.get('source', 'unknown')}",
            f"- Authors: {join_authors(paper.get('authors',[]))}",
            f"- Published: {paper.get('published', '') or 'Unknown'}",
            f"- Selection Reason: {paper.get('selection_reason', '').strip() or 'To be added'}",
            f"- URL: {paper.get('url') or 'N/A'}",
            f"- PDF URL: {paper.get('pdf_url') or 'N/A'}",
            "",
            "### Summary",
            "",
            paper.get("summary", "").strip() or "To be added",
            "",
            "### Original Abstract",
            "",
            paper.get("abstract", "").strip() or "No abstract available",
            "",
        ]
    )


def render_final_markdown(template_text, packet, generator_label):
    papers_blocks =[render_paper_block(paper) for paper in packet.get("selected_papers", [])]
    return (
        template_text.replace("{{generated_at}}", packet.get("generated_at", ""))
        .replace("{{candidate_count}}", str(packet.get("candidate_count", 0)))
        .replace("{{generator_label}}", generator_label)
        .replace("{{papers}}", "\n".join(papers_blocks).strip())
        .rstrip()
        + "\n"
    )


def render_direct_markdown(merged_payload, selected_indexes, template_text, generator_label):
    packet = {
        "generated_at": merged_payload.get("generated_at", ""),
        "candidate_count": merged_payload.get("count", 0),
        "selected_papers": selected_papers_from_merged(merged_payload, selected_indexes),
    }
    return render_final_markdown(template_text, packet, generator_label)


def ensure_agent_fields(packet):
    papers = packet.get("selected_papers",[])
    if not papers:
        raise SystemExit("Agent packet contains no selected papers.")
    for paper in papers:
        for field in REQUIRED_AGENT_FIELDS:
            if not str(paper.get(field, "")).strip():
                raise SystemExit(f"Missing `{field}` for slot {paper.get('slot', '?')}.")


def write_output(path_str, content):
    output_path = Path(path_str).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    print(output_path)


def default_template_path():
    return Path(__file__).resolve().parents[1] / "assets" / "top5_digest_template.md"


def main():
    parser = argparse.ArgumentParser(description="Prepare or render a Top 5 neuroethology digest without calling an API.")
    parser.add_argument("--input", default="", help="Merged JSON generated by merge_results.py")
    parser.add_argument("--paper-indexes", default="", help="Comma-separated candidate indexes chosen by the agent")
    parser.add_argument("--agent-json-output", default="", help="Write the agent packet JSON here")
    parser.add_argument("--review-md-output", default="", help="Write the review packet Markdown here")
    parser.add_argument("--from-agent-json", default="", help="Render final digest from a completed agent packet JSON")
    parser.add_argument("--direct-md-output", default="", help="Render a final Markdown skeleton directly from merged JSON and selected indexes")
    parser.add_argument("--output", default="", help="Final Markdown output path when using --from-agent-json")
    parser.add_argument("--template", default="", help="Markdown template path")
    parser.add_argument("--generator-label", default="same-agent", help="Label recorded in the final Markdown")
    args = parser.parse_args()

    template_path = Path(args.template) if args.template else default_template_path()
    template_text = template_path.read_text(encoding="utf-8")

    if args.from-agent_json:
        if not args.output:
            raise SystemExit("`--output` is required when using `--from-agent-json`.")
        packet = load_json(args.from-agent_json)
        ensure_agent_fields(packet)
        markdown = render_final_markdown(template_text, packet, args.generator_label)
        write_output(args.output, markdown)
        return

    if args.direct_md_output:
        if not args.input:
            raise SystemExit("`--input` is required when using `--direct-md-output`.")
        if not args.paper_indexes:
            raise SystemExit("`--paper-indexes` is required when using `--direct-md-output`.")
        merged_payload = load_json(args.input)
        selected_indexes = parse_index_list(args.paper_indexes)
        markdown = render_direct_markdown(merged_payload, selected_indexes, template_text, args.generator_label)
        write_output(args.direct_md_output, markdown)
        return

    if not args.input:
        raise SystemExit("`--input` is required when preparing an agent packet.")
    if not args.paper_indexes:
        raise SystemExit("`--paper-indexes` is required when preparing an agent packet.")
    if not args.agent_json_output and not args.review_md_output:
        raise SystemExit("Provide at least one of `--agent-json-output` or `--review-md-output`.")

    merged_payload = load_json(args.input)
    selected_indexes = parse_index_list(args.paper_indexes)
    packet = build_agent_packet(merged_payload, selected_indexes)

    if args.agent_json_output:
        json_output_path = Path(args.agent_json_output).expanduser().resolve()
        json_output_path.parent.mkdir(parents=True, exist_ok=True)
        json_output_path.write_text(json.dumps(packet, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json_output_path)

    if args.review_md_output:
        review_output_path = Path(args.review_md_output).expanduser().resolve()
        review_output_path.parent.mkdir(parents=True, exist_ok=True)
        review_output_path.write_text(render_agent_review_markdown(packet), encoding="utf-8")
        print(review_output_path)


if __name__ == "__main__":
    main()
