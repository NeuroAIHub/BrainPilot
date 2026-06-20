/**
 * Parse the `description` field from YAML frontmatter (the leading `---` block)
 * in a SKILL.md file.
 *
 * Handles double-quoted, single-quoted, and unquoted values. Returns "" when
 * the field is absent or the frontmatter block cannot be located.
 */
export function parseFrontmatterDescription(content: string): string {
  // Match the YAML frontmatter block: opening ---, content lines, closing ---
  const fmMatch = content.match(/^---\s*\n(.*?)\n---/s);
  if (!fmMatch || !fmMatch[1]) return "";

  const frontmatter = fmMatch[1];
  // Match:  description: "value"  |  description: 'value'  |  description: value
  const descMatch = frontmatter.match(
    /^description:\s*(?:["'])(.*?)(?:["'])\s*$|^description:\s*(.+?)\s*$/m,
  );
  if (!descMatch) return "";

  return (descMatch[1] ?? descMatch[2] ?? "").trim();
}