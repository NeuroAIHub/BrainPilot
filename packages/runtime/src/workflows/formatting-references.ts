/**
 * Preservation check for reference/bibliography syntax across a formatting-only
 * rewrite of a LaTeX source. This never repairs or rewrites TeX, and it does not
 * verify that citations are correct — it only asserts that a candidate keeps the
 * same citation keys, bibliography resources, mechanism, raw configuration and
 * frozen inline-bibliography regions as the previous source.
 *
 * The scanner is deliberately minimal: no AST, no macro expansion. Anything it
 * cannot read confidently is reported as uninspectable rather than guessed at.
 */

export type FormattingReferenceCheck = {
  ok: boolean;
  reasonCodes: string[];
};

const UNINSPECTABLE = 'uninspectable_reference_syntax';
const CITATION_KEYS_CHANGED = 'citation_keys_changed';
const RESOURCES_CHANGED = 'bibliography_resources_changed';
const MECHANISM_CHANGED = 'bibliography_mechanism_changed';
const INLINE_CHANGED = 'inline_bibliography_changed';
const CONFIG_CHANGED = 'bibliography_configuration_changed';

const CITATION_COMMANDS = new Set(['cite', 'citep', 'citet', 'nocite']);
const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'Verbatim*', 'lstlisting', 'minted']);
const FROZEN_ENVS = new Set(['thebibliography', 'filecontents', 'filecontents*']);

type Snapshot = {
  uninspectable: boolean;
  citationKeys: string[];
  nociteStar: boolean;
  resources: string[];
  mechanisms: string[];
  configs: string[];
  frozen: string[];
};

const isLetter = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));

/** Skips whitespace and comments, which may legally sit between a command and its argument. */
function skipTrivia(tex: string, pos: number): number {
  let i = pos;
  while (i < tex.length) {
    const c = tex[i];
    if (c === '%') {
      while (i < tex.length && tex[i] !== '\n') i++;
    } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
    } else {
      break;
    }
  }
  return i;
}

type Group = { inner: string; end: number; nested: boolean };

/**
 * Reads a balanced `{...}` or `[...]` group starting at `pos`, or null when the group is
 * unterminated or malformed.
 *
 * Unescaped `%` starts a comment: its text (including any braces) is dropped from `inner`
 * and ignored for balancing, together with the newline and the next line's indentation, so
 * `\cite{A% ignored }\n}` reads exactly like `\cite{A}`. Escaped control-symbol pairs such
 * as `\%` or `\{` are kept verbatim and never counted.
 *
 * Inside a `[...]` group, brackets are only significant at brace depth zero: a `]` nested in
 * a balanced `{...}` cannot terminate the optional argument.
 */
function readGroup(tex: string, pos: number, open: '{' | '['): Group | null {
  if (tex[pos] !== open) return null;
  const optional = open === '[';
  let braces = 0;
  let squares = 0;
  let nested = false;
  const chunks: string[] = [];
  let chunkStart = pos + 1;
  for (let i = pos; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '%') {
      chunks.push(tex.slice(chunkStart, i));
      while (i < tex.length && tex[i] !== '\n') i++;
      while (i + 1 < tex.length && (tex[i + 1] === ' ' || tex[i + 1] === '\t')) i++;
      chunkStart = i + 1;
      continue;
    }
    if (c === '{') {
      braces++;
      if (optional || braces > 1) nested = true;
    } else if (c === '}') {
      braces--;
      // A close brace with nothing open means the group is malformed, not merely nested.
      if (braces < 0) return null;
      if (!optional && braces === 0) {
        chunks.push(tex.slice(chunkStart, i));
        return { inner: chunks.join(''), end: i + 1, nested };
      }
    } else if (optional && braces === 0) {
      if (c === '[') {
        squares++;
        if (squares > 1) nested = true;
      } else if (c === ']') {
        squares--;
        if (squares === 0) {
          chunks.push(tex.slice(chunkStart, i));
          return { inner: chunks.join(''), end: i + 1, nested };
        }
      }
    }
  }
  return null;
}

type Args = { optionals: string[]; required: Group | null; end: number };

/** Reads `[...]*` optional args, then one `{...}` required arg when `wantRequired`. */
function readArgs(tex: string, pos: number, wantRequired: boolean): Args | null {
  const optionals: string[] = [];
  let i = skipTrivia(tex, pos);
  while (tex[i] === '[') {
    const opt = readGroup(tex, i, '[');
    if (!opt) return null;
    optionals.push(opt.inner);
    i = skipTrivia(tex, opt.end);
  }
  if (!wantRequired) return { optionals, required: null, end: i };
  const required = readGroup(tex, i, '{');
  if (!required) return null;
  return { optionals, required, end: required.end };
}

/**
 * Rejects argument text that could expand to something other than the literal value we
 * record: control sequences, macro parameters, and braces of either direction.
 */
const isDynamicArg = (text: string): boolean =>
  text.includes('\\') || text.includes('#') || text.includes('{') || text.includes('}');

/**
 * Returns the offset just past the `\end{env}` closing the environment whose body starts at
 * `pos`, or -1 when no such end can be read confidently.
 *
 * A verbatim body is literal text, so its end marker is matched literally — that is exactly
 * how TeX terminates it. A frozen body is real TeX, so it is walked one control sequence at
 * a time: an end marker sitting in an unescaped `%` comment, in escaped `\\end` text, behind
 * a `\verb` delimiter, or inside a nested verbatim environment is body content, not the end.
 */
function findEnvEnd(tex: string, pos: number, env: string): number {
  if (VERBATIM_ENVS.has(env)) {
    const marker = `\\end{${env}}`;
    const at = tex.indexOf(marker, pos);
    return at < 0 ? -1 : at + marker.length;
  }

  let i = pos;
  while (i < tex.length) {
    const ch = tex[i];
    if (ch === '%') {
      while (i < tex.length && tex[i] !== '\n') i++;
      continue;
    }
    if (ch !== '\\') {
      i++;
      continue;
    }
    let j = i + 1;
    if (j >= tex.length) return -1;
    // One control symbol is consumed whole, so `\\end{...}` reads as text after a line break.
    if (!isLetter(tex[j])) {
      i = j + 1;
      continue;
    }
    let name = '';
    while (j < tex.length && isLetter(tex[j])) name += tex[j++];
    if (tex[j] === '*') name += tex[j++];
    i = j;

    if (name === 'verb' || name === 'verb*') {
      const delim = tex[i];
      if (!delim || delim === '\n') return -1;
      const close = tex.indexOf(delim, i + 1);
      if (close < 0) return -1;
      i = close + 1;
      continue;
    }
    if (name !== 'begin' && name !== 'end') continue;

    const args = readArgs(tex, i, true);
    if (!args || !args.required) return -1;
    i = args.end;
    const inner = args.required.inner.trim();
    if (name === 'end') {
      if (inner === env) return i;
      continue;
    }
    if (VERBATIM_ENVS.has(inner)) {
      const nested = findEnvEnd(tex, i, inner);
      if (nested < 0) return -1;
      i = nested;
    }
  }
  return -1;
}

function scan(tex: string): Snapshot {
  const snap: Snapshot = {
    uninspectable: false,
    citationKeys: [],
    nociteStar: false,
    resources: [],
    mechanisms: [],
    configs: [],
    frozen: [],
  };
  const fail = (): Snapshot => {
    snap.uninspectable = true;
    return snap;
  };

  let i = 0;
  while (i < tex.length) {
    const ch = tex[i];
    if (ch === '%') {
      while (i < tex.length && tex[i] !== '\n') i++;
      continue;
    }
    if (ch !== '\\') {
      i++;
      continue;
    }
    // Consume one control word, or exactly one control symbol (so `\\cite{x}` is text).
    let j = i + 1;
    if (j >= tex.length) return fail();
    if (!isLetter(tex[j])) {
      i = j + 1;
      continue;
    }
    let name = '';
    while (j < tex.length && isLetter(tex[j])) name += tex[j++];
    if (tex[j] === '*') name += tex[j++];
    const base = name.endsWith('*') ? name.slice(0, -1) : name;
    const commandStart = i;
    i = j;

    if (base === 'verb') {
      const delim = tex[i];
      if (!delim || delim === '\n') return fail();
      const close = tex.indexOf(delim, i + 1);
      if (close < 0) return fail();
      i = close + 1;
      continue;
    }

    if (name === 'begin' || name === 'end') {
      const args = readArgs(tex, i, true);
      if (!args || !args.required) return fail();
      i = args.end;
      const env = args.required.inner.trim();
      if (name === 'end') continue;
      if (VERBATIM_ENVS.has(env) || FROZEN_ENVS.has(env)) {
        const end = findEnvEnd(tex, i, env);
        if (end < 0) return fail();
        if (FROZEN_ENVS.has(env)) snap.frozen.push(tex.slice(commandStart, end));
        i = end;
      }
      continue;
    }

    if (CITATION_COMMANDS.has(base)) {
      const args = readArgs(tex, i, true);
      if (!args || !args.required) return fail();
      i = args.end;
      if (args.required.nested) return fail();
      // Optional notes are rendered prose, but a note that smuggles in a control sequence
      // could hide a second citation from this scan, so only plain text is inspectable.
      for (const note of args.optionals) {
        if (isDynamicArg(note)) return fail();
      }
      for (const raw of args.required.inner.split(',')) {
        const key = raw.trim();
        if (key === '') continue;
        if (isDynamicArg(key)) return fail();
        if (key === '*' && base === 'nocite') snap.nociteStar = true;
        else snap.citationKeys.push(key);
      }
      continue;
    }

    if (base === 'bibliography') {
      const args = readArgs(tex, i, true);
      if (!args || !args.required) return fail();
      i = args.end;
      if (args.required.nested || isDynamicArg(args.required.inner)) return fail();
      snap.mechanisms.push('bibtex');
      for (const raw of args.required.inner.split(',')) {
        const resource = raw.trim();
        if (resource !== '') snap.resources.push(resource);
      }
      continue;
    }

    if (base === 'bibliographystyle') {
      // Style value is free to change during formatting; only consume its argument.
      const args = readArgs(tex, i, true);
      if (!args) return fail();
      i = args.end;
      continue;
    }

    if (base === 'addbibresource' || base === 'printbibliography') {
      const wantRequired = base === 'addbibresource';
      const args = readArgs(tex, i, wantRequired);
      if (!args) return fail();
      i = args.end;
      if (args.required && (args.required.nested || isDynamicArg(args.required.inner))) return fail();
      const rendered = args.optionals.map((opt) => `[${opt}]`).join('');
      const required = args.required ? `{${args.required.inner}}` : '';
      snap.mechanisms.push('biblatex');
      snap.configs.push(`\\${name}${rendered}${required}`);
      if (base === 'addbibresource' && args.required) {
        for (const raw of args.required.inner.split(',')) {
          const resource = raw.trim();
          if (resource !== '') snap.resources.push(resource);
        }
      }
      continue;
    }

    // A `\bibitem` outside a frozen `thebibliography` region, or any other
    // reference-like command we do not model, cannot be inspected safely.
    if (base === 'bibitem' || /cite|bib/i.test(base)) return fail();
  }
  return snap;
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

const sameSet = (a: string[], b: string[]): boolean =>
  sameMultiset([...new Set(a)], [...new Set(b)]);

const sameSequence = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function checkFormattingReferences(previousTex: string, candidateTex: string): FormattingReferenceCheck {
  const previous = scan(previousTex);
  const candidate = scan(candidateTex);
  const reasonCodes: string[] = [];
  const add = (code: string): void => {
    if (!reasonCodes.includes(code)) reasonCodes.push(code);
  };

  if (previous.uninspectable || candidate.uninspectable) {
    add(UNINSPECTABLE);
    return { ok: false, reasonCodes };
  }
  if (
    !sameSet(previous.citationKeys, candidate.citationKeys) ||
    previous.nociteStar !== candidate.nociteStar
  ) {
    add(CITATION_KEYS_CHANGED);
  }
  if (!sameSet(previous.resources, candidate.resources)) add(RESOURCES_CHANGED);
  if (!sameSet(previous.mechanisms, candidate.mechanisms)) add(MECHANISM_CHANGED);
  if (!sameMultiset(previous.configs, candidate.configs)) add(CONFIG_CHANGED);
  if (!sameSequence(previous.frozen, candidate.frozen)) add(INLINE_CHANGED);

  return { ok: reasonCodes.length === 0, reasonCodes };
}
