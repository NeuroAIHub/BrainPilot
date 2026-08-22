# Upstream

This BrainPilot MCP wrapper launches Microsoft
[`playwright-mcp`](https://github.com/microsoft/playwright-mcp), licensed under
Apache-2.0.

- npm package: `@playwright/mcp@0.0.78`
- npm integrity: `sha512-XLTUeA6mEN9sQ+hJ4dfG8EIkDbxS0K3Trc2RBkUJuf02TgE2FQRNTMtq/aJfhyRMINsRl/Ybc4sxcWLtFn4/TQ==`
- upstream commit observed at integration: `8414d571beed0e12a4b8c7f537bfdab44236ba4c`

The upstream package is downloaded by pinned npm version when the MCP server
starts. BrainPilot supplies only the manifest, safe defaults, browser discovery,
and runtime projection.
