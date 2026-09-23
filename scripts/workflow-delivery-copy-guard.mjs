/** A finite recognizer for packaging existing artifacts; never interprets a shell. */
export function planArtifactCopies(command, publishedPaths) {
  if (typeof command !== "string" || !command.trim() || command.length > 12000) return null;
  const segments = command.split(/\s*&&\s*/);
  if (segments.length > 20) return null;
  const directories = new Set(); const copies = [];
  const path = word => {
    if ((word.startsWith('"') && word.endsWith('"')) || (word.startsWith("'") && word.endsWith("'"))) word = word.slice(1, -1);
    if (!/^[A-Za-z0-9._/-]+$/.test(word)) return null;
    word = word.replace(/^\/workspace\//, "").replace(/^\.\//, "").replace(/\/$/, "");
    if (!word || word.startsWith("/") || word.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("-"))) return null;
    return word;
  };
  for (const segment of segments) {
    const words = segment.trim().split(/\s+/); const tool = words.shift();
    if (tool === "mkdir" && words.shift() === "-p") {
      if (words[0] === "--") words.shift();
      if (!words.length) return null;
      for (const word of words) {
        const target = path(word);
        if (!target || (target !== "deliverables" && !target.startsWith("deliverables/"))) return null;
        directories.add(target);
      }
    } else if (tool === "cp") {
      if (words[0] === "--") words.shift();
      if (words.length !== 2) return null;
      const source = path(words[0]); let target = path(words[1]);
      if (!source || !publishedPaths.has(source) || !target) return null;
      if (directories.has(target) || /\/$/.test(words[1].replace(/^['"]|['"]$/g, ""))) target += "/" + source.split("/").at(-1);
      if (!target.startsWith("deliverables/")) return null;
      if (copies.some(copy => copy.target === target)) return null;
      copies.push({ source, target });
    } else return null;
  }
  return copies.length || directories.size ? { directories: [...directories], copies } : null;
}

/** Verify both preservation and the exact allowed workspace additions. */
export function inspectDeliveryWorkspace(before, after, authorizedCopies) {
  const old = new Map(before.map(file => [file.path, file]));
  const now = new Map(after.map(file => [file.path, file]));
  const errors = []; const copies = [];
  for (const file of before) {
    if (now.get(file.path)?.sha256 !== file.sha256 || now.get(file.path)?.size !== file.size) errors.push(`Changed or missing saved material: ${file.path}`);
  }
  for (const file of after) {
    if (old.has(file.path)) continue;
    const authorized = authorizedCopies.get(file.path);
    if (!file.path.startsWith("deliverables/") || !authorized || file.sha256 !== authorized.sha256 || file.size !== authorized.size) {
      errors.push(`Unexpected or nonidentical workspace addition: ${file.path}`);
    } else copies.push({ ...file, source: authorized.source });
  }
  return { unchanged: errors.length === 0, errors, copies };
}

/** Match complete workspace path references, never prefixes of other filenames. */
export function matchDeliveredArtifacts(text, requested, available) {
  const references = new Set();
  // Link labels and optional titles are not their destinations. Keep the
  // destination only, so a correct filename label cannot hide a wrong target.
  const referencesText = text.replace(/\[[^\]\n]*\]\(([^)\n]*)\)/gu, (_link, target) => {
    const destination = target.trim().match(/^(?:<([^>]+)>|(\S+))/u);
    return destination ? " " + (destination[1] ?? destination[2]) + " " : " ";
  });
  // Markdown delimiters, quotes and whitespace delimit the current artifact
  // paths. Decode each reference separately: unrelated prose such as "100%"
  // must not prevent an encoded link from being recognized. Query/fragment
  // suffixes belong to the link, not the saved filename.
  for (const token of referencesText.match(/[^\s<>()"'`\[\]]+/gu) ?? []) {
    let path = token.split(/[?#]/u, 1)[0];
    try { path = decodeURIComponent(path); } catch { /* Keep a literal reference. */ }
    path = path.replace(/^(?:\/workspace\/|\.\/)/u, "");
    references.add(path);
  }
  return requested.map(file => ({ requestedPath: file.path, sha256: file.sha256,
    matchingPaths: available.filter(candidate => candidate.sha256 === file.sha256 && candidate.size === file.size &&
      references.has(candidate.path)).map(candidate => candidate.path) }));
}
