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
