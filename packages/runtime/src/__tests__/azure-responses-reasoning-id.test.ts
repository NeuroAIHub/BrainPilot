import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Regression guard for the Azure store:false reasoning-replay fix that
// scripts/patch-pi-ai.cjs applies (postinstall) to @earendil-works/pi-ai's
// Responses converter.
//
// Azure OpenAI Responses (api "azure-openai-responses") runs store:false, so the
// server persists nothing between turns. The shared converter replays a captured
// reasoning item verbatim; a bare rs_ id with no encrypted_content triggers a
// server lookup that 400s ("Item with id 'rs_...' not found. Items are not
// persisted when store is set to false."). The fix, for azure only: drop reasoning
// items lacking encrypted_content, and strip the rs_/fc_ server ids from items it
// does replay (encrypted_content carries the state). Non-azure Responses providers
// are untouched. This test fails if the postinstall patch did not apply.

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
	const subs = ["api", "providers"]; // 0.80.x moved dist/providers/ -> dist/api/
	let dir = dirname(fileURLToPath(import.meta.url));
	while (dirname(dir) !== dir) {
		for (const sub of subs) {
			const tail = join("@earendil-works", "pi-ai", "dist", sub, "openai-responses-shared.js");
			const nested = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", tail);
			const hoisted = join(dir, "node_modules", tail);
			if (existsSync(nested)) return nested;
			if (existsSync(hoisted)) return hoisted;
		}
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

// Faithful to azure-openai-responses.js (the set the Azure transport passes).
const AZURE_TOOL_CALL_PROVIDERS: ReadonlySet<string> = new Set([
	"openai",
	"openai-codex",
	"opencode",
	"azure-openai-responses",
]);

function model(api: string, provider: string, id = "gpt-5"): TestModel {
	return { id, provider, api, reasoning: true, input: ["text"], compat: {} };
}

function reasoningSignature(id: string, encryptedContent?: string): string {
	const item: Record<string, unknown> = { type: "reasoning", id, summary: [] };
	if (encryptedContent !== undefined) item.encrypted_content = encryptedContent;
	return JSON.stringify(item);
}

function thinkingContext(
	api: string,
	provider: string,
	encryptedContent?: string,
): TestContext {
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
						thinkingSignature: reasoningSignature("rs_test_123", encryptedContent),
					},
				],
			},
		],
	};
}

describe("pi-ai azure responses store:false reasoning replay (postinstall patch)", () => {
	it("strips the rs_ id for azure but keeps the encrypted_content payload", () => {
		const items = convertResponsesMessages(
			model("azure-openai-responses", "azure"),
			thinkingContext("azure-openai-responses", "azure", "ENCRYPTED_BLOB"),
			AZURE_TOOL_CALL_PROVIDERS,
		);
		const reasoning = items.find((item) => item.type === "reasoning");
		expect(reasoning).toBeDefined();
		expect(reasoning?.encrypted_content).toBe("ENCRYPTED_BLOB");
		expect(reasoning?.id).toBeUndefined();
	});

	it("drops the reasoning item entirely for azure when it has no encrypted_content", () => {
		const items = convertResponsesMessages(
			model("azure-openai-responses", "azure"),
			thinkingContext("azure-openai-responses", "azure"),
			AZURE_TOOL_CALL_PROVIDERS,
		);
		// A bare rs_ id under store:false would 400; the patch must not replay it.
		expect(items.find((item) => item.type === "reasoning")).toBeUndefined();
	});

	it("keeps the rs_ reasoning id for non-azure openai responses (fix is provider-scoped)", () => {
		const items = convertResponsesMessages(
			model("openai-responses", "openai"),
			thinkingContext("openai-responses", "openai", "ENCRYPTED_BLOB"),
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
		const items = convertResponsesMessages(model("azure-openai-responses", "azure"), context, AZURE_TOOL_CALL_PROVIDERS);
		const fnCall = items.find((item) => item.type === "function_call");
		expect(fnCall).toBeDefined();
		expect(fnCall?.call_id).toBe("call_abc");
		expect(fnCall?.id).toBeUndefined();
	});
});
