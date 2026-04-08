/**
 * Built-in ACP agent presets and resolver.
 * Naming and structure aligned with wechat-acp/src/config.ts.
 */

export interface AgentCommandConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentPreset extends AgentCommandConfig {
  label: string;
  description?: string;
}

export interface ResolvedAgentConfig extends AgentCommandConfig {
  id?: string;
  label?: string;
  source: "preset" | "raw";
}

export const BUILT_IN_AGENTS: Record<string, AgentPreset> = {
  claude: {
    label: "Claude Code",
    command: "bunx",
    args: ["@zed-industries/claude-code-acp"],
    description: "Claude Code ACP",
  },
  copilot: {
    label: "GitHub Copilot",
    command: "bunx",
    args: ["@github/copilot", "--acp", "--yolo"],
    description: "GitHub Copilot CLI",
  },
  gemini: {
    label: "Gemini CLI",
    command: "bunx",
    args: ["@google/gemini-cli", "--experimental-acp"],
    description: "Google Gemini CLI",
  },
  qwen: {
    label: "Qwen Code",
    command: "bunx",
    args: ["@qwen-code/qwen-code", "--acp", "--experimental-skills"],
    description: "Qwen Code CLI",
  },
  codex: {
    label: "Codex CLI",
    command: "bunx",
    args: ["@zed-industries/codex-acp"],
    description: "OpenAI Codex via ACP shim",
  },
  opencode: {
    label: "OpenCode",
    command: "bunx",
    args: ["opencode-ai", "acp"],
    description: "OpenCode CLI",
  },
  pi: {
    label: "Pi",
    command: "bunx",
    args: ["-y", "pi-acp"],
    description: "Pi Acp",
  },
};

/**
 * Parse a raw command string like "bunx my-agent --acp" into { command, args }.
 */
export function parseAgentCommand(agentStr: string): { command: string; args: string[] } {
  const parts = agentStr.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || !parts[0]) {
    throw new Error("Agent command cannot be empty");
  }
  return { command: parts[0], args: parts.slice(1) };
}

/**
 * Resolve a preset name or raw command string to a concrete ResolvedAgentConfig.
 */
export function resolveAgentSelection(
  agentSelection: string,
  registry: Record<string, AgentPreset> = BUILT_IN_AGENTS
): ResolvedAgentConfig {
  const preset = registry[agentSelection.trim()];
  if (preset) {
    return {
      id: agentSelection.trim(),
      label: preset.label,
      command: preset.command,
      args: [...preset.args],
      env: preset.env ? { ...preset.env } : undefined,
      source: "preset",
    };
  }

  const parsed = parseAgentCommand(agentSelection);
  return { command: parsed.command, args: parsed.args, source: "raw" };
}

export function listBuiltInAgents(
  registry: Record<string, AgentPreset> = BUILT_IN_AGENTS
): Array<{ id: string; preset: AgentPreset }> {
  return Object.entries(registry)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, preset]) => ({ id, preset }));
}
