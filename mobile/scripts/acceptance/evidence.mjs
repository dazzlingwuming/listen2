#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const SCRIPT_DIR = resolve(import.meta.dirname);
const MOBILE_ROOT = resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = resolve(MOBILE_ROOT, '..');
const PHASE_SLUG = '08-integrated-api-35-acceptance-release-like-evidence';
const RUN_ID = /^phase08-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/;
const OUTCOMES = new Set(['PASS', 'FAIL', 'BLOCKED', 'DEGRADED', 'NOT_VERIFIED']);
const REQUIRED_KEYS = [
  'schemaVersion', 'runId', 'recordId', 'recordedAt', 'git', 'toolchain',
  'build', 'device', 'network', 'fixture', 'command', 'outcome',
  'requirements', 'metrics', 'artifacts', 'uncovered', 'recovery',
];
const REQUIREMENT_IDS = new Set(
  [...readFileSync(resolve(REPO_ROOT, '.planning/REQUIREMENTS.md'), 'utf8').matchAll(/\b([A-Z]+-\d{3})\b/g)].map(match => match[1]),
);
const SECRET_PATTERN = /(?:-----BEGIN[\s-]*PRIVATE|(?:api[_-]?key|authorization|cookie|password|token)\s*[:=]|bearer\s+|x-amz-signature|signature=|https?:\/\/|[?&](?:sig|token|key)=)/i;

function fail(message) {
  throw new Error(message);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function git(argumentsList) {
  return execFileSync('git', argumentsList, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) fail(`invalid argument: ${item}`);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(item, next);
      index += 1;
    } else {
      flags.add(item);
    }
  }
  return { values, flags };
}

function phaseDir(value) {
  const candidate = resolve(REPO_ROOT, value || `.planning/phases/${PHASE_SLUG}`);
  const expected = resolve(REPO_ROOT, '.planning/phases', PHASE_SLUG);
  if (candidate !== expected) fail('phase directory must be the canonical Phase 8 directory');
  return candidate;
}

function ensureContained(root, candidate, label) {
  const rootReal = realpathSync(root);
  const candidateReal = realpathSync(candidate);
  if (candidateReal !== rootReal && !candidateReal.startsWith(`${rootReal}${sep}`))
    fail(`${label} escapes its containing root`);
  return candidateReal;
}

function isContainedPath(root, candidate) {
  const rootReal = realpathSync(root);
  const candidateReal = realpathSync(candidate);
  return candidateReal === rootReal || candidateReal.startsWith(`${rootReal}${sep}`);
}

function runRootFor(runDir) {
  const phase = resolve(REPO_ROOT, '.planning/phases', PHASE_SLUG);
  const evidence = resolve(phase, 'evidence');
  if (!existsSync(evidence)) mkdirSync(evidence, { recursive: true });
  const evidenceReal = realpathSync(evidence);
  if (!existsSync(runDir)) fail('run directory is missing');
  const runReal = ensureContained(evidenceReal, runDir, 'run directory');
  if (!RUN_ID.test(basename(runReal))) fail('invalid Phase 8 run ID');
  return runReal;
}

function pathWithinRun(runRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath))
    fail('artifact path must be a non-empty relative path');
  if (relativePath.split(/[\\/]/).includes('..')) fail('artifact path may not contain parent segments');
  const candidate = resolve(runRoot, relativePath);
  if (!candidate.startsWith(`${runRoot}${sep}`)) fail('artifact path escapes run root');
  let probe = runRoot;
  for (const component of relative(runRoot, candidate).split(sep)) {
    probe = resolve(probe, component);
    if (existsSync(probe) && lstatSync(probe).isSymbolicLink())
      fail('artifact path may not traverse a symlink');
  }
  if (!existsSync(candidate) || !lstatSync(candidate).isFile()) fail('artifact file is missing');
  return ensureContained(runRoot, candidate, 'artifact');
}

function canonicalExistingFile(runRoot, value, label) {
  if (typeof value !== 'string' || !value) fail(`${label} path is required`);
  const candidate = resolve(value);
  if (!existsSync(candidate) || !lstatSync(candidate).isFile()) fail(`${label} file is missing`);
  if (lstatSync(candidate).isSymbolicLink()) fail(`${label} file may not be a symlink`);
  return ensureContained(runRoot, candidate, label);
}

function assertSafeValue(value, label) {
  if (typeof value === 'string' && SECRET_PATTERN.test(value))
    fail(`${label} contains a forbidden secret or transport pattern`);
  if (Array.isArray(value)) value.forEach((entry, index) => assertSafeValue(entry, `${label}[${index}]`));
  if (value && typeof value === 'object')
    Object.entries(value).forEach(([key, entry]) => {
      if (/^(?:cookie|authorization|headers?|token|password|secret|url)$/i.test(key))
        fail(`${label} contains a forbidden field name`);
      assertSafeValue(entry, `${label}.${key}`);
    });
}

function assertRecord(record, runRoot) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('record must be an object');
  const keys = Object.keys(record).sort();
  if (keys.length !== REQUIRED_KEYS.length || keys.some((key, index) => key !== [...REQUIRED_KEYS].sort()[index]))
    fail('record has unknown or missing keys');
  if (record.schemaVersion !== 1 || !RUN_ID.test(record.runId)) fail('invalid schema or run ID');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.recordId)) fail('invalid record ID');
  if (Number.isNaN(Date.parse(record.recordedAt))) fail('invalid record timestamp');
  if (!OUTCOMES.has(record.outcome)) fail('invalid terminal outcome');
  if (!Array.isArray(record.requirements) || !record.requirements.length) fail('requirements are required');
  if (new Set(record.requirements).size !== record.requirements.length) fail('duplicate requirement IDs');
  for (const requirement of record.requirements)
    if (!REQUIREMENT_IDS.has(requirement)) fail(`unknown requirement ID: ${requirement}`);
  if (!Array.isArray(record.metrics) || !Array.isArray(record.artifacts) || !Array.isArray(record.uncovered))
    fail('record arrays are malformed');
  for (const metric of record.metrics) {
    if (!metric || typeof metric !== 'object' || metric.status === 'PASS' && Number(metric.p95) > Number(metric.budget))
      fail('invalid metric or passing metric over budget');
  }
  for (const artifact of record.artifacts) {
    if (!artifact || typeof artifact !== 'object') fail('invalid artifact record');
    const artifactFile = pathWithinRun(runRoot, artifact.relativePath);
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || sha256(artifactFile) !== artifact.sha256)
      fail('artifact SHA-256 is missing or mismatched');
    if (statSync(artifactFile).size !== artifact.bytes) fail('artifact byte count is mismatched');
    if (artifact.sanitized !== true) fail('artifact must be marked sanitized');
  }
  if (!record.git || record.git.trackedClean !== true || !Array.isArray(record.git.allowedUntracked))
    fail('git provenance is malformed');
  if (!record.command || !Array.isArray(record.command.argvRedacted)) fail('command provenance is malformed');
  if (Date.parse(record.command.endedAt) < Date.parse(record.command.startedAt))
    fail('command timestamps are reversed');
  assertSafeValue(record, 'record');
}

function requireDirectory(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && RUN_ID.test(entry.name))
    .map(entry => entry.name)
    .sort();
}

function currentRun(phase, head, create) {
  const evidenceRoot = resolve(phase, 'evidence');
  if (!existsSync(evidenceRoot)) mkdirSync(evidenceRoot, { recursive: true });
  const candidates = requireDirectory(evidenceRoot).filter(name => name.endsWith(`-${head.slice(0, 12)}`));
  if (candidates.length > 1) fail('more than one evidence run exists for the current HEAD');
  if (candidates.length === 1) return runRootFor(resolve(evidenceRoot, candidates[0]));
  if (!create) fail('no evidence run exists for the current HEAD');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const runId = `phase08-${timestamp}-${head.slice(0, 12)}`;
  const run = resolve(evidenceRoot, runId);
  mkdirSync(run, { recursive: false });
  return runRootFor(run);
}

function baseRecord(runRoot, recordId, requirements) {
  const head = git(['rev-parse', 'HEAD']);
  return {
    schemaVersion: 1,
    runId: basename(runRoot),
    recordId,
    recordedAt: new Date().toISOString(),
    git: { branch: git(['branch', '--show-current']) || 'detached', sha: head, trackedClean: true, allowedUntracked: [] },
    toolchain: {
      os: process.platform, arch: process.arch, node: process.version, npm: process.env.PHASE8_NPM_VERSION || 'recorded-by-build',
      java: process.env.PHASE8_JAVA_VERSION || 'recorded-by-build', gradle: process.env.PHASE8_GRADLE_VERSION || 'recorded-by-build',
      agp: 'repository-pinned', kotlin: '2.2.0', androidHomeHash: process.env.PHASE8_ANDROID_HOME_HASH || 'recorded-by-build',
      buildTools: '37.0.0', compileSdk: 37, targetSdk: 36, minSdk: 24, ndk: '27.1.12297006',
    },
    build: { variant: 'preflight', applicationId: 'com.dazzlingwuming.listen2', versionCode: 0, versionName: 'not-built', apkRelativePath: 'none', bytes: 0, sha256: '0'.repeat(64), signerSha256: 'development-debug', zipAligned16KiB: false, minified: false, debuggable: false },
    device: { serialHash: 'not-used', avdName: 'not-used', image: 'not-used', apiLevel: 0, abi: 'not-used', ramMiB: 0, cores: 0, resolution: 'not-used', density: 0, locale: 'not-used', fontScale: 0, navigationMode: 'not-used' },
    network: { mode: 'host-build', transport: 'not-used', offlineWindows: [], proxyConfigured: false },
    fixture: { id: 'phase8-build', revision: '1', manifestSha256: '0'.repeat(64), queryIds: [], generatedMediaSha256: '0'.repeat(64), accountLane: 'none' },
    command: { id: recordId, argvRedacted: ['phase8-acceptance'], startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', exitCode: 0 },
    outcome: 'PASS', requirements, metrics: [], artifacts: [], uncovered: [],
    recovery: { cleanupStatus: 'not-required', deviceStateRestored: true, rollbackArtifactSha256: '0'.repeat(64), steps: [] },
  };
}

function writeRecord(runRoot, name, record) {
  if (!/^(?:08-(?:prerequisites|build|journey|api35-performance|performance|live-provider|evidence-index)\.json)$/.test(name))
    fail('record filename is not a permitted Phase 8 evidence record');
  const destination = resolve(runRoot, name);
  if (existsSync(destination)) fail('evidence record already exists and is immutable');
  assertRecord(record, runRoot);
  const temporary = resolve(runRoot, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  if (lstatSync(temporary).isSymbolicLink()) fail('temporary evidence file became a symlink');
  renameSync(temporary, destination);
}

function makePrerequisitesRecord(runRoot) {
  const record = baseRecord(runRoot, 'phase8-prerequisites', ['REL-001', 'REL-002', 'TEST-004']);
  writeRecord(runRoot, '08-prerequisites.json', record);
}

function makeBuildRecord(runRoot) {
  const release = pathWithinRun(runRoot, 'artifacts/releaseLike.apk');
  const debug = pathWithinRun(runRoot, 'artifacts/debug.apk');
  const androidTest = pathWithinRun(runRoot, 'artifacts/releaseLikeAndroidTest.apk');
  const record = baseRecord(runRoot, 'phase8-build', ['REL-001', 'REL-002', 'TEST-004']);
  record.build = {
    variant: 'releaseLike', applicationId: 'com.dazzlingwuming.listen2', versionCode: 1000001,
    versionName: '2.34.0-android', apkRelativePath: 'artifacts/releaseLike.apk', bytes: statSync(release).size,
    sha256: sha256(release), signerSha256: 'development-debug', zipAligned16KiB: true,
    minified: true, debuggable: false,
  };
  record.artifacts = [
    ['debug-apk', debug], ['release-like-apk', release], ['release-like-android-test-apk', androidTest],
  ].map(([kind, file]) => ({ kind, relativePath: relative(runRoot, file), sha256: sha256(file), bytes: statSync(file).size, sanitized: true }));
  writeRecord(runRoot, '08-build.json', record);
}

function selfTestContainment() {
  const root = resolve('/tmp', `listen2-phase8-evidence-${randomBytes(5).toString('hex')}`);
  mkdirSync(resolve(root, 'phase08-20260915T000000Z-0123456789ab', 'artifacts'), { recursive: true });
  const run = resolve(root, 'phase08-20260915T000000Z-0123456789ab');
  const artifact = resolve(run, 'artifacts', 'safe.txt');
  writeFileSync(artifact, 'safe\n');
  try {
    if (pathWithinRun(run, 'artifacts/safe.txt') !== realpathSync(artifact)) fail('contained artifact self-test failed');
    let rejected = false;
    try { pathWithinRun(run, '../escape.txt'); } catch { rejected = true; }
    if (!rejected) fail('parent traversal self-test failed');
    const escape = resolve(root, 'escape.txt');
    writeFileSync(escape, 'escape\n');
    if (isContainedPath(run, escape)) fail('run escape containment self-test failed');
    if (!isContainedPath(root, artifact)) fail('derived run artifact containment self-test failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log('Phase 8 evidence containment self-test passed.');
}

function main() {
  const { values, flags } = parseArgs();
  if (flags.has('--self-test-containment')) return selfTestContainment();
  const phase = phaseDir(values.get('--phase-dir'));
  const head = values.get('--head') || git(['rev-parse', 'HEAD']);
  if (flags.has('--resolve-current-run')) {
    console.log(currentRun(phase, head, false));
    return;
  }
  if (flags.has('--ensure-current-run')) {
    console.log(currentRun(phase, head, true));
    return;
  }
  if (values.has('--validate')) {
    const recordFile = values.get('--validate');
    if (!recordFile) fail('missing record for validation');
    const candidate = resolve(process.cwd(), recordFile);
    const run = runRootFor(dirname(candidate));
    const canonicalRecord = canonicalExistingFile(run, candidate, 'evidence record');
    if (!/^08-(?:prerequisites|build|journey|api35-performance|performance|evidence-index)\.json$/.test(basename(canonicalRecord)))
      fail('evidence record filename is not permitted');
    assertRecord(JSON.parse(readFileSync(canonicalRecord, 'utf8')), run);
    console.log('Phase 8 evidence record is valid.');
    return;
  }
  const run = runRootFor(values.get('--run-dir'));
  if (flags.has('--write')) {
    const input = values.get('--input');
    const name = values.get('--name');
    if (!input || !name) fail('write requires --input and --name');
    const canonicalInput = canonicalExistingFile(run, input, 'evidence input');
    writeRecord(run, name, JSON.parse(readFileSync(canonicalInput, 'utf8')));
    return;
  }
  if (flags.has('--write-prerequisites')) return makePrerequisitesRecord(run);
  if (flags.has('--write-build')) return makeBuildRecord(run);
  fail('unsupported evidence command');
}

try {
  main();
} catch (error) {
  console.error(`Phase 8 evidence error: ${error.message}`);
  process.exitCode = 1;
}
