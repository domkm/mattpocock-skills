import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Plugin, Skill } from "@opencode/plugin";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);

/** @param {string} directory */
async function readSkill(directory) {
  if (!/^\.\/skills\/(engineering|productivity)\/[a-z0-9-]+$/.test(directory)) {
    throw new Error(`Not a promoted skill directory: ${directory}`);
  }

  const path = fileURLToPath(new URL(`${directory}/SKILL.md`, root));
  const source = await readFile(path, "utf8");
  const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!header) throw new Error(`Missing skill frontmatter: ${path}`);

  const data = parse(header[1]);
  const disabled = data?.["disable-model-invocation"];
  if (
    data?.name !== basename(directory) ||
    typeof data?.description !== "string" ||
    (disabled !== undefined && typeof disabled !== "boolean")
  ) {
    throw new Error(`Invalid skill metadata: ${path}`);
  }

  return {
    id: Skill.ID.make(data.name),
    name: Skill.Name.make(data.name),
    description: data.description,
    autoinvoke: disabled !== true,
    path: Skill.Info.fields.path.make(path),
    content: source.slice(header[0].length).trim(),
  };
}

export default Plugin.define({
  id: "mattpocock-skills",
  async setup(ctx) {
    const manifest = JSON.parse(
      await readFile(new URL(".claude-plugin/plugin.json", root), "utf8"),
    );
    const skills = await Promise.all(manifest.skills.map(readSkill));
    await ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill);
    });
  },
});
