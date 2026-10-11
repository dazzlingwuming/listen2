#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { runRootFor } from './evidence.mjs';
import { verify as verifyCandidate } from './candidate.mjs';
import { nextCredentialAttempt, parseCredentialOutput, writeCredentialEvidence } from './credential-evidence.mjs';
const REPO = resolve(import.meta.dirname, '../../..');
const TARGET = 'com.dazzlingwuming.listen2', TEST = `${TARGET}.test`;
const reject = code => { const error = new Error(code); error.code = code; throw error; };
export function parseCredentialArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]; if (Object.hasOwn(result, arg)) reject('ARGUMENT_DUPLICATE');
    if (arg === '--allow-translation') result[arg] = true;
    else if (['--run-dir', '--serial'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) result[arg] = args[++i];
    else reject('ARGUMENT_INVALID');
  }
  if (!result['--run-dir'] || !/^[A-Za-z0-9._:-]{1,128}$/.test(result['--serial'] || '')) reject('RUN_AND_EXPLICIT_SERIAL_REQUIRED');
  return result;
}
function main() {
  const args = parseCredentialArgs(process.argv.slice(2));
  const requestedRun = resolve(args['--run-dir']);
  const run = runRootFor(requestedRun);
  const canonicalRun = resolve(REPO, '.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence', basename(run));
  if (requestedRun !== canonicalRun || run !== canonicalRun) reject('RUN_PATH_INVALID');
  let pathProbe = REPO;
  for (const part of relative(REPO, canonicalRun).split(sep)) { pathProbe = resolve(pathProbe, part); if (lstatSync(pathProbe).isSymbolicLink()) reject('RUN_SYMLINK_REJECTED'); }
  if (existsSync(resolve(run, '08-evidence-index.json'))) reject('FINAL_INDEX_ALREADY_SEALED');
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME; if (!sdk) reject('ANDROID_SDK_REQUIRED');
  const signer = resolve(sdk, 'build-tools/37.0.0/apksigner'), adb = resolve(sdk, 'platform-tools/adb');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const { record } = verifyCandidate(run, head, signer);
  const serial = args['--serial'];
  const device = (...argv) => execFileSync(adb, ['-s', serial, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 210000, maxBuffer: 4 * 1024 * 1024 });
  if (device('get-state').trim() !== 'device' || device('shell', 'getprop', 'ro.build.version.sdk').trim() !== '35') reject('EXPLICIT_API35_DEVICE_REQUIRED');
  const hashes = [record.build.sha256, record.build.testPayloadSha256];
  for (const [index, pkg] of [TARGET, TEST].entries()) {
    const lines = device('shell', 'pm', 'path', pkg).trim().split('\n');
    if (lines.length !== 1 || !/^package:\/data\/app\/[A-Za-z0-9_./=+\-]+\/base\.apk$/.test(lines[0])) reject('INSTALLED_PACKAGE_PATH_INVALID');
    const apk = execFileSync(adb, ['-s', serial, 'exec-out', 'cat', lines[0].slice(8)], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 128 * 1024 * 1024 });
    if (createHash('sha256').update(apk).digest('hex') !== hashes[index]) reject('INSTALLED_CANDIDATE_HASH_MISMATCH');
  }
  const suffix = nextCredentialAttempt(run);
  const observations = { schemaVersion: 1, serialHash: createHash('sha256').update(serial).digest('hex'), startedAt: new Date().toISOString(), baseline: {}, resume: {} };
  const instrument = phase => {
    try {
      const output = device('shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'com.listen2mobile.acceptance.CredentialAcceptanceTest', '-e', 'credentialPhase', phase, '-e', 'allowTranslation', String(Boolean(args['--allow-translation'])), `${TEST}/com.listen2mobile.acceptance.Phase08Instrumentation`);
      if (!/INSTRUMENTATION_CODE:\s*-1\b/.test(output) || /INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|shortMsg=/.test(output)) return {};
      return parseCredentialOutput(output, phase);
    } catch { return {}; }
  };
  observations.baseline = instrument('baseline');
  // Do not interrupt an unfinished native credential-entry screen.
  if (!observations.baseline.entry && observations.baseline.configuration === 'CONFIGURED' && observations.baseline.account === 'AUTHENTICATED') {
    device('shell', 'am', 'force-stop', TARGET);
    observations.resume = instrument('resume');
  }
  const evidence = writeCredentialEvidence(run, suffix, observations);
  console.log(`${evidence.outcome}: ${evidence.recordId}; partial lifecycle coverage is retained. Credentials and installed data remain in place.`);
  if (evidence.outcome !== 'PASS') process.exitCode = 4;
}
if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  try { main(); } catch (error) { console.error(`Credential acceptance rejected: ${/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SAFE_VALIDATION_FAILED'}.`); process.exitCode = 3; }
}
