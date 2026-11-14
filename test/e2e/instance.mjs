/**
 * Start/stop the isolated DSH instance used by the Playwright suite.
 *
 * `scripts/e2e-instance.sh` owns the profile bootstrap and the tokenized URL,
 * but its `stop` only signals the background subshell it recorded in
 * `web.pid`, so the `dsh` process itself can survive (observed on this host).
 * This module therefore adds a targeted fallback: it finds the `dsh` process
 * whose command line carries `--port <PORT>`, stops it, and waits for the port
 * to be released. That keeps repeated runs from colliding on :3092 and keeps
 * the machine from accumulating 768 MB web servers.
 *
 * Safety: every kill is scoped to `--port <DSH_E2E_PORT>` (default 3092); the
 * production instance on :3080 and the other owners' instances on :3090/:3091
 * are never touched.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describeRuntime, HOME, PID_FILE, PORT, ROOT, STATE_FILE, URL_FILE } from './runtime.mjs';

/** Instance manager script. */
const SCRIPT = path.join(ROOT, 'scripts/e2e-instance.sh');

/**
 * Environment for the instance script; keeps the isolated profile.
 * @returns {NodeJS.ProcessEnv} environment.
 */
function scriptEnv() {
  return { ...process.env, DSH_E2E_HOME: HOME, DSH_E2E_PORT: String(PORT) };
}

/**
 * Run one instance-manager subcommand and wait for the script to exit.
 *
 * `stdio: 'ignore'` is essential: the script leaves a detached background
 * subshell holding inherited descriptors, so a piped stdout would never reach
 * EOF and the caller would hang.
 *
 * @param {string[]} args - Subcommand arguments.
 * @param {number} [timeoutMs] - Safety timeout.
 * @returns {Promise<void>} resolves when the script exits cleanly.
 */
function runScript(args, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT, ...args], {
      cwd: ROOT,
      env: scriptEnv(),
      stdio: 'ignore',
      detached: true,
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      reject(new Error(`scripts/e2e-instance.sh ${args.join(' ')} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`scripts/e2e-instance.sh ${args.join(' ')} exited code=${code} signal=${signal}`));
    });
  });
}

/**
 * PIDs of `dsh` web servers bound to the isolated port.
 * @returns {number[]} matching process ids.
 */
export function instancePids() {
  const found = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/u.test(entry)) continue;
    let cmdline;
    try {
      cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8').replace(/\0/gu, ' ').trim();
    } catch {
      continue;
    }
    if (!/(?:^|\s)(?:\S*\/)?dsh\s+--profile\s+web\b/u.test(cmdline)) continue;
    if (!cmdline.includes(`--port ${PORT}`)) continue;
    found.push(Number(entry));
  }
  return found;
}

/**
 * Wait for the web server behind a URL to answer.
 * @param {string} url - Tokenized URL.
 * @param {number} timeoutMs - How long to wait.
 * @returns {Promise<boolean>} whether it answered 2xx/3xx.
 */
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // `redirect: 'manual'` matters: the tokenized URL answers 303 with a
      // Set-Cookie, and Node's fetch has no cookie jar, so following it would
      // land on a 401. A 3xx already proves the web server is listening.
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
      if (response.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Read the URL the script printed, waiting for it to appear.
 * @param {number} timeoutMs - How long to wait.
 * @returns {Promise<string>} tokenized URL.
 */
async function waitForUrlFile(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const url = (await readFile(URL_FILE, 'utf8')).trim();
      if (url !== '') return url;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${URL_FILE}`);
}

/**
 * Stop the isolated instance and wait until the port is released.
 * @returns {Promise<void>} resolves once no matching process remains.
 */
export async function ensureStopped() {
  await runScript(['stop']).catch(() => {});

  const signalAll = (signal) => {
    for (const pid of instancePids()) {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
  };

  signalAll('SIGTERM');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && instancePids().length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  signalAll('SIGKILL');

  const killDeadline = Date.now() + 5000;
  while (Date.now() < killDeadline && instancePids().length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await rm(PID_FILE, { force: true });
  await rm(URL_FILE, { force: true });
}

/**
 * Ensure a fresh isolated instance is running and return its descriptor.
 *
 * `TM_URL` short-circuits everything: the caller owns the instance.
 *
 * @returns {Promise<ReturnType<typeof describeRuntime>>} runtime descriptor.
 */
export async function ensureStarted() {
  const external = process.env.TM_URL?.trim();
  if (external) {
    const runtime = describeRuntime(external, { external: true, started: false });
    await mkdir(HOME, { recursive: true });
    await writeFile(STATE_FILE, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
    return runtime;
  }

  // A previous run may have left the server alive (script `stop` limitation);
  // restart from a clean port so Host code changes are always picked up.
  await ensureStopped();
  await mkdir(HOME, { recursive: true });
  await runScript(['start', String(PORT)]);

  const url = await waitForUrlFile(180_000);
  if (!(await waitForHttp(url, 60_000))) {
    throw new Error(`instance at ${url} did not answer HTTP; see ${path.join(HOME, 'web.log')}`);
  }

  const runtime = describeRuntime(url, { external: false, started: true, port: PORT, home: HOME });
  await writeFile(STATE_FILE, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
  return runtime;
}

/**
 * Stop the instance only when this run started it.
 * @returns {Promise<void>} resolves after teardown.
 */
export async function stopStarted() {
  let state = null;
  try {
    state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return;
  }
  if (state?.external || !state?.started) {
    await rm(STATE_FILE, { force: true });
    return;
  }
  await ensureStopped();
  await rm(STATE_FILE, { force: true });
}
