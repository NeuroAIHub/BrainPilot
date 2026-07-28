/**
 * @brainpilot/runtime — Pi SDK multi-agent orchestration + STATE AUTHORITY.
 *
 * Public surface: SessionManager, MasAgent, Mailbox, GraphOfTrace, event
 * helpers, agent factories, server bootstrap.
 */
export const RUNTIME_NAME = "@brainpilot/runtime";

export { SessionManager } from "./session-manager.js";
export type { SessionManagerOptions } from "./session-manager.js";

export { MasAgent } from "./mas-agent.js";
export type { AgentStatus, MasAgentOpts } from "./mas-agent.js";

export { Mailbox } from "./mailbox.js";
export type { MailboxMessage, MsgType } from "./mailbox.js";

export { GraphOfTrace } from "./trace.js";
export { EventBus } from "./event-bus.js";
export { ev, newMessageId, newRunId } from "./events.js";

export { MockAgentSession } from "./mock-agent.js";
export {
  selectFactory,
  isMockMode,
  mockAgentFactory,
  realAgentFactory,
} from "./agent-factory.js";

export {
  allSystemTools,
  systemToolsForRole,
  systemToolNamesForRole,
  builtinToolNamesForRole,
  AGENT_TOOL_CONFIG,
  BUILTIN_TOOL_CONFIG,
  BUILTIN_TOOL_CONFIG_BY_NAME,
} from "./tools/system-tools.js";
export type { ToolDeps } from "./tools/system-tools.js";

export {
  PERSONAS,
  BUILTIN_PERSONA_NAMES,
  personaFor,
} from "./personas.js";

export { createServer, startServer } from "./server.js";
export type { StartServerOptions } from "./server.js";

export { McpBridge, loadMcpServersConfig, defaultMcpConnect } from "./mcp-bridge.js";
export type { McpServersConfig, McpServerSpec, McpClientLike, McpConnectFn } from "./mcp-bridge.js";

export {
  loadToolToggles,
  isToolEnabled,
  TOGGLEABLE_TOOL_NAMES,
} from "./tool-toggles.js";
export type { ToolToggles, ToggleableToolName } from "./tool-toggles.js";

export {
  DOMAIN_TOOL_NAMES,
  resolveDomainResources,
  toolTogglesForDomainResources,
  withoutDomainResourceInstructions,
  withoutRouterSkillInstructions,
  domainResourceUsageOnStart,
  domainResourceUsageOnSuccess,
} from "./domain-resources.js";

export {
  isUnderRouterSkillsDir,
  pathsFromToolCall,
  bashTouchesRouterSkills,
  shouldBlockToolCall,
  denyRouterSkillsReason,
} from "./router-skill-access.js";

export { makeRouterSkillGuardExt } from "./extensions/router-skill-guard.js";

export { materializeSkills, resolveBundledSkillsDir } from "./materialize-skills.js";
export type { MaterializeSkillsResult } from "./materialize-skills.js";

export {
  materializeKb,
  resolveBundledKbDir,
  defaultUserKbDir,
} from "./materialize-kb.js";
export type {
  MaterializeKbResult,
  MaterializeKbOptions,
  MaterializeKbSkipReason,
} from "./materialize-kb.js";

export { isWindows, isMacOS, isLinux, gracefulSignalsSupported } from "./platform.js";

export type {
  AgentRole,
  IAgentSession,
  AgentSessionFactory,
  PiAgentEvent,
  PiAssistantMessageEvent,
  SystemTool,
  SystemToolResult,
  EventListener,
} from "./types.js";
