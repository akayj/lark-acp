# Release Guide

## Prerequisites

1. **NPM Account**: Create an account on [npmjs.com](https://npmjs.com)
2. **NPM Token**: Generate an access token (with "Automation" permission) at [npmjs.com/settings/tokens](https://www.npmjs.com/settings/tokens)
3. **GitHub Secret**: Add `NPM_TOKEN` to repository secrets at `Settings → Secrets and variables → Actions`

## Release Process

### 1. Prepare Release

Update `package.json` version:

```bash
# Semantic versioning: major.minor.patch
# Examples: 1.0.0 → 1.0.1 (patch), 1.1.0 (minor), 2.0.0 (major)
npm version patch  # or minor, major
```

This automatically:
- Updates `package.json` version
- Creates a git tag (e.g., `v1.0.1`)
- Creates a commit

### 2. Push to GitHub

```bash
git push origin main
git push origin --tags
```

### 3. GitHub Actions Workflow

Two workflows trigger automatically:

**`build.yml`** (on push to main):
- Runs on every push
- Builds binaries for: macOS arm64, macOS x86_64, Linux x86_64, Windows x86_64
- Uploads artifacts
- Creates GitHub Release with binaries (only on tag)

**`publish.yml`** (on tag push `v*`):
- Downloads binaries from GitHub Release
- Places them in `bin/` directory
- Publishes to npm with `npm publish`
- Updates GitHub Release notes

### 4. Verify Release

```bash
# Check npm package
npm view lark-acp@latest

# Test installation
npm install -g lark-acp@latest
lark-acp --version

# Or via Bun
bunx lark-acp --version
```

## Troubleshooting

### Build Fails

Check logs in GitHub Actions → Workflows → Build/Publish

Common issues:
- `npm publish` fails: Check `NPM_TOKEN` is valid (expires 90 days by default)
- Binary download fails: Ensure release artifacts exist

### Binary Not Downloaded

If `postinstall` fails to download binary:
- Falls back to sourcing from dist/ (requires Bun installed)
- Or run `bun install && bun run src/index.ts` manually

## Notes

- Semantic versioning: <https://semver.org/>
- Only tagged releases (format: `v*`) trigger npm publish
- Binaries are cached for 90 days on npm (CDN)
- Each npm publish increments the version; old versions remain available
