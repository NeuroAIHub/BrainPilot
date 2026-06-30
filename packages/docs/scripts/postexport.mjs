import { existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_LANGUAGE, DOCS_BASE_PATH, LANGUAGES } from '../lib/locales.mjs';

const OUT = new URL('../out/', import.meta.url).pathname;

function redirectHtml(target) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)})</script>
<title>Redirecting...</title></head>
<body><p style="padding:2rem">Redirecting to <a href="${target}">${target}</a>...</p></body></html>`;
}

async function main() {
  if (!existsSync(OUT)) {
    throw new Error(`out/ not found at ${OUT}; run "next build" first.`);
  }

  for (const lang of LANGUAGES) {
    if (lang === DEFAULT_LANGUAGE) continue;
    const dir = join(OUT, lang);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'index.html'),
      redirectHtml(`${DOCS_BASE_PATH}/${lang}/getting-started`),
    );
  }

  const special = new Set(['404', '_not-found', 'index']);
  const slugs = (await readdir(OUT))
    .filter((file) => file.endsWith('.html'))
    .map((file) => file.slice(0, -'.html'.length))
    .filter((slug) => !special.has(slug));

  const enDir = join(OUT, DEFAULT_LANGUAGE);
  await mkdir(enDir, { recursive: true });
  await writeFile(join(enDir, 'index.html'), redirectHtml(`${DOCS_BASE_PATH}/`));

  for (const slug of slugs) {
    await writeFile(
      join(enDir, `${slug}.html`),
      redirectHtml(`${DOCS_BASE_PATH}/${slug}`),
    );
  }

  const expected = [
    'index.html',
    'getting-started.html',
    'installation.html',
    'providers.html',
    'mcp.html',
    'skills-knowledge-base.html',
    'troubleshooting.html',
    'development.html',
    'static.json',
    'zh-cn/index.html',
    'zh-cn/getting-started.html',
  ];

  let ok = true;
  for (const rel of expected) {
    const path = join(OUT, rel);
    const exists = existsSync(path);
    if (!exists) ok = false;
    const size = exists ? (await stat(path)).size : 0;
    console.log(`[postexport] ${exists ? 'OK ' : 'MISSING'} ${rel}${exists ? ` (${size}b)` : ''}`);
  }

  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
