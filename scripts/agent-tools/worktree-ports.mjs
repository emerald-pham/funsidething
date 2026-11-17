// The prepared-ports contract for agent worktrees (#2364): worktree-ready
// writes it, and the test-run recorder and the test suite read it. This module
// alone knows the file's name, place and format, the variable names, and the
// ledger resource string for a port.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PORT_VARIABLES = ['CHAIN_NATIVE_PORT', 'CHAIN_NATIVE_SMOKE_PORT'];
const PORTS_FILE = 'chain-worktree-ports.env';
const LOOPBACK = /^loopback:127\.0\.0\.1:(\d+)$/;

// Kept in the worktree's own Git directory, so it never shows in the checkout
// and leaves with the worktree.
export function portsFilePath(gitDirectory) {
  return join(gitDirectory, PORTS_FILE);
}

export function loopbackResource(port) {
  return `loopback:127.0.0.1:${port}`;
}

export function loopbackPort(resource) {
  const port = LOOPBACK.exec(String(resource).trim().toLowerCase())?.[1];
  return port ? Number(port) : undefined;
}

export function writePreparedPorts(gitDirectory, ports) {
  writeFileSync(portsFilePath(gitDirectory), PORT_VARIABLES.map((name, index) => `export ${name}=${ports[index]}\n`).join(''));
}

export function removePreparedPorts(gitDirectory) {
  rmSync(portsFilePath(gitDirectory), { force: true });
}

// The file's text, in shell `export` form; empty when nothing was prepared.
export function preparedPortsText(gitDirectory) {
  try {
    return readFileSync(portsFilePath(gitDirectory), 'utf8');
  } catch {
    return '';
  }
}

// Subagent shells keep no environment between commands, so whatever runs the
// tests fills each unset port variable from the prepared file of the worktree
// at `cwd`. A variable the shell set wins. CI uses ephemeral ports and never
// reads the file.
export function applyPreparedPorts(environment, cwd) {
  if (environment.CI === 'true') return;
  let gitDirectory;
  try {
    gitDirectory = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return;
  }
  const prepared = preparedPortsText(gitDirectory);
  for (const name of PORT_VARIABLES) {
    const port = new RegExp(`^export ${name}=(\\d+)$`, 'm').exec(prepared)?.[1];
    if (port && !environment[name]?.trim()) environment[name] = port;
  }
}
