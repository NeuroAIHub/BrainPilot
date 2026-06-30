import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'content');
const patterns = [
  {
    name: 'OpenAI/Anthropic-style secret key',
    regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: 'Tavily secret key',
    regex: /\btvly-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: 'raw team MCP host',
    regex: /\b8\.145\.42\.208\b/g,
  },
];

let failed = false;

for (const file of globSync('**/*.{md,mdx,json}', { cwd: root })) {
  const path = join(root, file);
  const text = await readFile(path, 'utf8');
  for (const pattern of patterns) {
    const matches = text.match(pattern.regex);
    if (matches) {
      failed = true;
      console.error(`[docs:secrets] ${pattern.name} found in ${file}`);
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log('[docs:secrets] OK');
