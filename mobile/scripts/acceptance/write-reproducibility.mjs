#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { verify } from './candidate.mjs';
import { assertRecord, pathWithinRun, runRootFor, sha256, writeRecord } from './evidence.mjs';

const repo = resolve(import.meta.dirname, '../../..');
export function safeMapping(raw) {
  return !/\/Users\/|\/home\/|C:\\Users\\|-----BEGIN.*PRIVATE|[?&](?:sig|token|key)=|https?:\/\//iu.test(raw);
}
export function safeLog(raw) {
  // Full tool output stays in an ephemeral directory outside the repository.
  // Retain only a fixed task/result vocabulary; arbitrary exception text is excluded.
  return raw.split(/\r?\n/u).flatMap(line => {
    if (/^> Task :[A-Za-z0-9:]+(?: (?:UP-TO-DATE|FROM-CACHE|NO-SOURCE|SKIPPED|FAILED))?$/u.test(line) || /^BUILD (?:SUCCESSFUL|FAILED) in [0-9a-z ]+$/u.test(line)) return [line];
    if (/^Phase 8 reproducibility: repro-build-(?:one|two) /u.test(line) && / status=PASS$/u.test(line)) return ['Independent canonical APK comparison completed: PASS'];
    if (/^Phase 8 reproducibility failed: repro-build-(?:one|two) /u.test(line)) return ['Independent canonical APK comparison completed: FAIL'];
    return [];
  }).join('\n') + '\n';
}
export function makeRecord(run, original, results, independent, files) {
  const pass = results.length === 2 && results.every(result => result.buildExit === 0 && result.compareExit === 0 && result.mappingStatus === 'retained') && independent.every(result => result === 'PASS') && independent.length === 2;
  const failed = results.some(result => result.buildExit !== 0 || result.compareExit !== 0 || result.mappingStatus !== 'retained') || independent.includes('FAIL');
  const now = new Date().toISOString();
  const record = { ...original, recordId: 'phase8-independent-reproducibility', recordedAt: now, requirements: ['REL-001'], metrics: [],
    command: { id: 'two-clean-release-like-reproductions', argvRedacted: ['offline-clean-assembleReleaseLike', 'explicit-candidate-abis', 'two-independent-canonical-apk-comparisons'], startedAt: results[0]?.startedAt || now, endedAt: now, timezone: 'Asia/Shanghai', exitCode: pass ? 0 : failed ? 1 : 3, evidenceKinds: ['REPRO_BUILD'] },
    outcome: pass ? 'PASS' : failed ? 'FAIL' : 'NOT_VERIFIED',
    artifacts: files.map(([kind, relativePath]) => { const file = pathWithinRun(run, relativePath); return { kind, relativePath, sha256: sha256(file), bytes: statSync(file).size, sanitized: true }; }),
    uncovered: pass ? [] : [{ requirement: 'REL-001', reasonCode: 'INDEPENDENT_REPRODUCTION_NON_PASS', safeDetail: `buildAttempts=${results.length};independentComparisons=${independent.join('-') || 'NOT_VERIFIED'};mapping=${results.map(result => result.mappingStatus).join('-')}`, ownerAction: 'Retain original build/seal and failed reproduction outputs; diagnose before a new candidate run.' }],
    recovery: { cleanupStatus: 'not-required', deviceStateRestored: true, rollbackArtifactSha256: original.build.sha256, steps: ['original candidate record and seal retained unchanged', 'only generated Android build outputs cleaned', 'no device or formal signer modified'] } };
  assertRecord(record, run); return record;
}
export function createRecord(run, apksigner) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  execFileSync('git', ['diff', '--quiet'], { cwd: repo }); execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: repo });
  const { record: original, paths } = verify(run, head, apksigner);
  const files = [['sealed-build-record', '08-build.json'], ['sealed-build-record-checksum', '08-build.sha256']];
  const results = [], independent = [];
  for (const label of ['one', 'two']) {
    const directory = `reproducibility/build-${label}`;
    const resultFile = `${directory}/result.json`;
    if (!existsSync(resolve(run, resultFile))) { independent.push('NOT_VERIFIED'); continue; }
    const result = JSON.parse(readFileSync(pathWithinRun(run, resultFile), 'utf8'));
    if (Object.keys(result).some(key => !['startedAt', 'endedAt', 'buildExit', 'compareExit', 'mappingStatus', 'abi'].includes(key)) || !Number.isInteger(result.buildExit) || !Number.isInteger(result.compareExit) || !['retained', 'missing', 'unsafe-output-withheld'].includes(result.mappingStatus) || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/u.test(result.startedAt) || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/u.test(result.endedAt) || !/^(?:arm64-v8a|armeabi-v7a|x86|x86_64)(?:,(?:arm64-v8a|armeabi-v7a|x86|x86_64))*$/u.test(result.abi)) throw new Error('malformed reproduction attempt');
    results.push(result); files.push([`repro-build-${label}-result`, resultFile]);
    const apk = `${directory}/releaseLike.apk`;
    if (existsSync(resolve(run, apk))) {
      files.push([`repro-build-${label}-apk`, apk]);
      try {
        execFileSync('bash', ['-c', 'source "$1"; phase8_compare_apks "$2" "$3" "$4" "$5"', 'phase08-repro', resolve(import.meta.dirname, 'reproducibility-gate.sh'), paths[0], pathWithinRun(run, apk), apksigner, `repro-build-${label}`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
        independent.push('PASS');
      } catch (error) { independent.push(error.code === 'ENOENT' || error.code === 'ETIMEDOUT' ? 'NOT_VERIFIED' : 'FAIL'); }
    } else independent.push('NOT_VERIFIED');
    for (const name of ['build.log', 'compare.log']) if (existsSync(resolve(run, directory, name))) {
      const raw = readFileSync(pathWithinRun(run, `${directory}/${name}`), 'utf8');
      if (raw !== safeLog(raw) && !/^Independent canonical APK comparison completed: (?:PASS|FAIL)\n$/u.test(raw)) throw new Error('unsafe reproduction log');
      files.push([`repro-build-${label}-${name.replace('.', '-')}`, `${directory}/${name}`]);
    }
    for (const name of ['mapping.txt', 'usage.txt', 'seeds.txt']) {
      const relativePath = `${directory}/mapping/${name}`;
      if (!existsSync(resolve(run, relativePath))) { if (result.mappingStatus === 'retained') result.mappingStatus = 'missing'; continue; }
      if (!safeMapping(readFileSync(pathWithinRun(run, relativePath), 'utf8'))) { result.mappingStatus = 'unsafe-output-withheld'; continue; }
      files.push([`repro-build-${label}-r8-${name.replace('.', '-')}`, relativePath]);
    }
  }
  const record = makeRecord(run, original, results, independent, files); writeRecord(run, '08-reproducibility.json', record); return record;
}
function main() {
  const args = process.argv.slice(2);
  if (args.length === 4 && args[0] === '--safe-log' && args[2] === '--output') {
    writeFileSync(args[3], safeLog(readFileSync(args[1], 'utf8')), { flag: 'wx', mode: 0o600 }); return;
  }
  if (args.length !== 4 || args[0] !== '--run-dir' || args[2] !== '--apksigner') throw new Error('usage: write-reproducibility.mjs --run-dir DIR --apksigner FILE');
  const record = createRecord(runRootFor(args[1]), args[3]);
  console.log(`Independent reproduction outcome: ${record.outcome}`);
  if (record.outcome !== 'PASS') process.exitCode = 4;
}
if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  try { main(); } catch (error) { console.error(`BLOCKED: reproduction evidence could not be sealed (${error.code || 'contract-error'})`); process.exitCode = 3; }
}
