# Lark ACP Bridge

Bridge Lark/Feishu messages to any ACP-compatible AI agent.

`lark-acp` connects to Lark/Feishu via WebSocket, forwards incoming messages to an ACP agent over stdio, and sends the agent reply back to Lark.

Inspired by [wechat-acp](https://github.com/formulahendry/wechat-acp), but for Lark/Feishu.

## Features

- Lark/Feishu WebSocket long-connection (no polling, no public webhook URL needed)
- One ACP agent session per Lark conversation (1:1 DM or group chat)
- Built-in presets for Claude, Copilot, Gemini, Qwen, Codex, OpenCode, Pi
- Custom raw agent command support
- Agent thinking/reasoning display in Lark (optional)
- File system access for agents (read/write)
- Auto-approve tool permission requests
- Group chat support with `@mention` filtering
- Typing indicator via emoji reaction

## Requirements

- Node.js 20+ or Bun 1.0+
- Lark/Feishu bot app credentials (App ID + App Secret)
- An ACP-compatible agent CLI

## Quick Start

```bash
# Install
npx lark-acp init        # or: bunx lark-acp init

# Edit lark-acp.json with your credentials, then:
npx lark-acp             # or: bunx lark-acp
```

Override the agent at runtime:

```bash
npx lark-acp --agent copilot
npx lark-acp --agent "bunx my-agent --acp"
```

## Configuration

`lark-acp init` creates `lark-acp.json` in the current directory.

Config search order: `$LARK_ACP_CONFIG` → `./lark-acp.json` → `~/.lark-acp/config.json`

```json
{
  "lark": {
    "appId": "cli_xxxxxxxxxxxx",
    "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "botName": "AI Assistant",
    "encryptKey": "",
    "verificationToken": ""
  },
  "agent": "claude",
  "acp": {
    "cwd": "",
    "idleTimeoutMs": 1800000,
    "maxConcurrent": 10,
    "showThoughts": false,
    "mcpServers": []
  },
  "autoApprovePermissions": true
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `agent` | — | Preset name or raw command string |
| `acp.idleTimeoutMs` | `1800000` | Session idle timeout in ms (0 = never expire) |
| `acp.maxConcurrent` | `10` | Max concurrent agent sessions |
| `acp.showThoughts` | `false` | Display agent reasoning in Lark before reply |
| `autoApprovePermissions` | `true` | Auto-approve agent tool requests |

## CLI

```text
lark-acp [start]         Start the bridge (default command)
lark-acp init            Create lark-acp.json in the current directory
lark-acp agents          List built-in agent presets
lark-acp --agent <val>   Override agent (preset name or raw command)
lark-acp --help
lark-acp --version
```

## Built-in Agent Presets

| Preset | Agent |
|--------|-------|
| `claude` | Claude Code |
| `copilot` | GitHub Copilot |
| `gemini` | Google Gemini |
| `qwen` | Qwen Code |
| `codex` | OpenAI Codex |
| `opencode` | OpenCode |
| `pi` | Pi |

Run `lark-acp agents` to see the full command for each preset.

## Getting Lark Credentials

1. Go to [Lark Open Platform](https://open.larkoffice.com/) and create an app
2. Enable "Bot" capability
3. Get App ID + App Secret from "Credentials & Basic Info"
4. Subscribe to the `im.message.receive_v1` event
5. Enable long-connection mode under "Event Subscriptions" (no public URL required)

## Development

```bash
git clone https://github.com/akayj/lark-acp
cd lark-acp
bun install

bun run dev          # start with file watching
bun run typecheck    # TypeScript type check
bun run check        # Biome lint + format check
bun run format       # auto-format
bun run build        # compile to single binary → dist/lark-acp
```

## License

MIT
