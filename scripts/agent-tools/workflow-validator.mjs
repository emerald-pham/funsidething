#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACTIONLINT_VERSION = '1.7.12';
export const SETUP_COMMAND = 'npm run agent:setup-workflow-validator';
const MAX_DIAGNOSTIC_CHARS = 12_000;
const CACHE_RELATIVE_PATH = ['node_modules', '.cache', 'funsidething', 'actionlint', `v${ACTIONLINT_VERSION}`];

const ASSET_SHA256 = Object.freeze({
  'darwin-x64': '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  'darwin-arm64': 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  'linux-x64': '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  'linux-arm64': '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function platformKey(platform = process.platform, arch = process.arch) {
  if (!['darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`No pinned actionlint v${ACTIONLINT_VERSION} archive is defined for ${platform}-${arch}. Supported platforms are darwin/linux on x64/arm64.`);
  }
  return `${platform}-${arch}`;
}

export function pinnedActionlintAsset(platform = process.platform, arch = process.arch) {
  const key = platformKey(platform, arch);
  const [os, architecture] = key.split('-');
  const releaseArchitecture = architecture === 'x64' ? 'amd64' : 'arm64';
  const filename = `actionlint_${ACTIONLINT_VERSION}_${os}_${releaseArchitecture}.tar.gz`;
  return Object.freeze({
    key,
    filename,
    url: `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${filename}`,
    sha256: ASSET_SHA256[key],
  });
}

function cachePaths(repositoryRoot, platform = process.platform, arch = process.arch) {
  const directory = join(resolve(repositoryRoot), ...CACHE_RELATIVE_PATH, platformKey(platform, arch));
  return {
    directory,
    executable: join(directory, process.platform === 'win32' ? 'actionlint.exe' : 'actionlint'),
    manifest: join(directory, 'manifest.json'),
  };
}

function actionableSetupError(detail) {
  return new Error(`${detail} Run: ${SETUP_COMMAND}`);
}

async function readPinnedInstallation(repositoryRoot) {
  const paths = cachePaths(repositoryRoot);
  let manifest;
  let executableBytes;
  try {
    const [manifestText, binaryStat, binary] = await Promise.all([
      readFile(paths.manifest, 'utf8'),
      lstat(paths.executable),
      readFile(paths.executable),
    ]);
    manifest = JSON.parse(manifestText);
    executableBytes = binary;
    if (!binaryStat.isFile() || binaryStat.isSymbolicLink()) throw new Error('cached executable is not a regular file');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw actionableSetupError(`Pinned actionlint v${ACTIONLINT_VERSION} is not set up in this repository.`);
    }
    throw actionableSetupError(`Pinned actionlint v${ACTIONLINT_VERSION} setup is missing or invalid: ${error.message}.`);
  }

  const asset = pinnedActionlintAsset();
  if (manifest?.schemaVersion !== 1
    || manifest.version !== ACTIONLINT_VERSION
    || manifest.platform !== process.platform
    || manifest.arch !== process.arch
    || manifest.archive !== asset.filename
    || manifest.archiveSha256 !== asset.sha256
    || manifest.executableSha256 !== sha256(executableBytes)) {
    throw actionableSetupError(`Pinned actionlint v${ACTIONLINT_VERSION} setup is missing or invalid: cached identity or checksum does not match the repository pin.`);
  }

  const version = spawnSync(paths.executable, ['-version'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (version.error || version.signal || version.status !== 0 || !new RegExp(`\\b${ACTIONLINT_VERSION.replaceAll('.', '\\.')}(?:\\b|$)`).test(`${version.stdout ?? ''}\n${version.stderr ?? ''}`)) {
    throw actionableSetupError(`Pinned actionlint v${ACTIONLINT_VERSION} setup is missing or invalid: executable version check failed.`);
  }

  return {
    executable: paths.executable,
    version: ACTIONLINT_VERSION,
    executableSha256: manifest.executableSha256,
    archiveSha256: manifest.archiveSha256,
    platform: process.platform,
    arch: process.arch,
  };
}

function extractActionlint(archiveBytes, tarPath = 'tar') {
  const directory = resolve(tmpdir(), `funsidething-actionlint-${randomUUID()}`);
  const archivePath = join(directory, 'release.tar.gz');
  return (async () => {
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(archivePath, archiveBytes, { flag: 'wx' });
      const result = spawnSync(tarPath, ['-xOzf', archivePath, 'actionlint'], {
        encoding: 'buffer',
        maxBuffer: 32 * 1024 * 1024,
      });
      if (result.error || result.signal || result.status !== 0 || !result.stdout?.length) {
        throw new Error(`Could not extract the pinned actionlint executable: ${result.error?.message || result.stderr?.toString().trim() || result.signal || `tar exited ${result.status}`}`);
      }
      return result.stdout;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  })();
}

export async function setupPinnedActionlint(repositoryRoot = process.cwd(), { fetchImpl = globalThis.fetch, tarPath } = {}) {
  const root = resolve(repositoryRoot);
  const asset = pinnedActionlintAsset();
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch; use a supported Node.js 22 or newer release.');
  const response = await fetchImpl(asset.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not download pinned actionlint ${asset.filename}: HTTP ${response.status}.`);
  const archiveBytes = Buffer.from(await response.arrayBuffer());
  const actualArchiveSha256 = sha256(archiveBytes);
  if (actualArchiveSha256 !== asset.sha256) {
    throw new Error(`Pinned actionlint archive checksum mismatch for ${asset.filename}: expected ${asset.sha256}, received ${actualArchiveSha256}.`);
  }

  const executableBytes = await extractActionlint(archiveBytes, tarPath);
  const executableSha256 = sha256(executableBytes);
  const paths = cachePaths(root);
  const staging = `${paths.directory}.install-${randomUUID()}`;
  await mkdir(dirname(paths.directory), { recursive: true });
  await mkdir(staging, { recursive: false });
  try {
    const executableName = process.platform === 'win32' ? 'actionlint.exe' : 'actionlint';
    const stagedExecutable = join(staging, executableName);
    await writeFile(stagedExecutable, executableBytes, { mode: 0o755, flag: 'wx' });
    await chmod(stagedExecutable, 0o755);
    const version = spawnSync(stagedExecutable, ['-version'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (version.error || version.signal || version.status !== 0 || !new RegExp(`\\b${ACTIONLINT_VERSION.replaceAll('.', '\\.')}(?:\\b|$)`).test(`${version.stdout ?? ''}\n${version.stderr ?? ''}`)) {
      throw new Error(`Downloaded executable did not identify as actionlint v${ACTIONLINT_VERSION}.`);
    }
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      version: ACTIONLINT_VERSION,
      platform: process.platform,
      arch: process.arch,
      archive: asset.filename,
      archiveUrl: asset.url,
      archiveSha256: asset.sha256,
      executableSha256,
    }, null, 2)}\n`, { flag: 'wx' });

    await rm(paths.directory, { recursive: true, force: true });
    await rename(staging, paths.directory);
    const installation = await readPinnedInstallation(root);
    return { ...installation, archive: asset.filename, archiveUrl: asset.url };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function collectWorkflowFiles(workflowDirectory) {
  let entries;
  try {
    entries = await readdir(workflowDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not read workflow source directory ${workflowDirectory}: ${error.message}`);
  }
  const files = [];
  for (const entry of entries) {
    if (!/\.ya?ml$/i.test(entry.name)) continue;
    if (!entry.isFile()) throw new Error(`Workflow source contains a non-regular workflow entry: ${entry.name}.`);
    files.push(join(workflowDirectory, entry.name));
  }
  return files.sort((left, right) => basename(left).localeCompare(basename(right)));
}

function truncate(value) {
  if (value.length <= MAX_DIAGNOSTIC_CHARS) return value;
  return `${value.slice(0, MAX_DIAGNOSTIC_CHARS)}\n[validator output truncated]`;
}

export async function validateWorkflows({
  repositoryRoot = process.cwd(),
  sourceDir = join(repositoryRoot, '.github', 'workflows'),
  sourceLabel = 'working tree',
  evidenceFile,
  allowEmpty = false,
} = {}) {
  const root = resolve(repositoryRoot);
  const workflowDirectory = resolve(sourceDir);
  let installation;
  try {
    installation = await readPinnedInstallation(root);
  } catch (error) {
    return { ok: false, exitCode: 2, error: error.message, sourceLabel };
  }

  let files;
  try {
    files = await collectWorkflowFiles(workflowDirectory);
    if (files.length === 0 && !allowEmpty) throw new Error(`No .yml or .yaml workflow files were found in ${workflowDirectory}.`);
  } catch (error) {
    return { ok: false, exitCode: 2, error: error.message, sourceLabel, validator: installation };
  }

  const fileDigests = [];
  for (const file of files) {
    try {
      const content = await readFile(file);
      const relativePath = relative(workflowDirectory, file).split(sep).join('/');
      fileDigests.push({ path: relativePath, sha256: sha256(content) });
    } catch (error) {
      return { ok: false, exitCode: 2, error: `Could not read workflow ${file}: ${error.message}`, sourceLabel, validator: installation };
    }
  }
  const qualifiedSha256 = sha256(Buffer.from(fileDigests.map(({ path, sha256: digest }) => `${path}\0${digest}\n`).join('')));
  const result = spawnSync(installation.executable, [
    '-no-color',
    '-shellcheck=',
    '-pyflakes=',
    '-oneline',
    ...files,
  ], {
    cwd: workflowDirectory,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const diagnostics = truncate(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim());
  const report = {
    schemaVersion: 1,
    validator: {
      name: 'actionlint',
      version: installation.version,
      executableSha256: installation.executableSha256,
      archiveSha256: installation.archiveSha256,
      platform: installation.platform,
      arch: installation.arch,
    },
    source: {
      label: sourceLabel,
      directory: workflowDirectory,
      workflowSetSha256: qualifiedSha256,
      files: fileDigests,
    },
    ok: !result.error && !result.signal && result.status === 0,
    exitCode: result.error || result.signal ? 2 : (result.status ?? 1),
    diagnostics,
  };

  if (evidenceFile) {
    const path = resolve(evidenceFile);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    report.evidenceFile = path;
  }
  return report;
}

function usage() {
  process.stdout.write(`Usage:\n  node scripts/agent-tools/workflow-validator.mjs setup\n  node scripts/agent-tools/workflow-validator.mjs validate [--source-dir <dir>] [--source-label <label>] [--evidence-file <path>] [--allow-empty]\n\n`);
  process.stdout.write(`Setup downloads the repository-pinned official actionlint v${ACTIONLINT_VERSION} release into node_modules/.cache. Validation never downloads or installs tools.\n`);
}

function parseValidateOptions(args) {
  const options = { repositoryRoot: process.cwd(), sourceLabel: 'working tree', allowEmpty: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--allow-empty') {
      options.allowEmpty = true;
      continue;
    }
    const key = ({
      '--source-dir': 'sourceDir',
      '--source-label': 'sourceLabel',
      '--evidence-file': 'evidenceFile',
    })[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    if (seen.has(key)) throw new Error(`${argument} can be provided only once.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} needs a value.`);
    options[key] = key === 'sourceDir' || key === 'evidenceFile' ? resolve(value) : value;
    seen.add(key);
    index += 1;
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    usage();
    return command ? 0 : 2;
  }
  if (command === 'setup') {
    if (args.length > 0) throw new Error(`Unknown setup argument: ${args[0]}`);
    const installation = await setupPinnedActionlint(process.cwd());
    process.stdout.write(`Set up actionlint v${installation.version} (${installation.platform}-${installation.arch}, sha256 ${installation.executableSha256}) from verified ${installation.archive}.\n`);
    return 0;
  }
  if (command !== 'validate') throw new Error(`Unknown command: ${command}`);
  const options = parseValidateOptions(args);
  if (options.help) {
    usage();
    return 0;
  }
  const report = await validateWorkflows(options);
  if (!report.ok) {
    process.stderr.write(`${report.error ? `${report.error}\n` : ''}Workflow validation failed: actionlint v${report.validator?.version ?? ACTIONLINT_VERSION}; source=${report.source?.label ?? report.sourceLabel ?? options.sourceLabel}${report.source?.workflowSetSha256 ? `; workflow-set-sha256=${report.source.workflowSetSha256}` : ''}.\n`);
    if (report.diagnostics) process.stderr.write(`${report.diagnostics}\n`);
    if (report.evidenceFile) process.stderr.write(`Evidence: ${report.evidenceFile}\n`);
    return report.exitCode;
  }
  process.stdout.write(`Workflow validation passed: actionlint v${report.validator.version}; source=${report.source.label}; files=${report.source.files.length}; workflow-set-sha256=${report.source.workflowSetSha256}.\n`);
  if (report.evidenceFile) process.stdout.write(`Evidence: ${report.evidenceFile}\n`);
  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
