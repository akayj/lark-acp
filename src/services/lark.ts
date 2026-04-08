import * as lark from "@larksuiteoapi/node-sdk";
import { getConfig } from "../config/index.ts";
import type { AcpSessionManager } from "./acp.ts";

// ── Lark client ───────────────────────────────────────────────────────────────

export async function createLarkClient() {
  const cfg = await getConfig();
  return new lark.Client({
    appId: cfg.lark.appId,
    appSecret: cfg.lark.appSecret,
    appType: lark.AppType.SelfBuild,
  });
}

// ── Bot identity ──────────────────────────────────────────────────────────────

interface BotInfoResponse {
  code?: number;
  bot?: { open_id?: string; app_name?: string };
}

export async function getBotOpenId(client: lark.Client): Promise<string> {
  if (process.env.LARK_BOT_OPEN_ID) return process.env.LARK_BOT_OPEN_ID;

  const res = await client.request<BotInfoResponse>({
    method: "GET",
    url: "/open-apis/bot/v3/info",
  });

  const openId = res?.bot?.open_id;
  if (!openId) {
    throw new Error("Could not get bot open_id. Set LARK_BOT_OPEN_ID env var as a fallback.");
  }
  return openId;
}

// ── Text extraction ───────────────────────────────────────────────────────────

/**
 * Extract plain text from a Lark message content JSON string.
 * Strips @mentions by only removing tokens that appear at the start of a line
 * or after whitespace (avoids mangling email addresses like user@domain.com).
 */
function extractText(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: string };
    // Match @word only when preceded by start-of-string or whitespace,
    // so "user@domain.com" is preserved while "@Bot hello" → "hello".
    return (parsed.text ?? "").replace(/(^|\s)@\S+/g, "$1").trim();
  } catch {
    return content.trim();
  }
}

function isBotMentioned(
  mentions: Array<{ id?: { open_id?: string } }> | undefined,
  botOpenId: string
): boolean {
  return mentions?.some((m) => m.id?.open_id === botOpenId) ?? false;
}

// ── Typing indicator (emoji reaction) ─────────────────────────────────────────
// While the agent is processing, we add a 🤔 reaction to the user's message
// so they know the bot has seen their request. Removed when the reply is sent.
// All operations are best-effort — a failed reaction never blocks the reply.

interface ReactionCreateResponse {
  data?: { reaction_id?: string };
}

async function addTypingReaction(
  client: lark.Client,
  messageId: string
): Promise<string | undefined> {
  try {
    const res = await client.request<ReactionCreateResponse>({
      method: "POST",
      url: `/open-apis/im/v1/messages/${messageId}/reactions`,
      data: { reaction_type: { emoji_type: "THINKING" } },
    });
    return res?.data?.reaction_id;
  } catch {
    return undefined; // typing indicator is best-effort
  }
}

async function removeTypingReaction(
  client: lark.Client,
  messageId: string,
  reactionId: string
): Promise<void> {
  try {
    await client.request({
      method: "DELETE",
      url: `/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`,
    });
  } catch {
    // best-effort — don't block the reply if removal fails
  }
}

// ── Reply helpers ─────────────────────────────────────────────────────────────

const MAX_TEXT_LEN = 4000;

/**
 * Split text into Lark-safe chunks (≤ 4000 chars each).
 * Breaks preferentially at paragraph boundaries (\n\n), then line breaks,
 * then spaces — only hard-cuts if no natural break is found in the window.
 */
function splitText(text: string): string[] {
  if (!text) return ["(empty response)"];
  if (text.length <= MAX_TEXT_LEN) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_TEXT_LEN) {
    const window = remaining.slice(0, MAX_TEXT_LEN);
    // Prefer paragraph break, then newline, then space; hard-cut as last resort.
    let breakAt = window.lastIndexOf("\n\n");
    if (breakAt < MAX_TEXT_LEN / 2) breakAt = window.lastIndexOf("\n");
    if (breakAt < MAX_TEXT_LEN / 2) breakAt = window.lastIndexOf(" ");
    if (breakAt <= 0) breakAt = MAX_TEXT_LEN;

    chunks.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendReply(
  client: lark.Client,
  chatId: string,
  text: string,
  replyToMessageId?: string
) {
  const chunks = splitText(text);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (i === 0 && replyToMessageId) {
      await client.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { msg_type: "text", content: JSON.stringify({ text: chunk }) },
      });
    } else {
      await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: chunk }),
        },
      });
    }
  }
}

// ── Dedup cache ───────────────────────────────────────────────────────────────

class DedupCache {
  private seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(ttlMs = 300_000) {
    this.ttlMs = ttlMs;
    this.timer = setInterval(() => this.purge(), ttlMs);
    // Don't prevent process exit if the rest of the app has shut down.
    this.timer.unref();
  }

  has(id: string): boolean {
    const ts = this.seen.get(id);
    return ts !== undefined && Date.now() - ts < this.ttlMs;
  }

  add(id: string) {
    this.seen.set(id, Date.now());
  }

  destroy() {
    clearInterval(this.timer);
  }

  private purge() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }
}

// ── Event dispatcher ──────────────────────────────────────────────────────────

export async function buildEventDispatcher(
  larkClient: lark.Client,
  acpManager: AcpSessionManager,
  botOpenId: string
): Promise<lark.EventDispatcher> {
  const cfg = await getConfig();
  const dedup = new DedupCache();

  return new lark.EventDispatcher({
    encryptKey: cfg.lark.encryptKey,
    verificationToken: cfg.lark.verificationToken,
  }).register({
    "im.message.receive_v1": async (data) => {
      const msg = data.message;

      console.log(
        `[Lark] Event received: ${msg.chat_type} msg_type=${msg.message_type} ` +
          `from=${data.sender.sender_id?.open_id} id=${msg.message_id}`
      );

      // Filter out bot's own messages and unaddressed group messages early,
      // before dedup — so we never reserve an ID for messages we'd ignore anyway.
      const senderId = data.sender.sender_id?.open_id;
      if (!senderId || senderId === botOpenId) {
        console.log(`[Lark] Skipping bot's own message`);
        return;
      }

      if (msg.chat_type === "group" && !isBotMentioned(msg.mentions, botOpenId)) {
        console.log(`[Lark] Skipping group message without @mention`);
        return;
      }

      if (dedup.has(msg.message_id)) {
        console.log(`[Lark] Skipping duplicate message ${msg.message_id}`);
        return;
      }
      dedup.add(msg.message_id);

      if (msg.message_type !== "text") {
        console.log(`[Lark] Unsupported message type: ${msg.message_type}`);
        await sendReply(
          larkClient,
          msg.chat_id,
          "暂不支持该消息类型，请发送文字消息。",
          msg.message_id
        ).catch(() => {});
        return;
      }

      const userText = extractText(msg.content);
      if (!userText) {
        console.log(`[Lark] Skipping empty message`);
        return;
      }

      console.log(
        `[Lark] [${msg.chat_type}] ${senderId}: ${userText.slice(0, 80)}${userText.length > 80 ? "…" : ""}`
      );

      // Session key: chatId scopes the agent to one Lark conversation.
      // Group chats get a shared agent; DMs get per-user agents (chat_id is
      // unique per user pair in p2p chats, so this works for both cases).
      const sessionKey = msg.chat_id;

      // Each message gets its own reaction handle. The reaction is added just
      // before the agent starts processing and removed when the reply is sent.
      const typing = { reactionId: undefined as string | undefined };

      await acpManager.enqueue(sessionKey, userText, {
        onReply: async (reply) => {
          if (typing.reactionId) {
            await removeTypingReaction(larkClient, msg.message_id, typing.reactionId);
          }
          await sendReply(larkClient, msg.chat_id, reply, msg.message_id);
        },
        onError: async (_err) => {
          if (typing.reactionId) {
            await removeTypingReaction(larkClient, msg.message_id, typing.reactionId);
          }
          await sendReply(
            larkClient,
            msg.chat_id,
            "抱歉，AI 助手遇到了错误，请稍后重试。",
            msg.message_id
          ).catch(() => {});
        },
        onTyping: async () => {
          typing.reactionId = await addTypingReaction(larkClient, msg.message_id);
        },
        onThoughtFlush: cfg.agent.showThoughts
          ? async (thoughts) => {
              const formatted = `💭 思考过程\n\n${thoughts}`;
              await sendReply(larkClient, msg.chat_id, formatted, msg.message_id).catch(() => {});
            }
          : undefined,
      });
    },
  });
}
