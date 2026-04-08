import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILT_IN_AGENTS, type ResolvedAgentConfig, resolveAgentSelection } from "../agents.ts";

// ── MCP server config ─────────────────────────────────────────────────────────

/** Mirrors McpServerStdio from @agentclientprotocol/sdk. */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  /** Environment variables as name/value pairs (ACP SDK format). */
  env?: Array<{ name: string; value: string }>;
}

// ── File schema (what users write) ────────────────────────────────────────────

export interface LarkAcpConfig {
  lark: {
    appId: string;
    appSecret: string;
    encryptKey?: string;
    verificationToken?: string;
    botName?: string;
  };
  /**
   * Built-in preset name or raw command string.
   * Presets: claude | copilot | gemini | qwen | codex | opencode
   * Raw: "bunx my-agent --acp" or "/usr/local/bin/agent"
   */
  agent: string;
  acp?: {
    /** Working directory for the agent process. Defaults to cwd of lark-acp. */
    cwd?: string;
    /** Milliseconds of inactivity before a session is reaped. Default: 30 min. */
    idleTimeoutMs?: number;
    /** Max concurrent agent processes. Oldest idle is evicted when exceeded. Default: 10. */
    maxConcurrent?: number;
    /** Stream agent thought blocks as blockquotes before the reply. Default: false. */
    showThoughts?: boolean;
    /** MCP servers to pass to each new ACP session. */
    mcpServers?: McpServerConfig[];
  };
  autoApprovePermissions?: boolean;
}

// ── Resolved config (what the app uses) ──────────────────────────────────────

export interface ResolvedConfig {
  lark: {
    appId: string;
    appSecret: string;
    encryptKey: string;
    verificationToken: string;
    botName: string;
  };
  agent: ResolvedAgentConfig & {
    cwd: string;
    showThoughts: boolean;
    mcpServers: McpServerConfig[];
  };
  session: {
    idleTimeoutMs: number;
    maxConcurrent: number;
  };
  autoApprovePermissions: boolean;
}

// ── Config file search ────────────────────────────────────────────────────────

const CONFIG_SEARCH_PATHS = [
  process.env.LARK_ACP_CONFIG,
  path.join(process.cwd(), "lark-acp.json"),
  path.join(os.homedir(), ".lark-acp", "config.json"),
].filter(Boolean) as string[];

async function loadConfigFile(): Promise<LarkAcpConfig> {
  for (const filePath of CONFIG_SEARCH_PATHS) {
    if (existsSync(filePath)) {
      console.log(`[Config] Loading ${filePath}`);
      const raw = await Bun.file(filePath).text();
      return JSON.parse(raw) as LarkAcpConfig;
    }
  }
  throw new Error(
    "No config file found. Create one with:\n  lark-acp init\n\nSearch paths:\n" +
      CONFIG_SEARCH_PATHS.map((p) => `  ${p}`).join("\n")
  );
}

function validate(cfg: LarkAcpConfig): void {
  if (!cfg.lark?.appId) throw new Error("Config: lark.appId is required");
  if (!cfg.lark?.appSecret) throw new Error("Config: lark.appSecret is required");
  if (!cfg.agent?.trim()) {
    throw new Error(
      "Config: agent is required\n" +
        "  Built-in presets: " +
        Object.keys(BUILT_IN_AGENTS).join(" | ") +
        "\n" +
        '  Or a raw command: "bunx my-agent --acp"'
    );
  }
}

function resolve(raw: LarkAcpConfig, agentOverride?: string): ResolvedConfig {
  const agentStr = agentOverride ?? raw.agent;
  const agentBase = resolveAgentSelection(agentStr);

  return {
    lark: {
      appId: raw.lark.appId,
      appSecret: raw.lark.appSecret,
      encryptKey: raw.lark.encryptKey ?? "",
      verificationToken: raw.lark.verificationToken ?? "",
      botName: raw.lark.botName ?? "AI Assistant",
    },
    agent: {
      ...agentBase,
      cwd: raw.acp?.cwd ?? process.cwd(),
      showThoughts: raw.acp?.showThoughts ?? false,
      mcpServers: raw.acp?.mcpServers ?? [],
    },
    session: {
      idleTimeoutMs: raw.acp?.idleTimeoutMs ?? 30 * 60_000, // 30 min default
      maxConcurrent: raw.acp?.maxConcurrent ?? 10,
    },
    autoApprovePermissions: raw.autoApprovePermissions ?? true,
  };
}

// ── Lazy singleton ────────────────────────────────────────────────────────────

let _config: ResolvedConfig | null = null;
let _agentOverride: string | undefined;

/** Set the --agent override before first getConfig() call. */
export function setAgentOverride(agent: string): void {
  _agentOverride = agent;
}

export async function getConfig(): Promise<ResolvedConfig> {
  if (_config) return _config;
  const raw = await loadConfigFile();
  // --agent overrides config file; skip agent validation if overridden
  if (!_agentOverride) validate(raw);
  else if (!raw.lark?.appId || !raw.lark?.appSecret) validate(raw);
  _config = resolve(raw, _agentOverride);
  return _config;
}
