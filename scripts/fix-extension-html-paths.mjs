/**
 * Ensure built side-panel HTML uses relative asset URLs.
 * Absolute `/assets/...` fails to load modules in chrome-extension:// side panels.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const dist = join(process.cwd(), "extension", "dist");
const assetsDir = join(dist, "assets");
const iconsDir = join(dist, "icons");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else if (e.name.endsWith(".html")) files.push(p);
  }
  return files;
}

function toPosix(p) {
  return p.split("\\").join("/");
}

const htmlFiles = await walk(dist);
let fixed = 0;

for (const file of htmlFiles) {
  const before = await readFile(file, "utf8");
  const htmlDir = dirname(file);
  const assetsRel = toPosix(relative(htmlDir, assetsDir)) + "/";
  const iconsRel = toPosix(relative(htmlDir, iconsDir)) + "/";

  const after = before
    .replace(/(src|href)=(["'])\/assets\//g, `$1=$2${assetsRel}`)
    .replace(/(src|href)=(["'])\.\/assets\//g, `$1=$2${assetsRel}`)
    .replace(/(src|href)=(["'])\/icons\//g, `$1=$2${iconsRel}`);

  if (after !== before) {
    await writeFile(file, after, "utf8");
    fixed++;
    console.log(`fixed paths: ${toPosix(relative(process.cwd(), file))} → ${assetsRel}`);
  }
}

console.log(`fix-extension-html-paths: ${fixed} file(s) updated`);
