#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { assertRecord, baseRecord, pathWithinRun, runRootFor, sha256, writeRecord } from './evidence.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const reject = message => { throw new Error(message); };
const kinds = ['release-like-apk', 'release-like-android-test-apk'];
function clean() {
  git('diff', '--quiet'); git('diff', '--cached', '--quiet');
}
function signer(file, apksigner) {
  const output = execFileSync(apksigner, ['verify', '--verbose', '--print-certs', file], { encoding: 'utf8' });
  const digest = output.match(/(?:Signer #1|V[0-9.]+ Signer):? certificate SHA-256 digest: ([a-f0-9]{64})/i)?.[1]?.toLowerCase();
  if (!digest) reject('verified certificate SHA-256 is missing');
  return digest;
}
export function verify(run, head, apksigner, product, test) {
  const recordFile = pathWithinRun(run, '08-build.json');
  const seal = readFileSync(pathWithinRun(run, '08-build.sha256'), 'utf8').trim();
  if (seal !== sha256(recordFile)) reject('build seal mismatch');
  const record = JSON.parse(readFileSync(recordFile, 'utf8'));
  assertRecord(record, run);
  if (record.git.sha !== head || !basename(run).endsWith(`-${head.slice(0, 12)}`)) reject('candidate HEAD mismatch; old evidence cannot be rebound');
  const artifacts = kinds.map(kind => {
    const matches = record.artifacts.filter(item => item.kind === kind);
    if (matches.length !== 1) reject(`missing or duplicate ${kind}`);
    return matches[0];
  });
  if (record.build.testPayloadSha256 !== artifacts[1].sha256) reject('candidate test payload identity mismatch');
  if (record.build.sha256 !== artifacts[0].sha256 || record.build.bytes !== artifacts[0].bytes || record.build.apkRelativePath !== artifacts[0].relativePath) reject('candidate build/artifact mismatch');
  const paths = artifacts.map(item => pathWithinRun(run, item.relativePath));
  for (const [index, input] of [product, test].entries()) {
    if (input && (sha256(input) !== artifacts[index].sha256 || statSync(input).size !== artifacts[index].bytes)) reject('supplied APK differs from sealed candidate');
  }
  if (!/^[a-f0-9]{64}$/.test(record.build.signerSha256)) reject('candidate signer digest is missing');
  for (const file of paths) if (signer(file, apksigner) !== record.build.signerSha256) reject('candidate signer mismatch');
  return { record, paths };
}
function seal(run, head, apksigner, product, test, debug) {
  if (existsSync(resolve(run, '08-build.json')) || existsSync(resolve(run, 'artifacts'))) reject('run already has candidate evidence; preserve it and use a new HEAD/run');
  if (!basename(run).endsWith(`-${head.slice(0, 12)}`)) reject('run HEAD mismatch');
  const digest = signer(product, apksigner);
  if (signer(test, apksigner) !== digest || debug && signer(debug, apksigner) !== digest) reject('APK signer lineage mismatch');
  mkdirSync(resolve(run, 'artifacts'));
  const files = [[kinds[0], product, 'releaseLike.apk'], [kinds[1], test, 'releaseLikeAndroidTest.apk']];
  if (debug) files.push(['debug-apk', debug, 'debug.apk']);
  const record = baseRecord(run, 'phase8-build', ['REL-001', 'REL-002', 'TEST-004']);
  record.artifacts = files.map(([kind, source, name]) => {
    const file = resolve(run, 'artifacts', name); copyFileSync(source, file);
    return { kind, relativePath: `artifacts/${name}`, sha256: sha256(file), bytes: statSync(file).size, sanitized: true };
  });
  const apk = record.artifacts[0];
  record.build = { variant: 'releaseLike', applicationId: 'com.dazzlingwuming.listen2', versionCode: 1000001, versionName: '2.34.0-android', apkRelativePath: apk.relativePath, sha256: apk.sha256, bytes: apk.bytes, testPayloadSha256: record.artifacts[1].sha256, signerSha256: digest, zipAligned16KiB: true, minified: true, debuggable: false };
  record.command.argvRedacted = ['verified-single-build-candidate'];
  record.outcome = 'NOT_VERIFIED';
  record.uncovered = [{ requirement: 'REL-001', reasonCode: 'REPRODUCIBILITY_PENDING', safeDetail: 'Candidate sealed for device validation; final two-build reproducibility remains pending.', ownerAction: 'Run the final reproducibility gate after functional acceptance.' }];
  writeRecord(run, '08-build.json', record);
  writeFileSync(resolve(run, '08-build.sha256'), `${sha256(resolve(run, '08-build.json'))}\n`, { flag: 'wx', mode: 0o400 });
}
function main() {
  const flags = new Set(), values = new Map();
  const allowed = new Set(['--run-dir', '--apksigner', '--product-apk', '--test-apk', '--debug-apk', '--build-head']);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (['--verify', '--seal'].includes(arg)) { if (flags.has(arg)) reject('duplicate argument'); flags.add(arg); }
    else { if (!allowed.has(arg) || values.has(arg)) reject(`unknown or duplicate argument: ${arg}`); const value = args[++i]; if (!value || value.startsWith('--')) reject(`missing value: ${arg}`); values.set(arg, value); }
  }
  if (Number(flags.has('--verify')) + Number(flags.has('--seal')) !== 1 || !values.get('--run-dir') || !values.get('--apksigner')) reject('require --verify or --seal, --run-dir and --apksigner');
  if (flags.has('--verify') && (values.has('--debug-apk') || values.has('--build-head'))) reject('seal-only argument used for verification');
  clean(); const head = git('rev-parse', 'HEAD'); const run = runRootFor(values.get('--run-dir'));
  if (flags.has('--seal')) {
    if (values.get('--build-head') !== head || !values.get('--product-apk') || !values.get('--test-apk')) reject('seal requires product/test APKs and the exact build HEAD');
    seal(run, head, values.get('--apksigner'), values.get('--product-apk'), values.get('--test-apk'), values.get('--debug-apk'));
  }
  const { record, paths } = verify(run, head, values.get('--apksigner'), values.get('--product-apk'), values.get('--test-apk'));
  for (const value of [paths[0], record.build.sha256, String(record.build.bytes), record.build.signerSha256, record.git.sha, paths[1]]) console.log(value);
}
if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  try { main(); } catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 3; }
}
