# Lark ACP Bridge

Bridge Lark/Feishu messages to any ACP-compatible AI agent.

`lark-acp` connects to the Lark/Feishu messaging platform via WebSocket, polls incoming direct messages and group mentions, forwards them to an ACP agent over stdio, and sends agent replies back to Lark.

Inspired by [wechat-acp](https://github.com/formulahendry/wechat-acp), but for Lark/Feishu.

## Features

- Lark/Feishu WebSocket event streaming (not polling)
- One ACP agent session per Lark conversation (1:1 DM or group chat)
- Built-in ACP agent presets for common CLIs
- Custom raw agent command support
- Agent thinking/reasoning display in Lark (optional)
- File system access for agents (read/write)
- Auto-approve tool permission requests
- Group chat support with `@mention` filtering
- Real-time typing indicator (emoji reaction)
- Built with Bun + TypeScript for speed

## Requirements

- [Bun](https://bun.sh) 1.0.0+
- Lark/Feishu bot app credentials (App ID + App Secret)
- An ACP-compatible agent available locally or through `bunx`

## Quick Start

Start with a built-in agent preset:

```bash
# Install from npm (recommended)
npm install -g lark-acp
# or via Bun
bun install -g lark-acp

# Initialize config
lark-acp init                    # creates lark-acp.json, configure with your Lark credentials

# Start the bridge
lark-acp start                   # or: lark-acp start --agent copilot
```

Or use a raw custom command:

```bash
lark-acp start --agent "bunx my-agent --acp"
```

On first run, the bridge will:

1. Load config from `lark-acp.json` (or `~/.lark-acp/config.json`)
2. Connect to Lark via WebSocket
3. Begin polling for direct messages and group mentions
4. Route each message to an isolated ACP session per chat

## Configuration

### Config File

Create or edit `lark-acp.json` (search order: `$LARK_ACP_CONFIG` → `./lark-acp.json` → `~/.lark-acp/config.json`):

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

See `lark-acp.example.json` for the full schema.

### CLI Options

```text
lark-acp init [options]          initialize config file
lark-acp agents                  list built-in agent presets
lark-acp start [options]         start the bridge
lark-acp --help                  show help
lark-acp --version               show version
```

Start options:

- `--agent <preset|command>`: Built-in preset name (e.g., `claude`, `copilot`) or raw command string
- `--cwd <dir>`: Working directory for the agent process
- `--config <file>`: Load JSON config file (overrides default search)
- `--idle-timeout <minutes>`: Session idle timeout in minutes (default: 30; use 0 for unlimited)
- `--max-concurrent <count>`: Maximum concurrent agent sessions (default: 10)
- `--show-thoughts`: Display agent thinking/reasoning in Lark (default: off)

Examples:

```bash
lark-acp start --agent copilot
lark-acp start --agent claude --cwd ~/my-project
lark-acp start --agent "bunx my-agent --acp" --show-thoughts
```

## Built-in Agent Presets

List available presets:

```bash
lark-acp agents
```

Current presets:

| Preset | Agent | Command |
|--------|-------|---------|
| `claude` | Claude Code | `bunx @zed-industries/claude-code-acp` |
| `copilot` | GitHub Copilot | `bunx @github/copilot --acp --yolo` |
| `gemini` | Google Gemini | `bunx @google/gemini-cli --experimental-acp` |
| `qwen` | Qwen Code | `bunx @qwen-code/qwen-code --acp --experimental-skills` |
| `codex` | OpenAI Codex | `bunx @zed-industries/codex-acp` |
| `opencode` | OpenCode | `bunx opencode-ai acp` |
| `pi` | Pi | `bunx -y pi-acp` |

## Getting Lark Credentials

1. Go to [Lark Open Platform](https://open.larkoffice.com/)
2. Create a new app → enable "Bot" capability
3. Get App ID and App Secret from "Credentials & Basic Info"
4. Subscribe to `im.message.receive_v1` events
5. Configure the webhook URL to your bridge's public address (if using WebSocket mode)

## Architecture

```
src/
├── config/         # Config loading, validation, singleton
├── services/
│   ├── lark.ts    # Lark SDK: event dispatcher, reply handling, dedup
│   └── acp.ts     # ACP session manager: spawn, queue, evict
├── agents.ts       # Built-in agent preset registry and resolver
├── cli.ts          # CLI arg parsing (init, agents, start)
└── index.ts        # Entry point: boot sequence
```

## How It Works

1. **Event Dispatcher**: Listens for incoming messages via Lark WebSocket
   - Filters duplicates, validates mentions (for group chats)
   - Routes to ACP session manager
2. **Session Manager**: One ACP agent process per chat (group or DM)
   - Queues messages and processes them sequentially per user
   - Auto-evicts oldest sessions when max concurrent reached
   - Spawns fresh process on first message, reuses for subsequent messages
3. **ACP Protocol**: Bidirectional communication over stdin/stdout ndjson
   - Streams message chunks in real-time
   - Handles tool calls with permission gating
   - Captures and displays agent thinking (if enabled)
4. **Reply Handler**: Sends agent responses back to Lark
   - Splits long replies into Lark-safe chunks (≤4000 chars at paragraph breaks)
   - Removes typing indicator emoji reaction
5. **Idle Cleanup**: Every 5 minutes, kills sessions idle for `idleTimeoutMs`

## Runtime Behavior

- Each Lark conversation (1:1 DM or group) gets a dedicated ACP session and subprocess
- Messages are processed serially per conversation
- Replies are formatted for Lark before sending (markdown → text)
- A thinking emoji (💭) is added while processing; removed when reply is sent
- Sessions are cleaned up after inactivity (set `idleTimeoutMs` to `0` to disable)
- Tool calls are logged in real-time for debugging

## Storage

By default, runtime files are stored at:

```text
~/.lark-acp/config.json          # fallback config location
```

The bridge does NOT persist any conversation history or state — each session is ephemeral.

## Current Limitations

- **Text messages only** — Non-text messages (images, files, voice) are rejected with a friendly message
- **Sequential processing** — Messages per conversation are processed one-by-one (not in parallel)
- **No group context reuse** — Group chats do not share agent context with 1:1 DMs with the same user
- **No MCP server support yet** — `mcpServers` config is parsed but not wired to the ACP protocol
- **Permission requests are auto-approved** — No user confirmation dialog (configurable via `autoApprovePermissions`)
- **Agent communication is subprocess-only over stdio** — No network-based agent support
- **Some preset agents may require separate auth** — e.g., Claude Code requires API key setup

## Development

### Local Setup

```bash
git clone <repo-url>
cd lark-acp
bun install
```

### Development Commands

```bash
bun run dev              # start with file watching
bun run start            # start without watching
bun run build            # compile to single binary at dist/lark-acp
bun run typecheck        # run TypeScript type checker
bun run check            # run Biome lint + format check
bun run format           # auto-format code in place
```

### Installing Locally

```bash
bun run install-bin      # build and install to ~/.local/bin/lark-acp
~/.local/bin/lark-acp --help
```

## Contributing

Contributions are welcome! Please ensure:

- `bun run check` passes (lint + format)
- `bun run typecheck` passes
- Code follows the existing style in `CLAUDE.md`

For release/publishing workflow, see [.github/RELEASE.md](.github/RELEASE.md).

## License

MIT
