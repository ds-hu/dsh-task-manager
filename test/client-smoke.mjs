/**
 * Browser-half smoke test without a browser.
 *
 * Loads the generated `lib/client.js` in a VM with a fake
 * `window.__ModuleLoader__`, materializes the factory, calls `apply()` against a
 * fake Cordis context, and asserts the two slot registrations. This catches the
 * mistakes that would otherwise only show up as a blank sidebar entry.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const code = await readFile(join(root, 'lib/client.js'), 'utf8');

let registration;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(record) {
        registration = record;
      },
    },
  },
  console,
  setTimeout,
  clearTimeout,
  fetch: async () => {
    throw new Error('network is not available in the smoke test');
  },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'lib/client.js' });

assert.ok(registration, 'bundle registers a module');
assert.equal(registration.id, '@ds-hu/dsh-task-manager', 'module id is the package name');

const react = {
  createElement: () => null,
  useEffect: () => {},
  useState: () => [null, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  Fragment: 'fragment',
};
const jsxRuntime = {
  jsx: () => null,
  jsxs: () => null,
  Fragment: 'fragment',
};
const require = (specifier) => {
  if (specifier === 'react') return react;
  if (specifier === 'react/jsx-runtime') return jsxRuntime;
  if (specifier === 'react-dom' || specifier === 'react-dom/client') return {};
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
};

const exports = registration.factory(require);
assert.equal(typeof exports.apply, 'function', 'factory returns apply()');
assert.deepEqual([...exports.inject], ['slots', 'locale', 'theme'], 'factory declares its services');

const registrations = [];
const effects = [];
const localeRegistrations = [];
const listeners = [];
const ctx = {
  effect(fn, label) {
    effects.push(label);
    const dispose = fn();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  on(event, listener) {
    listeners.push(event);
    return () => {};
  },
  locale: {
    register(namespace, dictionaries) {
      localeRegistrations.push({ namespace, dictionaries });
      return () => {};
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {};
    },
    getLocale() {
      return { active: 'zh', locales: [], revision: 0 };
    },
  },
  theme: {
    getTheme() {
      return { active: { colorScheme: 'light' }, preference: 'system', themes: [], revision: 0 };
    },
  },
  slots: {
    inject(key, callback) {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};

exports.apply(ctx);

assert.ok(effects.some((label) => String(label).includes('dictionaries')), 'dictionaries are owned by an effect');
assert.ok(localeRegistrations.some((entry) => entry.namespace === 'dsh.task-manager'), 'locale namespace registered');

const main = registrations.find((entry) => entry.options.name === 'main');
assert.ok(main, 'main panel registered');
assert.equal(main.options.key, 'task-manager', 'main panel key matches the sidebar id');
assert.equal(typeof main.component, 'function', 'main panel has a component');

const panel = registrations.find((entry) => entry.options.name === 'sidebar.panellist');
assert.ok(panel, 'sidebar entry registered');
assert.equal(panel.options.id, 'task-manager', 'sidebar id matches the main panel key');
assert.equal(typeof panel.options.label, 'function', 'sidebar label is a live thunk');
assert.equal(panel.options.label(), '任务管理器', 'sidebar label resolves in the active locale');
assert.equal(typeof panel.component, 'function', 'sidebar entry has an icon component');

process.stdout.write('client-smoke: ok\n');
