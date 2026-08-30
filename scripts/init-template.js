// Run once, right after copying this template for a new plugin:
//
//   node scripts/init-template.js
//
// Edit project.config.json first, then run this — it stamps every static
// file that GitHub/npm/Decky render on their own (package.json, plugin.json,
// README.md) with those same values, so they can't drift out of sync.
//
// It does NOT touch src/utils/githubReleases.ts or py_modules/*/plugin_updater.py
// — those import project.config.json directly at runtime, so editing that
// one file later (e.g. after a repo rename) is always enough on its own.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const config = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf-8"));
const { githubOwner, githubRepo, pluginName, displayName, description, author } = config;

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const writeJson = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");

// package.json
const pkgPath = path.join(root, "package.json");
const pkg = readJson(pkgPath);
pkg.name = pluginName;
pkg.display_name = displayName;
pkg.description = description;
pkg.author = author;
pkg.repository.url = `git+https://github.com/${githubOwner}/${githubRepo}.git`;
pkg.bugs.url = `https://github.com/${githubOwner}/${githubRepo}/issues`;
pkg.homepage = `https://github.com/${githubOwner}/${githubRepo}#readme`;
writeJson(pkgPath, pkg);
console.log("[init] package.json updated");

// plugin.json
const pluginJsonPath = path.join(root, "plugin.json");
const pluginJson = readJson(pluginJsonPath);
pluginJson.name = displayName;
pluginJson.author = author;
pluginJson.publish.description = description;
pluginJson.publish.image = `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}/main/assets/logo.png`;
writeJson(pluginJsonPath, pluginJson);
console.log("[init] plugin.json updated");

// README.md — replace the placeholder title/description on the first two
// lines only; everything else is left for you to fill in by hand.
const readmePath = path.join(root, "README.md");
if (fs.existsSync(readmePath)) {
  let readme = fs.readFileSync(readmePath, "utf-8");
  readme = readme.replace(/^# .*$/m, `# ${pluginName}`);
  readme = readme.replace(
    /\*\*.*\*\*\n\nOne line describing what your plugin does\./,
    `**${displayName}**\n\n${description}`,
  );
  fs.writeFileSync(readmePath, readme, "utf-8");
  console.log("[init] README.md updated");
}

console.log(`[init] done — ${pluginName} now points at github.com/${githubOwner}/${githubRepo}`);
