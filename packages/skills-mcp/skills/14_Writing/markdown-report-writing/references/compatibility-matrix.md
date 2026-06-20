# GitHub Markdown vs Obsidian Compatibility Matrix

This reference covers which features work on each platform and the recommended approach for cross-platform documents.

## Quick Decision Table

| Feature | GitHub | Obsidian | Cross-Platform Recommendation |
|---|---|---|---|
| Headings, lists, quotes, code blocks | Full | Full | Always use; the minimum shared subset |
| Internal links | Relative paths (branch-aware) | `[[wikilink]]`, Markdown links, heading/block refs | Use Markdown relative links for cross-platform; `[[wikilink]]` only for Obsidian-only notes |
| Images & SVG | PNG/JPG/GIF/SVG supported; SVG no scripts/animations | `.svg` + image embed supported | Diagrams → SVG; screenshots → PNG/WebP |
| Footnotes | Full | Full | Use for citations, terminology, data sources |
| Task lists | Clickable checkboxes | Native task lists | Use for TODOs, checklists, release checklists |
| Tables | Full | Full (escape `\|` in cells) | Use standard Markdown tables; no complex cell styling |
| Mermaid diagrams | Native rendering | Native support | Primary diagram language for agents; use fenced code blocks |
| Math ($\LaTeX$) | MathJax-based | MathJax-based | Safe to use both inline and block formulas |
| Collapsible content | `<details><summary>` works | HTML supported but Markdown won't parse inside HTML | GitHub: use `<details>`; Obsidian: use heading folding or Callout |
| Raw HTML | Supported but aggressively sanitized (no `script`, inline `style`, `class`, `id`) | Supported but sanitized; Markdown not parsed inside HTML | Only for minimal structural patches; never for complex layouts |
| Custom CSS | Not available in repo `.md` pages | CSS Snippets + `cssclasses` frontmatter | GitHub = content source; Obsidian/HTML site = style layer |
| Slides/presentation | Not native in repo `.md` | Obsidian Slides (`---` page separators) | Export via Quarto Revealjs, Pandoc, or Obsidian Slides |
| Dynamic views | Not in repo `.md` | Dataview plugin queries | Obsidian vault enhancement only |

## Key Compatibility Rules

### 1. HTML Sanitization

**GitHub** strips: `script`, inline `style`, `class`, `id`, and other potentially abusable attributes from HTML in Markdown.

**Obsidian** sanitizes HTML AND does not continue parsing Markdown inside HTML elements.

**Result**: Never put complex Markdown (lists, tables, code blocks, math) inside HTML containers. Use native Markdown constructs instead.

### 2. Side-by-Side Layout

**Do NOT use**:
```html
<div style="display:flex">
  <div>![img](a.svg)</div>
  <div>Some text</div>
</div>
```

**Use instead** (cross-platform safe):
```md
| Diagram | Description |
|---|---|
| ![img](./assets/a.svg) | - Point 1<br>- Point 2 |
```

### 3. Collapsible Sections

**GitHub**: `<details><summary>Title</summary>...content...</details>` works well.

**Obsidian**: HTML is supported but Markdown inside won't parse. Use Callout blocks or heading-based folding instead.

**Cross-platform**: If you must use `<details>`, keep the content as plain text or simple HTML. Avoid nesting Markdown lists, tables, or code blocks inside.

### 4. Links Strategy

- Cross-platform text: Use **Markdown relative links** `[text](./path/file.md)`
- Obsidian-only: Use `[[wikilink]]` and `![[embed]]`
- GitHub: Relative links auto-adapt to the current branch

### 5. Styling Strategy

- GitHub repo `.md`: cannot inject custom CSS
- Obsidian: use CSS Snippets (`.obsidian/snippets/`) + `cssclasses` frontmatter
- Exported HTML/sites: add CSS at the site level (Pandoc, Quarto, MkDocs)

## Bottom Line

When in doubt, use **pure CommonMark/GFM syntax** (headings, links, images, tables, code blocks, footnotes, task lists, Mermaid, math). It renders correctly on both platforms and migrates cleanly to any export format.