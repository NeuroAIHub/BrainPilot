/**
 * Rendering-only repairs for common model-generated Markdown damage.
 *
 * Keep these transforms deliberately conservative: the original message is
 * still the source of truth, and ambiguous prose must remain untouched.
 */

interface FenceState {
  marker: "`" | "~";
  length: number;
}

const fencePattern = /^( {0,3})(`{3,}|~{3,})/;
const tableDelimiterPattern = /^:?-{3,}:?$/;

/**
 * Repair tables whose row breaks were removed, for example:
 * `| A | B ||---|---| 1 | 2 |`.
 *
 * Structural pipes inside inline code or escaped as `\|` are ignored. A line
 * is changed only when it starts and ends like a table, has at least two
 * headers, contains a delimiter run, and has complete body rows.
 */
export function normalizeMarkdownTables(markdown: string): string {
  let fence: FenceState | null = null;

  return markdown
    .split("\n")
    .map((line) => {
      const fenceMatch = line.match(fencePattern);
      if (fenceMatch) {
        const markers = fenceMatch[2]!;
        const marker = markers[0] as "`" | "~";

        if (!fence) {
          fence = { marker, length: markers.length };
        } else if (
          fence.marker === marker &&
          markers.length >= fence.length &&
          line.slice(fenceMatch[0].length).trim() === ""
        ) {
          fence = null;
        }
        return line;
      }

      return fence ? line : repairCollapsedTableLine(line);
    })
    .join("\n");
}

/**
 * Single-dollar math is conventional in scientific Markdown, but two prices
 * in one sentence (`$5 and $10`) otherwise look like one math span. Escape the
 * common unambiguous currency pair while leaving real `$5$` math untouched.
 */
export function protectCurrencyDollars(markdown: string): string {
  let fence: FenceState | null = null;

  return markdown
    .split("\n")
    .map((line) => {
      const fenceMatch = line.match(fencePattern);
      if (fenceMatch) {
        const markers = fenceMatch[2]!;
        const marker = markers[0] as "`" | "~";

        if (!fence) {
          fence = { marker, length: markers.length };
        } else if (
          fence.marker === marker &&
          markers.length >= fence.length &&
          line.slice(fenceMatch[0].length).trim() === ""
        ) {
          fence = null;
        }
        return line;
      }

      return fence ? line : protectCurrencyPairsInLine(line);
    })
    .join("\n");
}

export function normalizeMarkdownForRendering(markdown: string): string {
  return protectCurrencyDollars(normalizeMarkdownTables(markdown));
}

function repairCollapsedTableLine(line: string): string {
  const indentation = line.match(/^ */)?.[0] ?? "";
  const trimmed = line.trim();
  if (indentation.length > 3 || !trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return line;
  }

  const parts = splitOnStructuralPipes(trimmed);
  if (parts.length < 7 || parts[0] !== "" || parts.at(-1) !== "") {
    return line;
  }

  let delimiterStart = -1;
  let delimiterEnd = -1;
  for (let index = 1; index < parts.length - 1; index += 1) {
    if (!tableDelimiterPattern.test(parts[index]!.trim())) continue;

    let end = index;
    while (end + 1 < parts.length - 1 && tableDelimiterPattern.test(parts[end + 1]!.trim())) {
      end += 1;
    }
    if (end - index + 1 >= 2) {
      delimiterStart = index;
      delimiterEnd = end;
      break;
    }
    index = end;
  }

  if (delimiterStart < 0) return line;

  const header = trimBoundaryEmptyParts(parts.slice(1, delimiterStart));
  const body = trimBoundaryEmptyParts(parts.slice(delimiterEnd + 1, -1));
  if (header.length < 2 || body.length < header.length) return line;

  const rows = splitBodyRows(body, header.length);
  if (!rows) return line;

  const delimiters = parts.slice(delimiterStart, delimiterEnd + 1).map((part) => part.trim());
  const normalizedDelimiters =
    delimiters.length === header.length ? delimiters : Array<string>(header.length).fill("---");

  return [header, normalizedDelimiters, ...rows]
    .map((cells) => `${indentation}| ${cells.map((cell) => cell.trim()).join(" | ")} |`)
    .join("\n");
}

function splitBodyRows(parts: string[], columnCount: number): string[][] | null {
  const rows: string[][] = [];
  let current: string[] = [];

  for (const part of parts) {
    if (part.trim() === "") {
      if (current.length === 0) continue;
      if (current.length !== columnCount) return null;
      rows.push(current);
      current = [];
      continue;
    }

    current.push(part);
    if (current.length === columnCount) {
      rows.push(current);
      current = [];
    }
  }

  return current.length === 0 && rows.length > 0 ? rows : null;
}

function trimBoundaryEmptyParts(parts: string[]): string[] {
  let start = 0;
  let end = parts.length;
  while (start < end && parts[start]!.trim() === "") start += 1;
  while (end > start && parts[end - 1]!.trim() === "") end -= 1;
  return parts.slice(start, end);
}

function splitOnStructuralPipes(value: string): string[] {
  const positions = structuralDelimiterPositions(value, "|");
  const parts: string[] = [];
  let start = 0;
  for (const position of positions) {
    parts.push(value.slice(start, position));
    start = position + 1;
  }
  parts.push(value.slice(start));
  return parts;
}

function protectCurrencyPairsInLine(line: string): string {
  const dollars = structuralDelimiterPositions(line, "$");
  if (dollars.length < 2) return line;

  const escaped = new Set<number>();
  for (let index = 0; index < dollars.length - 1; index += 1) {
    const opening = dollars[index]!;
    const closing = dollars[index + 1]!;
    if (/\d/.test(line[opening + 1] ?? "") && /\d/.test(line[closing + 1] ?? "")) {
      escaped.add(opening);
      escaped.add(closing);
      index += 1;
    }
  }

  if (escaped.size === 0) return line;
  let result = "";
  for (let index = 0; index < line.length; index += 1) {
    result += escaped.has(index) ? `\\${line[index]}` : line[index];
  }
  return result;
}

/** Return unescaped delimiter positions outside inline code spans. */
function structuralDelimiterPositions(value: string, delimiter: "|" | "$"): number[] {
  const positions: number[] = [];
  let inlineCodeTicks = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === "`") {
      let end = index + 1;
      while (value[end] === "`") end += 1;
      const tickCount = end - index;
      if (inlineCodeTicks === 0) inlineCodeTicks = tickCount;
      else if (inlineCodeTicks === tickCount) inlineCodeTicks = 0;
      index = end - 1;
      continue;
    }

    if (inlineCodeTicks === 0 && character === delimiter) positions.push(index);
  }

  return positions;
}
