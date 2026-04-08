import { type ChildProcessByStdio, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type {
  Client,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import pkg from "../../package.json";
import { getConfig, type ResolvedConfig } from "../config/index.ts";

// ── Process lifecycle ─────────────────────────────────────────────────────────

/**
 * Gracefully terminate an agent process: SIGTERM first, SIGKILL after 5 s
 * if the process is still alive. Prevents zombie agent processes.
 */
function killProcess(proc: ChildProcessByStdio<Writable, Readable, null>): void {
  if (proc.killed || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  setTimeout(() => {
    if (!proc.killed && proc.exitCode === null) proc.kill("SIGKILL");
  }, 5_000).unref();
}

// ── ACP client ────────────────────────────────────────────────────────────────
// One instance per session; accumulates streamed chunks, handles permissions,
// and provides filesystem access so the agent can read/write files.

class LarkAcpClient implements Client {
  private messageChunks: string[] = [];
  private thoughtChunks: string[] = [];
  private thoughtFlushCallback?: (text: string) => Promise<void>;

  constructor(private autoApprove: boolean) {}

  setThoughtCallback(cb: ((text: string) => Promise<void>) | undefined): void {
    this.thoughtFlushCallback = cb;
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const label = params.toolCall.title ?? "unknown tool";

    if (this.autoApprove) {
      const first =
        params.options.find((o) => o.kind === "allow_once") ??
        params.options.find((o) => o.kind === "allow_always") ??
        params.options[0];

      if (first) {
        console.log(`[ACP] Auto-approving: ${label} → ${first.name}`);
        return { outcome: { outcome: "selected", optionId: first.optionId } };
      }
    }

    console.log(`[ACP] Permission cancelled: ${label}`);
    return { outcome: { outcome: "cancelled" } };
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const update = params.update;
    if (update.sessionUpdate === "agent_message_chunk") {
      // Flush any accumulated thoughts before the first message chunk arrives.
      await this.maybeFlushThoughts();
      const block = update.content;
      if (block.type === "text") this.messageChunks.push(block.text);
    } else if (update.sessionUpdate === "agent_thought_chunk") {
      const block = update.content;
      if (block.type === "text") {
        // Always log a preview for debugging regardless of showThoughts.
        const preview = block.text.length > 80 ? `${block.text.slice(0, 80)}…` : block.text;
        console.log(`[ACP] [thought] ${preview}`);
        this.thoughtChunks.push(block.text);
      }
    } else if (update.sessionUpdate === "tool_call") {
      console.log(`[ACP] [tool] → ${update.title}`);
    } else if (update.sessionUpdate === "tool_call_update") {
      const status = update.status;
      if (status === "completed" || status === "failed") {
        console.log(`[ACP] [tool] ← ${update.title} (${status})`);
      }
    }
  }

  // ── Filesystem access (fs capability) ──────────────────────────────────────
  // Allows the agent to read/write files within the configured cwd.
  // Errors are re-thrown as plain Error so ACP can relay them to the agent;
  // the agent will then respond with an explanation rather than silently
  // ending the turn with 0 message chunks.

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    try {
      const file = Bun.file(params.path);
      if (!(await file.exists())) {
        throw new Error(`File not found: ${params.path}`);
      }
      const content = await file.text();
      return { content };
    } catch (err) {
      throw new Error(`readTextFile failed for "${params.path}": ${String(err)}`);
    }
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    try {
      await Bun.write(params.path, params.content);
      return {};
    } catch (err) {
      throw new Error(`writeTextFile failed for "${params.path}": ${String(err)}`);
    }
  }

  /** Flush accumulated thoughts via callback (no-op if no chunks or no callback). */
  private async maybeFlushThoughts(): Promise<void> {
    if (this.thoughtChunks.length === 0) return;
    const text = this.thoughtChunks.join("").trim();
    this.thoughtChunks = [];
    if (!text || !this.thoughtFlushCallback) return;
    await this.thoughtFlushCallback(text).catch(() => {});
  }

  /** Collect accumulated message text and reset buffers. */
  async flush(): Promise<string> {
    // Safety net: flush thoughts in case agent produced only thoughts (no message).
    await this.maybeFlushThoughts();
    const message = this.messageChunks.join("").trim();
    this.messageChunks = [];
    return message;
  }
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface EnqueueOpts {
  onReply: (reply: string) => Promise<void>;
  onError: (err: unknown) => Promise<void>;
  /** Called once just before the prompt is sent — use for typing indicators. */
  onTyping?: () => Promise<void>;
  /** Called when thought chunks are ready to be displayed (before message reply). */
  onThoughtFlush?: (thoughts: string) => Promise<void>;
}

interface QueueItem extends EnqueueOpts {
  text: string;
}

interface Session {
  /** Session key — chatId for group chats, userId for DMs. */
  key: string;
  connection: ClientSideConnection;
  sessionId: string;
  proc: ChildProcessByStdio<Writable, Readable, null>;
  client: LarkAcpClient;
  queue: QueueItem[];
  processing: boolean;
  lastActivity: number;
  createdAt: number;
}

// ── Session manager ───────────────────────────────────────────────────────────

export class AcpSessionManager {
  private sessions = new Map<string, Session>();
  private cleanupTimer!: ReturnType<typeof setInterval>;
  private cfg!: ResolvedConfig;
  private aborted = false;

  private constructor() {}

  static async create(): Promise<AcpSessionManager> {
    const mgr = new AcpSessionManager();
    mgr.cfg = await getConfig();
    // Check for idle sessions every 5 minutes; unref so it won't block exit.
    mgr.cleanupTimer = setInterval(() => mgr.cleanupIdleSessions(), 5 * 60_000);
    mgr.cleanupTimer.unref();
    return mgr;
  }

  /**
   * Enqueue a message for the given session key.
   * Sessions are scoped per Lark chat (chatId for groups, userId for DMs)
   * so each conversation has isolated agent context.
   * Returns immediately; reply is delivered via onReply callback.
   */
  async enqueue(key: string, text: string, opts: EnqueueOpts): Promise<void> {
    let session = this.sessions.get(key);

    if (!session) {
      if (this.sessions.size >= this.cfg.session.maxConcurrent) {
        this.evictOldest();
      }
      session = await this.createSession(key);
      this.sessions.set(key, session);
    }

    session.lastActivity = Date.now();
    session.queue.push({ text, ...opts });

    if (!session.processing) {
      session.processing = true;
      this.processQueue(session).catch((err) => {
        console.error(`[ACP] Queue error for ${key}:`, err);
      });
    }
  }

  private async processQueue(session: Session): Promise<void> {
    try {
      while (session.queue.length > 0 && !this.aborted) {
        const item = session.queue.shift()!;
        session.lastActivity = Date.now();

        // Signal typing before sending the prompt — best-effort, never blocks.
        item.onTyping?.().catch(() => {});

        try {
          session.client.setThoughtCallback(item.onThoughtFlush);
          const result = await session.connection.prompt({
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: item.text }],
          });

          let reply = await session.client.flush();
          session.client.setThoughtCallback(undefined);

          if (result.stopReason === "cancelled") reply += "\n[cancelled]";
          else if (result.stopReason === "refusal") reply += "\n[agent refused]";

          if (!reply) {
            console.warn(
              `[ACP] [${session.key}] Agent returned 0 chars (stopReason=${result.stopReason}) — ` +
                "possible tool error or unsupported request"
            );
          }
          console.log(`[ACP] [${session.key}] Done (${result.stopReason}), ${reply.length} chars`);

          await item.onReply(reply || "(no response)");
        } catch (err) {
          session.client.setThoughtCallback(undefined);
          console.error(`[ACP] [${session.key}] Prompt error:`, err);

          // If the agent process died, drop the session so the next message
          // spawns a fresh one automatically.
          if (session.proc.killed || session.proc.exitCode !== null) {
            console.log(`[ACP] Agent process died for ${session.key}, dropping session`);
            this.sessions.delete(session.key);
            await item.onError(err);
            return;
          }

          await item.onError(err);
        }
      }
    } finally {
      session.processing = false;
    }
  }

  private async createSession(key: string): Promise<Session> {
    const { agent, autoApprovePermissions } = this.cfg;
    const label = agent.label ?? agent.command;

    console.log(`[ACP] Spawning ${label} for ${key}${agent.id ? ` (preset: ${agent.id})` : ""}`);

    const proc = spawn(agent.command, agent.args, {
      stdio: ["pipe", "pipe", "inherit"] as ["pipe", "pipe", "inherit"],
      cwd: agent.cwd,
      env: { ...process.env, ...agent.env },
    }) as ChildProcessByStdio<Writable, Readable, null>;

    // Catch spawn errors (bad command, permission denied, etc.) before they
    // become unhandled rejections.
    proc.on("error", (err) => {
      console.error(`[ACP] Agent process error for ${key}:`, err);
      this.sessions.delete(key);
    });

    if (!proc.stdin || !proc.stdout) {
      killProcess(proc);
      throw new Error(`[ACP] Failed to open stdin/stdout pipes for agent process (key=${key})`);
    }

    const stdinStream = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
    const stdoutStream = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;

    const acpClient = new LarkAcpClient(autoApprovePermissions);
    const stream = ndJsonStream(stdinStream, stdoutStream);
    const connection = new ClientSideConnection((_agent) => acpClient, stream);

    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "lark-acp", title: "Lark ACP Bridge", version: pkg.version },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });

    const { sessionId } = await connection.newSession({
      cwd: agent.cwd,
      mcpServers: agent.mcpServers.map((s) => ({
        name: s.name,
        command: s.command,
        args: s.args ?? [],
        env: s.env ?? [],
      })),
    });

    console.log(`[ACP] Session ${sessionId} ready for ${key}`);

    proc.on("exit", (code: number | null) => {
      if (this.sessions.get(key)?.sessionId === sessionId) {
        console.log(`[ACP] Agent exited for ${key} (code ${code})`);
        this.sessions.delete(key);
      }
    });

    return {
      key,
      connection,
      sessionId,
      proc,
      client: acpClient,
      queue: [],
      processing: false,
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
  }

  private terminateSession(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    console.log(`[ACP] Terminating session for ${key}`);
    killProcess(session.proc);
    this.sessions.delete(key);
  }

  private cleanupIdleSessions(): void {
    if (this.cfg.session.idleTimeoutMs <= 0) return; // 0 = never expire
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (!session.processing && now - session.lastActivity > this.cfg.session.idleTimeoutMs) {
        const idleMin = Math.round((now - session.lastActivity) / 60_000);
        console.log(`[ACP] Session for ${key} idle ${idleMin}min, terminating`);
        this.terminateSession(key);
      }
    }
  }

  private evictOldest(): void {
    // Prefer idle sessions; fall back to the globally oldest if all are busy.
    let oldest: { key: string; lastActivity: number } | null = null;
    for (const [key, session] of this.sessions) {
      if (!session.processing && (!oldest || session.lastActivity < oldest.lastActivity)) {
        oldest = { key, lastActivity: session.lastActivity };
      }
    }
    if (!oldest) {
      for (const [key, session] of this.sessions) {
        if (!oldest || session.lastActivity < oldest.lastActivity) {
          oldest = { key, lastActivity: session.lastActivity };
        }
      }
    }
    if (oldest) {
      console.log(`[ACP] Evicting oldest session: ${oldest.key}`);
      this.terminateSession(oldest.key);
    }
  }

  destroy(): void {
    this.aborted = true;
    clearInterval(this.cleanupTimer);
    for (const key of [...this.sessions.keys()]) {
      this.terminateSession(key);
    }
  }
}
