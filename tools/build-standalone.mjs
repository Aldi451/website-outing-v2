#!/usr/bin/env node
/**
 * Builds `outing-hub-standalone.html`: the whole app (CSS, config, sync layer,
 * app logic) inlined into a single file. That file has no local dependency at
 * all, so no hosting MIME type or caching problem can strip the styling - handy
 * as a fallback when a free host keeps mangling styles.css / app.js.
 *
 * Usage:
 *   node tools/build-standalone.mjs          # write outing-hub-standalone.html
 *   node tools/build-standalone.mjs --check  # fail if the file is out of date
 *
 * index.html, styles.css and the .js files stay the single source of truth;
 * the standalone HTML is generated output.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputName = 'outing-hub-standalone.html';
const checkOnly = process.argv.includes('--check');
const LOCAL_SCRIPTS = ['config.js', 'supabase-sync.js', 'app.js'];

const read = (name) => readFile(join(root, name), 'utf8');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Inlined CSS/JS must not contain a closing tag for its own element. */
function assertSafe(name, code, closingTag) {
  if (code.toLowerCase().includes(closingTag)) {
    throw new Error(`${name} contains "${closingTag}" and cannot be inlined safely.`);
  }
}

const banner = (name) => `/* ===== ${name} (inlined by tools/build-standalone.mjs) ===== */`;

const [html, css, ...scripts] = await Promise.all([
  read('index.html'),
  read('styles.css'),
  ...LOCAL_SCRIPTS.map(read)
]);

const scriptSources = Object.fromEntries(LOCAL_SCRIPTS.map((name, index) => [name, scripts[index].trim()]));

assertSafe('styles.css', css, '</style');
for (const name of LOCAL_SCRIPTS) assertSafe(name, scriptSources[name], '</script');

const styleBlock = `<style id="app-styles" data-source="styles.css (inlined)">\n${banner('styles.css')}\n${css.trim()}\n</style>`;
const scriptBlock = (name) =>
  `<script data-source="${name} (inlined)">\n${banner(name)}\ntry {\n${scriptSources[name]}\n} catch (error) {\n  console.error('${name} failed to load', error);\n}\n</script>`;

let built = html;

// Replace with a replacer *function* everywhere so `$&`-style sequences inside
// the inlined sources are never treated as replacement patterns.
const stylePattern = /[ \t]*<link id="app-styles"[^>]*>[ \t]*\n?/;
if (!stylePattern.test(built)) throw new Error('index.html: <link id="app-styles"> not found.');
built = built.replace(stylePattern, () => `${styleBlock}\n`);

for (const name of LOCAL_SCRIPTS) {
  const pattern = new RegExp(`[ \\t]*<script src="${escapeRegExp(name)}(?:\\?[^"]*)?"></script>[ \\t]*\\n?`);
  if (!pattern.test(built)) throw new Error(`index.html: <script src="${name}"> not found.`);
  built = built.replace(pattern, () => `${scriptBlock(name)}\n`);
}

built = built.replace(
  '<!doctype html>',
  '<!doctype html>\n<!-- Generated file - do not edit. Rebuild with: node tools/build-standalone.mjs -->'
);

if (checkOnly) {
  let current = '';
  try {
    current = await read(outputName);
  } catch {
    current = '';
  }
  if (current !== built) {
    console.error(`${outputName} is out of date. Run: node tools/build-standalone.mjs`);
    process.exit(1);
  }
  console.log(`${outputName} is up to date.`);
} else {
  await writeFile(join(root, outputName), built, 'utf8');
  console.log(`Wrote ${outputName} (${(Buffer.byteLength(built, 'utf8') / 1024).toFixed(1)} KB).`);
}
