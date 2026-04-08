# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Lark ACP Bridge — connects Lark/Feishu messaging to any ACP-compatible AI agent (Claude, Copilot, Gemini, Qwen, etc.) via the Agent Client Protocol. Receives Lark messages over WebSocket, routes them to a spawned ACP agent process per user, and relays responses back.

## Toolchain

**Use Bun exclusively** — not Node, npm, pnpm, or Vite. This is a Bun-first project.

## Commands

- `bun install` — install dependencies
- `bun run dev` — start with file watching
- `bun run start` — start without watching
- `bun run build` — compile to single binary at `dist/lark-acp`
- `bun run install-bin` — build + copy to `~/.local/bin/lark-acp`
- `bun run typecheck` — run `tsc --noEmit`
- `bun run check` — run Biome lint + format check (CI)
- `bun run lint` — lint only
- `bun run format` — auto-format in place

## Architecture

The app is a long-running process with no HTTP server — it connects to Lark's event stream via WebSocket (`lark.WSClient`).

**Entry flow:** `src/index.ts` → `src/cli.ts` parses CLI args (handles `init`, `agents`, `--agent` override) → on `start` command, boots the bridge: creates Lark client, resolves bot identity, builds event dispatcher, connects WebSocket.

**Key modules:**

- `src/agents.ts` — Built-in agent preset registry (`BUILT_IN_AGENTS`) and resolver. Presets map names like `claude`, `copilot`, `gemini` to concrete `{ command, args, env }`. Raw command strings (e.g. `"bunx my-agent --acp"`) are also supported.
- `src/config/index.ts` — Loads `lark-acp.json` config (search order: `$LARK_ACP_CONFIG` → `./lark-acp.json` → `~/.lark-acp/config.json`), validates, resolves agent selection, and exposes a lazy singleton via `getConfig()`. Agent can be overridden at runtime with `setAgentOverride()`.
- `src/services/acp.ts` — `AcpSessionManager` manages one ACP child process per user. Each session holds a `ClientSideConnection` (from `@agentclientprotocol/sdk`) communicating over stdin/stdout ndjson streams. Messages are queued per-session and processed sequentially. Idle sessions are reaped on a timer; oldest sessions are evicted when `maxConcurrent` is hit.
- `src/services/lark.ts` — Lark SDK integration: client creation, bot identity lookup, message text extraction (strips @mentions), reply splitting (4000-char chunks), dedup cache, and the `EventDispatcher` that wires incoming `im.message.receive_v1` events to the ACP session manager.

**Session lifecycle:** Lark message → dedup check → extract text → `AcpSessionManager.enqueue()` → spawn agent process if new user → ACP `initialize` + `newSession` → `prompt()` → flush accumulated chunks → reply via Lark API. Sessions auto-terminate after idle timeout.

## Config

Configuration is a JSON file (`lark-acp.json`). See `lark-acp.example.json` for the schema. The `agent` field accepts either a built-in preset name or a raw shell command string.
