# GitHub Workflow Setup Summary

This document describes the automated build and publish workflows for lark-acp.

## Files Created

### Workflows

1. **`.github/workflows/build.yml`**
   - Triggered: On every push to `main` and pull requests
   - Matrix builds for: macOS (arm64, x86_64), Linux (x86_64), Windows (x86_64)
   - Outputs: Artifacts + GitHub Release (on tags)
   - Runs: typecheck, lint, build

2. **`.github/workflows/publish.yml`**
   - Triggered: When a tag matching `v*` is pushed
   - Downloads binaries from GitHub Release
   - Publishes to npm using `NPM_TOKEN` secret
   - Automatically executable via `npm install -g lark-acp`

### Supporting Files

3. **`scripts/download-binary.js`**
   - npm postinstall script
   - Downloads precompiled binary for the user's platform
   - Falls back gracefully if download fails
   - Makes the binary executable

4. **`package.json` (updated)**
   - Added `"bin"` pointing to `./bin/lark-acp`
   - Added `"files"` to control what's published to npm
   - Added `"postinstall"` script hook

5. **`bin/` directory**
   - Placeholder for downloaded binaries
   - `.gitkeep` ensures directory exists in git
   - Binaries are gitignored (only download at install time)

## Configuration Needed

### One-time Setup

1. **Get NPM Token** (see `.github/NPM_SETUP.md`)
   - Create npm account if needed
   - Generate Automation token
   - Add to GitHub Secrets as `NPM_TOKEN`

2. **Update GitHub URLs** in scripts/download-binary.js
   - Replace `你的用户名` with your actual GitHub username
   - Pattern: `github.com/username/lark-acp`

### Per-Release

1. Update version in `package.json`:
   ```bash
   npm version patch  # or minor, major
   ```

2. Push to GitHub:
   ```bash
   git push origin main --tags
   ```

## Workflow Behavior

### On Every Push

**build.yml** runs:
- Install dependencies
- Typecheck
- Lint
- Build binaries for all platforms
- Upload artifacts

If push is a tag (v*), also:
- Create GitHub Release with all binaries

### On Tag Push (v*)

**publish.yml** runs (after build completes):
- Download binaries from Release
- Publish to npm
- Update Release notes

Users can then install:
```bash
npm install -g lark-acp
```

## Artifact Naming

Build artifacts follow this pattern:
- macOS arm64: `lark-acp-macos-arm64`
- macOS x86_64: `lark-acp-macos-x86_64`
- Linux x86_64: `lark-acp-linux-x86_64`
- Windows x86_64: `lark-acp.exe`

The download script maps platform/arch to these names.

## Testing the Workflow

1. **Dry run (no publish):**
   ```bash
   git push origin main  # triggers build.yml only
   ```
   Monitor at: https://github.com/你的用户名/lark-acp/actions

2. **Full release (with publish):**
   ```bash
   npm version patch
   git push origin main --tags
   ```
   This triggers both build.yml and publish.yml.

## Troubleshooting

See `.github/NPM_SETUP.md` for common issues.

## References

- GitHub Actions docs: https://docs.github.com/en/actions
- npm publishing: https://docs.npmjs.com/cli/v10/commands/npm-publish
- Semantic versioning: https://semver.org/
