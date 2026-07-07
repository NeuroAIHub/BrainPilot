import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Regression guard for the patch-package fix in
// patches/@earendil-works+pi-coding-agent++@earendil-works+pi-ai+0.79.8.patch
//
// Azure's Responses transport runs stateless (store:false) yet the shared converter
// replayed server-generated item ids (rs_ reasoning / fc_ tool-call). With nothing
// stored server-side, those ids reference non-existent items and Azure's strict
// validation rejects the request. The patch strips them for api "azure-openai-responses"
// while leaving encrypted_content (which carries the state) intact, and leaves the
// lenient OpenAI path untouched. This test fails if the patch is not applied.

interface TestModel {
	id: string;
	provider: string;
	api: string;
	reasoning: boolean;
	input: string[];
	compat?: Record<string, unknown>;
}

interface ThinkingBlock {
	type: "thinking";
	thinking: string;
	thinkingSignature: string;
}

interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

interface AssistantMessage {
	role: "assistant";
	provider: string;
	api: string;
	model: string;
	stopReason: string;
	content: Array<ThinkingBlock | ToolCallBlock>;
}

interface TestContext {
	systemPrompt?: string;
	messages: AssistantMessage[];
}

interface ResponsesItem {
	type: string;
	id?: string;
	call_id?: string;
	encrypted_content?: string;
	[key: string]: unknown;
}

type ConvertResponsesMessages = (
	model: TestModel,
	context: TestContext,
	allowedToolCallProviders: ReadonlySet<string>,
	options?: { includeSystemPrompt?: boolean },
) => ResponsesItem[];

/** Locate the nested (or hoisted) pi-ai converter by walking up from this test file. */
function resolveSharedConverterPath(): string {
	const tail = join("@earendil-works", "pi-ai", "dist", "providers", "openai-responses-shared.js");
	let dir = dirname(fileURLToPath(import.meta.url));
	while (dirname(dir) !== dir) {
		const nested = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", tail);
		const hoisted = join(dir, "node_modules", tail);
		if (existsSync(nested)) return nested;
		if (existsSync(hoisted)) return hoisted;
		dir = dirname(dir);
	}
	throw new Error("Could not locate @earendil-works/pi-ai openai-responses-shared.js");
}

function hasConverter(mod: unknown): mod is { convertResponsesMessages: ConvertResponsesMessages } {
	return (
		typeof mod === "object" &&
		mod !== null &&
		"convertResponsesMessages" in mod &&
		typeof mod.convertResponsesMessages === "function"
	);
}

// Dynamic import: the converter is not exposed by @earendil-works/pi-ai's `exports`
// map and its absolute path is resolved at runtime, so no static specifier can name
// it. The test loads the patched module directly on purpose.
const loaded: unknown = await import(pathToFileURL(resolveSharedConverterPath()).href);
if (!hasConverter(loaded)) {
	throw new Error("convertResponsesMessages export missing from nested pi-ai module");
}
const { convertResponsesMessages } = loaded;

// Faithful to azure-openai-responses.js:11 (the set the Azure transport passes).
const AZURE_TOOL_CALL_PROVIDERS: ReadonlySet<string> = new Set([
	"openai",
	"openai-codex",
	"opencode",
	"azure-openai-responses",
]);

function model(api: string, provider: string, id = "gpt-5"): TestModel {
	return { id, provider, api, reasoning: true, input: ["text"], compat: {} };
}

function reasoningSignature(id: string): string {
	return JSON.stringify({ type: "reasoning", id, summary: [], encrypted_content: "ENCRYPTED_BLOB" });
}

function thinkingContext(api: string, provider: string): TestContext {
	return {
		messages: [
			{
				role: "assistant",
				provider,
				api,
				model: "gpt-5",
				stopReason: "stop",
				content: [
					{
						type: "thinking",
						thinking: "reasoning text",
						thinkingSignature: reasoningSignature("rs_test_123"),
					},
				],
			},
		],
	};
}

describe("pi-ai azure responses server-item id stripping (patch-package)", () => {
	it("omits the rs_ reasoning id for azure but preserves encrypted_content", () => {
		const items = convertResponsesMessages(
			model("azure-openai-responses", "azure"),
			thinkingContext("azure-openai-responses", "azure"),
			AZURE_TOOL_CALL_PROVIDERS,
		);
		const reasoning = items.find((item) => item.type === "reasoning");
		expect(reasoning).toBeDefined();
		expect(reasoning?.encrypted_content).toBe("ENCRYPTED_BLOB");
		expect(reasoning?.id).toBeUndefined();
	});

	it("keeps the rs_ reasoning id for non-azure openai responses (fix is provider-scoped)", () => {
		const items = convertResponsesMessages(
			model("openai-responses", "openai"),
			thinkingContext("openai-responses", "openai"),
			new Set(["openai"]),
		);
		const reasoning = items.find((item) => item.type === "reasoning");
		expect(reasoning?.id).toBe("rs_test_123");
		expect(reasoning?.encrypted_content).toBe("ENCRYPTED_BLOB");
	});

	it("omits the fc_ function_call item id for azure but keeps call_id", () => {
		const context: TestContext = {
			messages: [
				{
					role: "assistant",
					provider: "azure",
					api: "azure-openai-responses",
					model: "gpt-5",
					stopReason: "stop",
					content: [{ type: "toolCall", id: "call_abc|fc_xyz", name: "search", arguments: { q: "x" } }],
				},
			],
		};
		const items = convertResponsesMessages(
			model("azure-openai-responses", "azure"),
			context,
			AZURE_TOOL_CALL_PROVIDERS,
		);
		const fnCall = items.find((item) => item.type === "function_call");
		expect(fnCall).toBeDefined();
		expect(fnCall?.call_id).toBe("call_abc");
		expect(fnCall?.id).toBeUndefined();
	});
});
