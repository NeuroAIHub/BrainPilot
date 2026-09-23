/**
 * Conservative, finite shell recognizer for delivery-only test drivers.
 * It is not a shell parser or a general sandbox. Ambiguous syntax is rejected.
 * The single redirection exception is the observed stderr discard 2>/dev/null;
 * it cannot name another target, descriptor, file or expansion.
 */
export function isReadOnlyBash(command) {
  if (typeof command !== "string" || !command.trim() || command.length > 8000 || /[\x00-\x08\x0a-\x1f\x7f]/.test(command)) return false;
  const tokens = []; let word = "", active = false, quote = "";
  const flush = () => { if (active) tokens.push({ kind: "word", value: word }); word = ""; active = false; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = ""; else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') { quote = ""; continue; }
      if (c === "$" || c === "`") return false;
      if (c === "\\") {
        const next = command[++i];
        if (next !== '"' && next !== "\\") return false;
        word += next;
      } else word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; active = true; continue; }
    if (c === " " || c === "\t") { flush(); continue; }
    if (!active && command.slice(i).match(/^2>\/dev\/null(?=$|[\t ;|&])/)) {
      tokens.push({ kind: "discard-stderr" }); i += "2>/dev/null".length - 1; continue;
    }
    // Reject substitutions, expansion, redirection, escapes/continuations,
    // glob/brace expansion, comments, grouping and process substitution.
    if ("$`\\<>*?[]{}()#!~".includes(c)) return false;
    if (c === "&") {
      if (command[i + 1] !== "&") return false;
      flush(); tokens.push({ kind: "op", value: "&&" }); i++; continue;
    }
    if (c === "|") {
      if (command[i + 1] === "|" || command[i + 1] === "&") return false;
      flush(); tokens.push({ kind: "op", value: "|" }); continue;
    }
    if (c === ";") { flush(); tokens.push({ kind: "op", value: ";" }); continue; }
    active = true; word += c;
  }
  if (quote) return false;
  flush(); if (tokens.length > 200) return false;

  // Option allowlists prevent read-looking tools from invoking helpers (rg
  // --pre/--hostname-bin) or waiting indefinitely (tail --follow).
  const options = {
    ls: { short: "1aAbBcCdFfFgGhHiIlLmMnNopqQrRsStTuUvUxX", long: ["all", "almost-all", "human-readable", "directory", "recursive", "full-time", "numeric-uid-gid", "inode", "size"], values: ["color", "time-style", "sort", "time"] },
    pwd: { short: "LP", long: ["logical", "physical"] },
    pdfinfo: { exact: ["-box", "-meta", "-rawdates", "-isodates", "-dests", "-url", "-js", "-struct", "-struct-text", "-custom"], exactValues: ["-f", "-l", "-enc"] },
    wc: { short: "cmlwL", long: ["bytes", "chars", "lines", "words", "max-line-length"] },
    cat: { short: "AbEeEnstTuv", long: ["show-all", "number-nonblank", "show-ends", "number", "squeeze-blank", "show-tabs", "show-nonprinting"] },
    head: { short: "qv", valueShort: "nc", long: ["quiet", "silent", "verbose"], values: ["lines", "bytes"], count: true },
    tail: { short: "qv", valueShort: "nc", long: ["quiet", "silent", "verbose"], values: ["lines", "bytes"], count: true },
    stat: { short: "fLt", valueShort: "c", long: ["file-system", "dereference", "terse"], values: ["format", "printf"] },
    sha256sum: { short: "bctwz", long: ["binary", "check", "tag", "text", "zero", "ignore-missing", "quiet", "status", "strict", "warn"] },
    grep: { short: "EFGPivnHhoclLwxqsaIrRzZbU", valueShort: "efmABC", long: ["extended-regexp", "fixed-strings", "basic-regexp", "perl-regexp", "ignore-case", "invert-match", "line-number", "with-filename", "no-filename", "only-matching", "count", "files-with-matches", "files-without-match", "word-regexp", "line-regexp", "quiet", "silent", "no-messages", "text", "recursive", "dereference-recursive", "null-data", "null", "byte-offset"], values: ["regexp", "file", "max-count", "after-context", "before-context", "context", "include", "exclude", "exclude-dir", "binary-files", "color"] },
    rg: { short: "isSnNHhIoclvqawxFPUu", valueShort: "efmABCgTt", long: ["ignore-case", "case-sensitive", "smart-case", "line-number", "no-line-number", "with-filename", "no-filename", "only-matching", "count", "count-matches", "files-with-matches", "files-without-match", "quiet", "text", "word-regexp", "line-regexp", "fixed-strings", "pcre2", "multiline", "hidden", "no-ignore", "no-config", "files", "stats", "heading", "no-heading", "invert-match"], values: ["regexp", "file", "max-count", "after-context", "before-context", "context", "glob", "iglob", "type", "type-not", "color", "encoding", "max-columns"] },
  };
  function valid(argv) {
    if (!argv.length || argv.some(arg => arg.length > 2000)) return false;
    const [name, ...args] = argv;
    if (name === "cd") return args.length === 1 && args[0] !== "-" && !args[0].startsWith("-");
    if (!Object.hasOwn(options, name)) return false;
    const spec = options[name];
    let endedOptions = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (endedOptions || arg === "-" || !arg.startsWith("-")) continue;
      if (arg === "--") { endedOptions = true; continue; }
      if (spec.exact?.includes(arg)) continue;
      if (spec.exactValues?.includes(arg)) { if (++i >= args.length) return false; continue; }
      if (spec.count && /^-\d+$/.test(arg)) continue;
      if (arg.startsWith("--")) {
        const equal = arg.indexOf("="); const flag = arg.slice(2, equal < 0 ? undefined : equal);
        if (spec.long?.includes(flag) && equal < 0) continue;
        if (!spec.values?.includes(flag)) return false;
        if (equal < 0 && ++i >= args.length) return false;
        if (equal >= 0 && equal === arg.length - 1) return false;
        continue;
      }
      for (let j = 1; j < arg.length; j++) {
        if (spec.short?.includes(arg[j])) continue;
        if (!spec.valueShort?.includes(arg[j])) return false;
        if (j === arg.length - 1 && ++i >= args.length) return false;
        break;
      }
    }
    return true;
  }
  let argv = [], discarded = false, segments = 0;
  for (const token of tokens) {
    if (token.kind === "word") argv.push(token.value);
    else if (token.kind === "discard-stderr") {
      if (!argv.length || discarded) return false; discarded = true;
    } else {
      if (!valid(argv) || ++segments > 12) return false;
      argv = []; discarded = false;
    }
  }
  return valid(argv) && segments < 12;
}
