import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const directory = process.argv[2];
assert.ok(directory, "Pass the installed package directory");
const sandbox = await mkdtemp(join(tmpdir(), "mattpocock-opencode-"));
process.env.HOME = sandbox;
for (const key of ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
  process.env[key] = join(sandbox, key);
}

const { OpenCode } = await import("@opencode/sdk");
const { Plugin } = await import("@opencode/plugin");
let context;
const workspace = join(sandbox, "workspace");
await mkdir(workspace);
const host = await OpenCode.create({
  database: { path: join(sandbox, "test.db") },
  config: {
    directory: join(sandbox, "config"),
    project: false,
    claude: false,
    content: JSON.stringify({ plugins: [directory] }),
  },
  models: { fetch: false },
  fs: { filewatcher: false },
  plugins: [Plugin.define({
    id: "test-observer",
    setup(ctx) { context = ctx; },
  })],
});

try {
  const manifest = JSON.parse(await readFile(join(directory, ".claude-plugin/plugin.json"), "utf8"));
  const session = await host.sessions.create({ location: { directory: workspace } });
  await host.experimental.session.skill({ sessionID: session.id, id: "grill-with-docs", resume: false });
  const skills = (await host.skill.list({ location: { directory: workspace } })).data.filter(
    (skill) => skill.path.startsWith(`${directory}/skills/`),
  );
  assert.deepEqual(
    skills.map((skill) => skill.id).sort(),
    manifest.skills.map((path) => basename(path)).sort(),
  );
  assert.equal(skills.filter((skill) => skill.autoinvoke).length, 11);
  assert.ok(context);
  const skillTool = (await context.tool.list()).find((tool) => tool.id === "skill");
  assert.ok(skillTool, "OpenCode's native skill tool is registered");
  assert.ok(skills.find((skill) => skill.id === "grill-with-docs")?.content.includes(
    'Call the Skill tool twice, for "grilling" and "domain-modeling"',
  ));

  const messages = JSON.stringify(await host.sessions.context({ sessionID: session.id }));
  assert.match(messages, /grill-with-docs/);

  async function load(id, sessionID = session.id) {
    return skillTool.execute({ id }, {
      sessionID,
      agent: "build",
      messageID: "msg_skill_test",
      id: "call_skill_test",
      signal: new AbortController().signal,
      progress: async () => {},
    });
  }

  for (const id of ["grilling", "domain-modeling", "grill-me"]) {
    const output = await load(id);
    const result = typeof output.content === "string" ? output.content : output.content?.map(
      (part) => part.type === "text" ? part.text : "",
    ).join("\n") ?? "";
    assert.ok(result.includes(`<skill_content name="${id}">`));
    assert.ok(result.includes(dirname(skills.find((skill) => skill.id === id)?.path ?? "")));
  }

  const child = await host.sessions.create({ parentID: session.id, location: { directory: workspace } });
  const tdd = JSON.stringify(await load("tdd", child.id));
  assert.match(tdd, /tests\.md/);
  assert.match(tdd, /mocking\.md/);
  assert.ok(tdd.includes(join(directory, "skills/engineering/tdd")));
  assert.match(JSON.stringify(await load("codebase-design", child.id)), /skill_content/);
  console.log("OpenCode V2 skill-loading checks pass.");
} finally {
  await host.close();
  await rm(sandbox, { recursive: true, force: true });
}
