import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Host } from "@opencode/plugin/host";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "mattpocock-package-"));

try {
  const [packed] = JSON.parse(execFileSync(
    "npm", ["pack", "--json", "--pack-destination", temporary],
    { cwd: root, encoding: "utf8" },
  ));
  const manifest = JSON.parse(await readFile(join(root, ".claude-plugin/plugin.json"), "utf8"));
  const paths = packed.files.map((/** @type {{path: string}} */ file) => file.path);
  assert.deepEqual(
    paths.filter((/** @type {string} */ path) => path.endsWith("/SKILL.md")).sort(),
    manifest.skills.map((/** @type {string} */ path) => `${path.slice(2)}/SKILL.md`).sort(),
  );
  assert.ok(!paths.some((/** @type {string} */ path) => /skills\/(misc|deprecated|in-progress)\//.test(path)));

  const prefix = join(temporary, "installed");
  execFileSync("npm", [
    "install", "--prefix", prefix, "--ignore-scripts", "--omit=dev",
    "--no-audit", "--no-fund", join(temporary, packed.filename),
  ], { stdio: "inherit" });
  const directory = join(prefix, "node_modules/mattpocock-skills");
  const entrypoints = Host.resolve({ directory, name: "mattpocock-skills" });
  assert.equal(entrypoints.server, pathToFileURL(join(directory, "opencode/index.mjs")).href);
  const loaded = /** @type {{default: import('@opencode/plugin').Plugin.Plugin}} */ (
    await Host.load(entrypoints.server)
  );
  assert.equal(loaded.default.id, "mattpocock-skills");

  for (const skill of manifest.skills) {
    const sourceDirectory = join(root, skill);
    for (const path of await readdir(sourceDirectory, { recursive: true, withFileTypes: true })) {
      if (!path.isFile()) continue;
      const file = relative(sourceDirectory, join(path.parentPath, path.name));
      assert.deepEqual(
        await readFile(join(directory, skill, file)),
        await readFile(join(sourceDirectory, file)),
        `${basename(skill)} supporting file: ${file}`,
      );
    }
  }

  execFileSync("bun", [join(root, "tests/opencode.mjs"), directory], {
    cwd: temporary,
    stdio: "inherit",
  });
  console.log("Packed package loads through OpenCode and includes every supporting file.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
