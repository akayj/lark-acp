import { existsSync } from "node:fs";
import path from "node:path";
import { BUILT_IN_AGENTS, listBuiltInAgents } from "./agents.ts";

const VERSION = "1.0.0";

const HELP = `\
lark-acp — Bridge Lark/Feishu messages to any ACP-compatible AI agent

Usage:
  lark-acp [command] [flags]

Commands:
  start          Start the bridge service (default)
  init           Create a starter config file in the current directory
  agents         List built-in ACP agent presets

Flags:
  --agent <name|cmd>  Override agent (preset name or raw command)
  -h, --help          Show this help message
  -v, --version       Show version

Config file search order:
  1. $LARK_ACP_CONFIG
  2. ./lark-acp.json
  3. ~/.lark-acp/config.json

Examples:
  lark-acp                              # Start with config file agent
  lark-acp --agent claude               # Use built-in claude preset
  lark-acp --agent copilot              # Use built-in copilot preset
  lark-acp --agent "bun run ./agent.ts" # Use a custom command
  lark-acp init                         # Create lark-acp.json
  lark-acp agents                       # List available presets
`;

const EXAMPLE_CONFIG = {
  lark: {
    appId: "cli_xxxxxxxxxxxx",
    appSecret: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    botName: "AI Assistant",
    encryptKey: "",
    verificationToken: "",
  },
  agent: "",
  acp: {
    idleTimeoutMs: 1800000, // 30 minutes
    maxConcurrent: 10,
    showThoughts: false,
    mcpServers: [],
  },
  autoApprovePermissions: true,
};

export interface CliResult {
  command: "start";
  agentOverride?: string;
}

export function runCli(): CliResult {
  const args = process.argv.slice(2);
  let agentOverride: string | undefined;

  // Parse flags
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    }

    if (arg === "-v" || arg === "--version") {
      console.log(VERSION);
      process.exit(0);
    }

    if (arg === "--agent") {
      agentOverride = args[++i];
      if (!agentOverride) {
        console.error("Error: --agent requires a value\nRun 'lark-acp --help' for usage.");
        process.exit(1);
      }
      continue;
    }

    if (arg.startsWith("--agent=")) {
      agentOverride = arg.slice("--agent=".length);
      if (!agentOverride) {
        console.error("Error: --agent requires a value\nRun 'lark-acp --help' for usage.");
        process.exit(1);
      }
      continue;
    }

    positional.push(arg);
  }

  const cmd = positional[0];

  if (cmd === "agents") {
    console.log("Built-in ACP agent presets:\n");
    for (const { id, preset } of listBuiltInAgents(BUILT_IN_AGENTS)) {
      console.log(`  ${id.padEnd(12)} ${preset.label}`);
      console.log(`               ${preset.command} ${preset.args.join(" ")}`);
      if (preset.description) {
        console.log(`               ${preset.description}`);
      }
      console.log();
    }
    process.exit(0);
  }

  if (cmd === "init") {
    const dest = path.resolve("lark-acp.json");
    if (existsSync(dest)) {
      console.error(`Error: ${dest} already exists`);
      process.exit(1);
    }
    const agentList = Object.keys(BUILT_IN_AGENTS).join(" | ");
    const cfg = {
      ...EXAMPLE_CONFIG,
      _comment: `agent presets: ${agentList}`,
    };
    Bun.write(dest, `${JSON.stringify(cfg, null, 2)}\n`);
    console.log(`Created ${dest}`);
    console.log("Edit it with your Lark credentials and preferred agent, then run: lark-acp");
    process.exit(0);
  }

  if (cmd && cmd !== "start") {
    console.error(`Unknown command: ${cmd}\nRun 'lark-acp --help' for usage.`);
    process.exit(1);
  }

  return { command: "start", agentOverride };
}
