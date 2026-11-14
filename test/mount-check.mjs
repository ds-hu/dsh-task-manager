/**
 * Mount parity checks: the two rules that keep the bundle honest.
 *
 *  1. `cordis.patch.yml` must insert exactly one row whose `name` is this
 *     package's name (so the Loader resolves the code from the profile).
 *  2. That row's `id` must equal the `name` the Host half exports (so the row
 *     and the plugin are recognizably the same thing).
 *
 * It also checks the published surface: exports, locale metadata, icon bytes,
 * and the generated client bundle.
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(root, path), 'utf8');
const pkg = JSON.parse(await read('package.json'));

assert.equal(pkg.name, '@ds-hu/dsh-task-manager', 'package name is the published name');
assert.equal(pkg.private, undefined, 'package is publishable');
assert.equal(pkg.publishConfig?.access, 'public', 'package publishes publicly');
assert.equal(pkg.type, 'module', 'package is ESM');
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'bundle patch is declared');
assert.equal(pkg.dsh?.client?.platform, 'web', 'client half is web');
assert.ok(pkg.dsh?.client?.immediately, 'client half loads at boot so the sidebar entry exists');
assert.ok(pkg.dependencies?.systeminformation, 'monitoring library is a runtime dependency');

// 1. The patch inserts one row named after the package.
const patch = await read('cordis.patch.yml');
const rows = [...patch.matchAll(/^\s*-\s+id:\s*(\S+)\s*$/gmu)].map((match) => match[1]);
assert.deepEqual(rows, ['task-manager'], 'patch inserts exactly the task-manager row');
assert.match(patch, /name:\s*'@ds-hu\/dsh-task-manager'/u, 'row resolves this package');

// 2. The row id equals the Host `name` export.
const host = await read('lib/index.js');
const nameExport = host.match(/export const name = '([^']+)'/u)?.[1];
assert.equal(nameExport, rows[0], 'row id equals the exported plugin name');
assert.match(host, /export function apply\(/u, 'Host half exports apply');
assert.match(host, /export const inject = \[[^\]]*'webServer'/u, 'Host half injects webServer');

// Published surface.
for (const subpath of ['.', './client', './icon', './locale/*.json', './package.json']) {
  assert.ok(pkg.exports?.[subpath], `exports declares ${subpath}`);
}
for (const file of ['lib/index.js', 'lib/api.js', 'lib/http.js', 'cordis.patch.yml', 'icon.svg', 'LICENSE', 'NOTICE']) {
  const info = await stat(join(root, file));
  assert.ok(info.isFile() && info.size > 0, `${file} exists and is non-empty`);
}
assert.ok((await stat(join(root, 'lib/client.js'))).size > 1000, 'client bundle is generated');

// Locale metadata.
for (const [file, title] of [['locale/en.json', 'Task Manager'], ['locale/zh.json', '任务管理器']]) {
  const locale = JSON.parse(await read(file));
  assert.equal(locale.meta?.title, title, `${file} has the display title`);
  assert.ok(locale.meta?.description?.length > 20, `${file} has a real description`);
}

// Icon: valid SVG under the size cap.
const icon = await read('icon.svg');
assert.match(icon, /^<svg[\s>]/u, 'icon is an SVG document');
assert.ok(Buffer.byteLength(icon) < 256 * 1024, 'icon stays under 256 KiB');
assert.ok(!/(?:href|src)\s*=\s*["']https?:/u.test(icon), 'icon has no remote references');
assert.ok(!/<image[\s>]/u.test(icon), 'icon embeds no raster/remote image');

// Client bundle registers exactly one module under this package id.
const client = await read('lib/client.js');
assert.match(client, /window\.__ModuleLoader__\.load\(/u, 'client calls the module loader');
assert.ok(client.includes(`id: ${JSON.stringify(pkg.name)}`), 'client registers this package id');
assert.ok(!client.includes("require('@deepseek-ai/dsh-client-ui-"), 'client does not import host client packages');

process.stdout.write('mount-check: ok\n');
