#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");

const PKG = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const VERSION = PKG.version;

// Map platform/arch to release asset name
// Currently supported: macOS arm64, Linux x86_64
function getPlatformId() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") return "macos-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x86_64";

  console.warn(
    `⚠️  Unsupported platform: ${platform}-${arch}\n` +
      `   Currently supported: macOS arm64, Linux x86_64\n` +
      `   Falling back to source build (requires Bun)`
  );
  return null;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

async function downloadBinary() {
  const platformId = getPlatformId();
  if (!platformId) return;

  const binaryName = "lark-acp";
  const dest = path.join("bin", binaryName);

  // Skip if binary already exists
  if (fs.existsSync(dest)) {
    console.log(`✓ Binary already exists: ${dest}`);
    return;
  }

  const assetName = `lark-acp-${platformId}`;
  const url = `https://github.com/akayj/lark-acp/releases/download/v${VERSION}/${assetName}`;

  try {
    console.log(`⏳ Downloading ${platformId} binary...`);
    await downloadFile(url, dest);
    fs.chmodSync(dest, "0755");
    console.log(`✓ Binary installed: ${dest}`);
  } catch (err) {
    console.error(`✗ Failed to download binary:`, err.message);
    console.log(`  Falling back to: bun install && bun run src/index.ts`);
  }
}

// Run
downloadBinary().catch((err) => {
  console.error(err);
  process.exit(1);
});
