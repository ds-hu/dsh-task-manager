/**
 * Published-package checks: what npm would actually ship.
 *
 * Runs `npm pack --dry-run --json` and asserts the files the runtime and the
 * Plugin Manager need are present, and that development-only material is not.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { stdout } = await run('npm', ['pack', '--dry-run', '--json'], { cwd: root });
const [pack] = JSON.parse(stdout);
const files = new Set(pack.files.map((file) => file.path));

const required = [
  'package.json',
  'lib/index.js',
  'lib/api.js',
  'lib/http.js',
  'lib/version.js',
  'lib/client.js',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'NOTICE',
];
for (const file of required) assert.ok(files.has(file), `packed package includes ${file}`);

assert.ok(files.has('lib/metrics.js'), 'packed package includes the metrics collector');
assert.ok(files.has('lib/procfs.js'), 'packed package includes the Linux process fast path');

const forbidden = [...files].filter(
  (file) => file.startsWith('src/')
    || file.startsWith('test/')
    || file.startsWith('scripts/')
    || file.startsWith('docs/')
    || file.startsWith('node_modules/')
    || file.endsWith('.tgz'),
);
assert.deepEqual(forbidden, [], 'development-only files are not published');

const client = pack.files.find((file) => file.path === 'lib/client.js');
assert.ok(client.size > 1000, 'client bundle is non-trivial');
const icon = pack.files.find((file) => file.path === 'icon.svg');
assert.ok(icon.size < 256 * 1024, 'icon stays under the 256 KiB limit');

process.stdout.write(`package: ok (${pack.files.length} files, ${pack.size} bytes packed, ${pack.unpackedSize} unpacked)\n`);
