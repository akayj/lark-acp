#!/usr/bin/env bun

import * as lark from "@larksuiteoapi/node-sdk";
// All imports hoisted first — clean and predictable module load order.
// runCli() exits early for --help, --version, init, agents before main() runs.
import { runCli } from "./cli.ts";
import { getConfig, setAgentOverride } from "./config/index.ts";
import { AcpSessionManager } from "./services/acp.ts";
import { buildEventDispatcher, createLarkClient, getBotOpenId } from "./services/lark.ts";

const cliResult = runCli();
if (cliResult.agentOverride) {
  setAgentOverride(cliResult.agentOverride);
}

async function main() {
  console.log("[Boot] Starting Lark ACP Bridge...");

  const cfg = await getConfig();
  const larkClient = await createLarkClient();

  const botOpenId = await getBotOpenId(larkClient);
  console.log(`[Boot] Bot open_id: ${botOpenId}`);

  const acpManager = await AcpSessionManager.create();
  const eventDispatcher = await buildEventDispatcher(larkClient, acpManager, botOpenId);

  const wsClient = new lark.WSClient({
    appId: cfg.lark.appId,
    appSecret: cfg.lark.appSecret,
  });

  console.log("[Boot] Connecting to Lark event stream via WebSocket...");
  await wsClient.start({ eventDispatcher });

  const shutdown = () => {
    console.log("\n[Boot] Shutting down...");
    wsClient.close({ force: false });
    acpManager.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Boot] Fatal error:", err);
  process.exit(1);
});
