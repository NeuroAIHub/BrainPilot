#!/usr/bin/env node
/**
 * BrainPilot built-in skills MCP server (stdio transport).
 *
 * Exposes a single `skills_tool_local` tool that agents call for progressive
 * disclosure of local skills stored under the bundled `skills/` directory.
 *
 * Two operation modes (identical to skills_tool.py):
 *   query  – keyword-based search or direct skill lookup by name
 *   browse – filesystem-style traversal for progressive disclosure
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { skillsToolExecute } from "./skills-tool.js";

const TOOL_NAME = "skills_tool_local";

const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description:
    "Unified tool for discovering and loading cognitive/neuroscience and other " +
    "commonly used skills stored locally. Two modes: 'query' (keyword search or " +
    "direct skill lookup) and 'browse' (filesystem-style progressive disclosure " +
    "for reading reference files layer by layer).",
  inputSchema: {
    type: "object" as const,
    properties: {
      mode: {
        type: "string" as const,
        enum: ["query", "browse"],
        description:
          "Operation mode.\n" +
          "  'query'  – search skills by keywords or look up a skill by name.\n" +
          "  'browse' – navigate the skills file system layer by layer\n" +
          "             (progressive disclosure).",
      },
      keywords: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "[query mode only, mutually exclusive with skill_name]\n" +
          "A list of keyword strings to match against each skill's description.\n" +
          "Matching is case-insensitive substring search. For every skill the\n" +
          "total number of keyword occurrences across all keywords is summed;\n" +
          "skills are ranked by this count and the top-k are returned.\n" +
          "Example: ['EEG', 'preprocessing', 'ICA']",
      },
      topk: {
        type: "number" as const,
        description:
          "[query mode, keywords sub-mode only]\n" +
          "Number of top-ranked skills to return (default 5). If fewer skills\n" +
          "match than topk, all matching skills are returned.",
        default: 5,
      },
      skill_name: {
        type: "string" as const,
        description:
          "[query mode only, mutually exclusive with keywords]\n" +
          "Exact skill directory name (e.g. 'mne-python-guide'). When provided,\n" +
          "the full text of that skill's SKILL.md is returned directly, bypassing\n" +
          "keyword ranking. Use browse mode with the returned relative_path to\n" +
          "access the skill's references/ subfolder.",
      },
      relative_path: {
        type: "string" as const,
        description:
          "[browse mode only]\n" +
          "Path relative to the skills/ root to inspect.\n" +
          "  • Pass '' or '.' to list the top-level category folders.\n" +
          "  • Pass a folder path (e.g. '05_EEG_ERP/mne-python-guide') to list\n" +
          "    its immediate children (files and sub-folders).\n" +
          "  • Pass a file path (e.g. '05_EEG_ERP/mne-python-guide/SKILL.md' or\n" +
          "    '05_EEG_ERP/mne-python-guide/references/api.md') to read the full\n" +
          "    file content.\n" +
          "Note: reference files are only accessible via browse mode.",
      },
    },
    required: ["mode"],
  },
};

async function main() {
  const server = new Server(
    { name: "brainpilot-skills-mcp", version: "0.0.5" },
    { capabilities: { tools: {} } },
  );

  // tools/list: announce our single tool
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [TOOL_DEFINITION],
  }));

  // tools/call: dispatch to the skills tool implementation
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name !== TOOL_NAME) {
      return {
        content: [{ type: "text" as const, text: `ERROR: Unknown tool: ${name}` }],
        isError: true,
      };
    }
    const result = await skillsToolExecute({
      mode: (args?.mode as "query" | "browse") ?? "query",
      keywords: Array.isArray(args?.keywords)
        ? (args.keywords as string[]).map(String)
        : undefined,
      topk: typeof args?.topk === "number" ? args.topk : undefined,
      skill_name: typeof args?.skill_name === "string" ? args.skill_name : undefined,
      relative_path:
        typeof args?.relative_path === "string" ? args.relative_path : undefined,
    });
    return result;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with the stdio MCP protocol
  process.stderr.write("[skills-mcp] brainpilot-skills-mcp server ready\n");
}

main().catch((err) => {
  process.stderr.write(`[skills-mcp] Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});