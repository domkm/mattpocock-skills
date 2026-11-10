import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { Skill } from "@opencode/plugin";
import { parse } from "yaml";
import plugin from "../opencode/index.mjs";

/** @typedef {import('@opencode/plugin').Plugin.Context} Context */
/** @typedef {Parameters<Context['skill']['transform']>[0]} Transform */

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, ".claude-plugin/plugin.json"), "utf8"),
);

/** @param {import('@opencode/plugin').Plugin.Plugin} definition */
async function register(definition) {
  /** @type {import('@opencode/plugin').Skill.Info[]} */
  const skills = [];
  /** @type {Transform | undefined} */
  let transform;
  const ctx = {
    skill: {
      transform: async (/** @type {NonNullable<typeof transform>} */ callback) => {
        transform = callback;
      },
    },
  };
  await definition.setup(
    /** @type {import('@opencode/plugin').Plugin.Context} */ (
      /** @type {unknown} */ (ctx)
    ),
  );
  assert.ok(transform);
  const editor = /** @type {Parameters<Transform>[0]} */ (
    /** @type {unknown} */ ({
      add: (/** @type {Skill.Info} */ skill) => skills.push(Skill.Info.make(skill)),
    })
  );
  const callback = transform;
  const replay = () => callback(editor);
  replay();
  return { skills, replay };
}

test("registers exactly the promoted manifest with native SDK values", async () => {
  const { skills, replay } = await register(plugin);
  const expected = manifest.skills.map((/** @type {string} */ path) => basename(path));
  assert.deepEqual(skills.map((skill) => skill.id), expected);
  assert.equal(new Set(expected).size, expected.length);

  for (const skill of skills) {
    const source = await readFile(skill.path, "utf8");
    const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    assert.ok(header);
    const data = parse(header[1]);
    const codex = parse(
      await readFile(join(dirname(skill.path), "agents/openai.yaml"), "utf8"),
    );
    assert.equal(skill.description, data.description);
    assert.equal(skill.content, source.slice(header[0].length).trim());
    assert.equal(skill.autoinvoke, data["disable-model-invocation"] !== true);
    assert.equal(skill.autoinvoke, codex.policy?.allow_implicit_invocation !== false);
    assert.match(skill.path, /\/skills\/(engineering|productivity)\/[^/]+\/SKILL\.md$/);
  }
  replay();
  assert.deepEqual(skills.slice(expected.length), skills.slice(0, expected.length));
});

test("parses YAML and rejects invalid skill registrations", async (t) => {
  const cases = [
    { name: "folded YAML", header: 'name: example\ndescription: >-\n  Use when someone\n  says "test".', expected: true },
    { name: "user-invoked", header: "name: example\ndescription: Test\ndisable-model-invocation: true", expected: false },
    { name: "non-promoted", path: "./skills/misc/example", error: /Not a promoted skill directory/ },
    { name: "path traversal", path: "./skills/engineering/../misc/example", error: /Not a promoted skill directory/ },
    { name: "missing header", source: "# Example", error: /Missing skill frontmatter/ },
    { name: "wrong ID", header: "name: wrong\ndescription: Test", error: /Invalid skill metadata/ },
    { name: "invalid invocation flag", header: 'name: example\ndescription: Test\ndisable-model-invocation: "true"', error: /Invalid skill metadata/ },
  ];

  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const fixture = await mkdtemp(join(tmpdir(), "mattpocock-skill-"));
      t.after(() => rm(fixture, { recursive: true, force: true }));
      await mkdir(join(fixture, "opencode"));
      await mkdir(join(fixture, ".claude-plugin"));
      await mkdir(join(fixture, "skills/engineering/example"), { recursive: true });
      await copyFile(join(root, "opencode/index.mjs"), join(fixture, "opencode/index.mjs"));
      await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
      await writeFile(join(fixture, ".claude-plugin/plugin.json"), JSON.stringify({
        skills: [item.path ?? "./skills/engineering/example"],
      }));
      await writeFile(join(fixture, "skills/engineering/example/SKILL.md"),
        item.source ?? `---\r\n${item.header?.replaceAll("\n", "\r\n")}\r\n---\r\n\r\nBody\r\n`,
      );
      const { default: definition } = await import(pathToFileURL(join(fixture, "opencode/index.mjs")).href);
      if (item.error) {
        await assert.rejects(register(definition), item.error);
      } else {
        const { skills: [skill] } = await register(definition);
        assert.equal(skill.autoinvoke, item.expected);
        assert.equal(skill.content, "Body");
        if (item.name === "folded YAML") {
          assert.equal(skill.description, 'Use when someone says "test".');
        }
      }
    });
  }
});
