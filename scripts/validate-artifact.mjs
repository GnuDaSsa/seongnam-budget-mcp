import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
assert.equal(JSON.parse(manifest).d1, "DB", "the Worker needs its traffic database binding");
const migrationRoot = resolve(projectRoot, "drizzle");
const packagedRoot = resolve(projectRoot, "dist/.openai/drizzle");
const history = JSON.parse(await readFile(resolve(migrationRoot, "meta/_journal.json"), "utf8"));
assert(history.entries.some(entry => entry.tag === "0000_mcp_usage_daily"));
const migrationFiles = ["meta/_journal.json"];
for (const {tag} of history.entries) {
  assert.match(tag, /^\d{4}_[a-z0-9_]+$/);
  migrationFiles.push(`${tag}.sql`, `meta/${tag.slice(0, 4)}_snapshot.json`);
}
for (const name of migrationFiles) {
  const [original, packaged] = await Promise.all([
    readFile(resolve(migrationRoot, name)), readFile(resolve(packagedRoot, name)),
  ]);
  assert.deepEqual(packaged, original, `packaged migration differs from source: ${name}`);
}

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

console.log("Artifact is valid ESM and exports default.fetch");
