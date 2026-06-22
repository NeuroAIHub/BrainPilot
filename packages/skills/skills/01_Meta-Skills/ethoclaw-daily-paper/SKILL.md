---
name: ethoclaw-daily-paper
description: "Search arXiv and PubMed for research papers, rank candidates by title only, then read the title and abstract of the selected Top 5 in a single session and write a Markdown digest directly."
---

# Top 5 Digest

Use the bundled scripts. Prefer a single-session workflow.

## Default operating mode

The default flow is:

1. Run retrieval once.
2. Read `candidate_titles.md` only and choose Top 5 by title.
3. After Top 5 is fixed, read only those 5 papers' titles and abstracts.
4. Write or render the final Markdown directly.

Do not default to a parent session plus sub-session split.
Do not default to reading the full candidate pool for ranking.
Do not default to building large intermediate review artifacts unless the user asks.

## Required output style

For each selected paper, the output should include:

- title
- selection reason
- one digest block

That single digest block should still cover the background, methods, main findings, significance, and limitations, but it should be written as one continuous explanation. You may use natural paragraph breaks for readability.

The digest should be written from the English title and abstract. If the abstract is not enough to support a strong claim, say so explicitly inside the digest.

## Recommended single-session workflow

1. Review `assets/config.template.yaml` only if the user wants narrower or broader coverage.
2. Run:

```bash
<python3-interpreter> scripts/run_pipeline.py --output-dir ./runs/20260318-daily/work
```

3. Read:
   - `work/candidate_titles.md`

4. Choose Top 5 using titles only.

5. Render a direct final-digest skeleton from the selected indexes:

```bash
<python3-interpreter> scripts/build_top5_digest.py \
  --input ./runs/20260318-daily/work/merged.json \
  --paper-indexes 1,2,3,4,5 \
  --direct-md-output ./runs/20260318-daily/work/final_digest.md \
  --generator-label same-agent
```

6. Open `work/final_digest.md`.

7. For each selected paper:
   - read the English title already present in the section header
   - read the English abstract already embedded in that section
   - write the title, selection reason, and a single digest block directly into the same Markdown file

8. When complete, copy the Markdown into the desired output path.

## Optional JSON workflow

If you still want a structured intermediate packet, use:

```bash
<python3-interpreter> scripts/build_top5_digest.py \
  --input ./runs/20260318-daily/work/merged.json \
  --paper-indexes 1,2,3,4,5 \
  --agent-json-output ./runs/20260318-daily/work/top5_agent_packet.json \
  --review-md-output ./runs/20260318-daily/work/top5_agent_packet.md
```

Then fill the JSON and render:

```bash
<python3-interpreter> scripts/build_top5_digest.py \
  --from-agent-json ./runs/20260318-daily/work/top5_agent_packet.json \
  --output ./runs/20260318-daily/work/final_digest.md \
  --generator-label same-agent
```

Use this only when a structured intermediate artifact is genuinely helpful.

## Resources

### `scripts/run_pipeline.py`

- One-shot retrieval entry point.
- Writes `arxiv.json`, `pubmed.json`, `merged.json`, `candidate_pool.md`, and `candidate_titles.md`.
- `candidate_titles.md` is the default ranking surface.

### `scripts/build_top5_digest.py`

- Builds an optional structured packet for the selected papers.
- Can render the final digest from a completed packet.
- Can now also render a final Markdown skeleton directly from `merged.json` and selected indexes with `--direct-md-output`.

### `assets/top5_digest_template.md`

- Final Markdown wrapper.
- Keep placeholder names unchanged unless the rendering script changes too.

### `assets/config.template.yaml`

- Tune queries, include keywords, exclude keywords, and source weights.

## Writing guidance

When drafting the digest:

- keep the wording precise rather than promotional
- preserve species, brain regions, behavioral paradigms, and recording or manipulation methods when available
- make findings concrete rather than generic
- explain why the paper matters for neuroethology or behavioral neuroscience
- call out uncertainty when the abstract alone is insufficient
- do not split the digest with subsection headings; if needed, use one or two natural paragraph breaks only

## Notes

- Use any working Python 3 interpreter on the current machine. On some Windows setups this may be a full interpreter path rather than `python3`.
- Keep PubMed weighting above arXiv when published papers should outrank preprints.
- The time-consuming part is usually agent writing, not retrieval, so keep ranking title-only unless the user asks for deeper triage.
- Do not call an external summarization API.
