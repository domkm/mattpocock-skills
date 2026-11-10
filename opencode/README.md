# OpenCode V2

Registers the skills listed in `.claude-plugin/plugin.json` using their existing `SKILL.md` files. The package includes their supporting files.

See the [installation instructions](../README.md#1-get-the-skills).

## Local checkout

Run `npm ci`, then merge this into the project's `opencode.jsonc`, using its absolute directory:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/mattpocock-skills"]
}
```

## Checks

The SDK integration check uses Bun. The other checks use the repository's Node.js toolchain.

```bash
npm run typecheck
npm test
npm run test:package
npm run check-plugin-version
```

The package check installs a tarball and tests it in an OpenCode V2 SDK host with a temporary home, configuration, and database. It does not call a model.

The OpenCode dependency tree has transitive security advisories. Run `npm audit` to review them.

References: [skill API](https://opencode.ai/docs/build/plugins/server#skills) and [package management](https://opencode.ai/docs/plugins).
