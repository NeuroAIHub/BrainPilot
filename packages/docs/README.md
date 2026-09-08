# BrainPilot Docs

This workspace builds the public BrainPilot documentation site for `brainpilot.chat/docs`.

```bash
npm run docs:dev
npm run docs:build
npm run docs:check
```

The site is a static Next.js export powered by Fumadocs and MDX. English is served without
a locale prefix, for example `/docs/getting-started`; Simplified Chinese is served under
`/docs/zh-cn/getting-started`.

Do not commit real provider keys, MCP tokens, or internal-only endpoints in this package.
Use placeholders such as `<your-api-key>` in public docs.


New pages require matching English/Chinese MDX files and entries in both `meta*.json` files.
The English export uses explicit routes under `app/(en)/(docs)/<slug>/page.tsx`; add a route
using the existing `StaticDocsPage` wrapper. Chinese routes are generated from the content.
Add both exported paths to `scripts/postexport.mjs` and verify their HTML exists after build.
Cloud vendors only `content/` and has its own rendering/build step; see the release checklist
in [RELEASING.md](../../RELEASING.md).
