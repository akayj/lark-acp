# NPM Publishing Setup (One-time)

## Step 1: Create NPM Account

If you don't have an npm account yet:

```bash
npm adduser
# or visit https://www.npmjs.com/signup
```

## Step 2: Generate NPM Token

1. Go to https://www.npmjs.com/settings/tokens
2. Click "Generate New Token"
3. Select **Automation** permission (allows publishing without OTP)
4. Copy the token (you'll only see it once)

## Step 3: Add to GitHub Secrets

1. Go to `Settings` → `Secrets and variables` → `Actions` in your GitHub repo
2. Click "New repository secret"
3. Name: `NPM_TOKEN`
4. Value: Paste the token from Step 2
5. Click "Add secret"

## Done!

Now whenever you push a tag like `v1.0.0`, the workflow will:
1. Build binaries for macOS (arm64, x86_64), Linux, Windows
2. Create a GitHub Release with the binaries
3. Publish to npm automatically

## Releasing

```bash
# Update version (creates tag automatically)
npm version patch  # or minor, major

# Push to GitHub (triggers workflows)
git push origin main --tags
```

Check progress at: https://github.com/你的用户名/lark-acp/actions

## Troubleshooting

**"401 Unauthorized" on npm publish:**
- Token expired? Generate a new one and update `NPM_TOKEN` secret

**Binary download fails in publish workflow:**
- Check that build.yml completed and created GitHub Release
- Verify artifact names match the download-binary.js expectations

**Binary not found when users install:**
- The postinstall script gracefully falls back to source build (requires Bun)
- Users can also install from source: `bun install -g github:you/lark-acp`
