# Lark ACP Bridge

Bridge Lark/Feishu messages to any ACP-compatible AI agent.

Inspired by [wechat-acp](https://github.com/formulahendry/wechat-acp), but for Lark/Feishu.

## Features

- 🤖 Connect Lark/Feishu to any ACP-compatible AI agent (Claude, Copilot, Gemini, Qwen, etc.)
- 💬 Support both private messages and group mentions
- 💭 Display agent thinking/reasoning process in Lark (optional)
- ⏱️ Session management with idle timeout (per-chat isolation)
- 🎯 File system access (read/write) for agents
- 🔒 Auto-approve tool permission requests option
- ⚡ Built with Bun + TypeScript for speed and clarity

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- Lark/Feishu bot app credentials
- ACP-compatible AI agent CLI installed

## Installation

### From source (development)

```bash
git clone <repo-url>
cd lark-acp
bun install
bun run src/cli.ts init        # creates lark-acp.json
```

### Installed binary (production)

```bash
bun run install-bin            # builds and installs to ~/.local/bin/lark-acp
lark-acp init                  # creates lark-acp.json
```

## Configuration

Edit the generated `lark-acp.json` (see `lark-acp.example.json` for full schema):

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

**Config fields:**
- `lark.appId`, `lark.appSecret`: Lark app credentials
- `agent`: Preset name (`claude`, `copilot`, `gemini`, etc.) or raw command string
- `acp.idleTimeoutMs`: Session timeout in ms (30 min default; 0 = never expire)
- `acp.maxConcurrent`: Max concurrent agent processes (default 10)
- `acp.showThoughts`: Display agent thinking/reasoning in Lark (default false)
- `autoApprovePermissions`: Auto-approve tool permission requests (default true)

**Config search order:** `$LARK_ACP_CONFIG` → `./lark-acp.json` → `~/.lark-acp/config.json`

### Getting Lark Credentials

1. Go to [Lark Open Platform](https://open.larkoffice.com/)
2. Create a new app → enable "Bot" capability
3. Get App ID and App Secret from "Credentials & Basic Info"
4. Subscribe to `im.message.receive_v1` events

## Usage

### Setup

```bash
# Initialize config file (creates lark-acp.json in current directory)
lark-acp init

# List available agent presets
lark-acp agents

# Show help
lark-acp --help
```

### Development

```bash
bun run dev
```

### Production

```bash
bun run build
bun run start

# Or use the installed binary (if installed via bun run install-bin)
~/.local/bin/lark-acp start
```

### Runtime Options

```bash
# Override agent preset at runtime
lark-acp start --agent copilot

# Use a custom command
lark-acp start --agent "my-custom-acp-agent --some-flag"
```

## Architecture

```
src/
├── config/         # Config loading, validation, singleton
├── services/
│   ├── lark.ts    # Lark SDK: event dispatcher, reply, dedup
│   └── acp.ts     # ACP session manager: spawn, queue, evict
├── agents.ts       # Built-in agent preset registry
├── cli.ts          # CLI arg parsing (init, agents, --agent)
└── index.ts        # Entry point: boot sequence
```

## How It Works

1. **Event Dispatcher**: Listens for incoming messages via Lark WebSocket
   - Filters duplicates, validates mentions (for group chats)
   - Routes to ACP session manager
2. **Session Manager**: One ACP agent process per chat (group or DM)
   - Queues messages and processes them sequentially
   - Auto-evicts oldest sessions when max concurrent reached
   - Spawns fresh process on first message, reuses for subsequent messages
3. **ACP Protocol**: Bidirectional communication over stdin/stdout ndjson
   - Streams message chunks in real-time
   - Handles tool calls with permission gating
   - Captures and displays agent thinking (if enabled)
4. **Reply Handler**: Sends agent responses back to Lark
   - Splits long replies into Lark-safe chunks (≤4000 chars)
   - Removes typing indicator emoji reaction
5. **Idle Cleanup**: Every 5 minutes, kills sessions idle for `idleTimeoutMs`

## Supported ACP Agents

### Built-in Presets

Use the preset name in `lark-acp.json`'s `agent` field:

| Preset | Agent | Command |
|--------|-------|---------|
| `claude` | Claude Code | `bunx @zed-industries/claude-code-acp` |
| `copilot` | GitHub Copilot | `bunx @github/copilot --acp --yolo` |
| `gemini` | Google Gemini | `bunx @google/gemini-cli --experimental-acp` |
| `qwen` | Qwen Code | `bunx @qwen-code/qwen-code --acp --experimental-skills` |
| `codex` | OpenAI Codex | `bunx @zed-industries/codex-acp` |
| `opencode` | OpenCode | `bunx opencode-ai acp` |
| `pi` | Pi | `bunx -y pi-acp` |

### Custom Agents

To use any other ACP-compatible CLI, pass a raw command string in `lark-acp.json`:

```json
{
  "agent": "custom-agent-cli --acp --my-flag"
}
```

The command is parsed as-is and spawned directly.

## License

MIT
