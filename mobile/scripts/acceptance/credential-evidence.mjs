#!/usr/bin/env node
// Retained-data observations only. No account identity, input text, QR or lyrics are accepted.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertRecord, pathWithinRun, sha256 } from './evidence.mjs';
const PHASES = ['baseline', 'resume'];
export const CREDENTIAL_GAPS = { 'AUTH-002': 'CREDENTIAL_QR_LIFECYCLE_PARTIAL', 'AI-001': 'CREDENTIAL_DELETE_NOT_EXERCISED', 'AI-003': 'CREDENTIAL_TRANSLATION_VALIDATION_PARTIAL' };
export const CREDENTIAL_MANIFEST = { schemaVersion: 1, scenario: 'retained-data-ui-credential', phases: PHASES, inputMode: 'visible-native-ui-only', destructiveActions: false, generatedMedia: false };
const STATES = {
  entry: ['IN_PROGRESS', 'UNAVAILABLE'],
  account: ['AUTHENTICATED', 'NOT_AUTHENTICATED', 'UNAVAILABLE'],
  configuration: ['CONFIGURED', 'NOT_CONFIGURED'],
  connection: ['PASS', 'NOT_VERIFIED', 'UNAVAILABLE'],
  translation: ['PASS', 'NOT_VERIFIED', 'NOT_REQUESTED', 'ELIGIBLE_LYRIC_UNAVAILABLE', 'CONSENT_UNAVAILABLE'],
};
const reject = code => { throw new Error(code); };
export function parseCredentialOutput(output, phase) {
  if (!PHASES.includes(phase)) reject('CREDENTIAL_PHASE_INVALID');
  const result = {};
  for (const match of output.matchAll(/credential-observation=([a-z]+):([a-z]+):([A-Z_]+)/g)) {
    const [, observedPhase, name, value] = match;
    if (observedPhase !== phase || !STATES[name]?.includes(value) || Object.hasOwn(result, name)) reject('CREDENTIAL_OBSERVATION_INVALID');
    result[name] = value;
  }
  return result;
}
export function assertCredentialObservations(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'baseline,resume,schemaVersion,serialHash,startedAt' || value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(value.serialHash) || typeof value.startedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.startedAt) || !Number.isFinite(Date.parse(value.startedAt))) reject('CREDENTIAL_OBSERVATIONS_SCHEMA_INVALID');
  for (const phase of PHASES) {
    if (!value[phase] || typeof value[phase] !== 'object' || Array.isArray(value[phase])) reject('CREDENTIAL_OBSERVATIONS_SCHEMA_INVALID');
    if (Object.hasOwn(value[phase], 'entry') && Object.keys(value[phase]).length !== 1) reject('CREDENTIAL_OBSERVATION_INVALID');
    for (const [name, state] of Object.entries(value[phase])) if (!STATES[name]?.includes(state) || phase === 'resume' && ['connection', 'translation'].includes(name)) reject('CREDENTIAL_OBSERVATION_INVALID');
  }
}
export function credentialResults(observations) {
  assertCredentialObservations(observations);
  const b = observations.baseline, r = observations.resume;
  return {
    accountRetained: b.account === 'AUTHENTICATED' && r.account === 'AUTHENTICATED' ? 'PASS' : 'NOT_VERIFIED',
    configurationRetained: b.configuration === 'CONFIGURED' && r.configuration === 'CONFIGURED' ? 'PASS' : 'NOT_VERIFIED',
    connection: b.connection === 'PASS' ? 'PASS' : 'NOT_VERIFIED',
    translationUi: b.translation === 'PASS' ? 'PASS' : 'NOT_VERIFIED',
  };
}
export function nextCredentialAttempt(run) {
  for (let i = 1; i <= 32; i++) {
    const suffix = String(i).padStart(3, '0');
    if (!existsSync(resolve(run, `08-credential-live-${suffix}.json`)) && !existsSync(resolve(run, 'credential', `attempt-${suffix}`))) return suffix;
  }
  reject('CREDENTIAL_ATTEMPT_LIMIT');
}
export function writeCredentialEvidence(run, suffix, observations) {
  if (!/^0(?:0[1-9]|[12][0-9]|3[0-2])$/.test(suffix)) reject('CREDENTIAL_ATTEMPT_INVALID');
  assertCredentialObservations(observations);
  const name = `08-credential-live-${suffix}.json`, destination = resolve(run, name);
  if (existsSync(destination)) reject('CREDENTIAL_RECORD_IMMUTABLE');
  const parent = resolve(run, 'credential');
  if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) reject('CREDENTIAL_DIRECTORY_INVALID');
  if (!existsSync(parent)) mkdirSync(parent);
  const directory = resolve(parent, `attempt-${suffix}`);
  if (existsSync(directory)) reject('CREDENTIAL_ATTEMPT_IMMUTABLE');
  mkdirSync(directory, { recursive: false });
  const manifest = CREDENTIAL_MANIFEST;
  writeFileSync(resolve(directory, 'scenario-manifest.json'), `${JSON.stringify(manifest)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(resolve(directory, 'observations.json'), `${JSON.stringify(observations)}\n`, { flag: 'wx', mode: 0o600 });
  const build = JSON.parse(readFileSync(pathWithinRun(run, '08-build.json'), 'utf8'));
  const results = credentialResults(observations);
  const passed = Object.values(results).every(status => status === 'PASS');
  const artifactPaths = ['08-build.json', '08-build.sha256', `credential/attempt-${suffix}/scenario-manifest.json`, `credential/attempt-${suffix}/observations.json`];
  const record = { ...build, recordId: `phase8-credential-live-${suffix}`, recordedAt: new Date().toISOString(),
    device: { ...build.device, apiLevel: 35, serialHash: observations.serialHash },
    network: { mode: 'retained-data-visible-credential-ui', transport: 'emulator', offlineWindows: [], proxyConfigured: false },
    fixture: { id: 'phase08-credential-live', revision: '1', manifestSha256: sha256(resolve(directory, 'scenario-manifest.json')), generatedMediaSha256: '0'.repeat(64), queryIds: [], accountLane: observations.baseline.configuration === 'CONFIGURED' && observations.baseline.account === 'AUTHENTICATED' ? 'authorized-in-app' : 'none' },
    command: { id: 'retained-data-credential-ui', argvRedacted: ['explicit-api35-serial', 'baseline-safe-ui', 'one-data-preserving-process-stop', 'resume-safe-ui'], startedAt: observations.startedAt, endedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', exitCode: passed ? 0 : 4, evidenceKinds: ['INSTRUMENTATION', 'API35_E2E', 'CREDENTIAL_LIVE'] },
    outcome: passed ? 'PASS' : 'NOT_VERIFIED', requirements: ['AUTH-002', 'AI-001', 'AI-003'], metrics: [],
    artifacts: artifactPaths.map(path => { const file = pathWithinRun(run, path); return { kind: path.endsWith('observations.json') ? 'credential-observations' : path.endsWith('scenario-manifest.json') ? 'credential-scenario-manifest' : 'candidate-seal-reference', relativePath: path, sha256: sha256(file), bytes: readFileSync(file).length, sanitized: true }; }),
    uncovered: [
      { requirement: 'AUTH-002', reasonCode: 'CREDENTIAL_QR_LIFECYCLE_PARTIAL', safeDetail: `authenticatedAndRetained=${results.accountRetained}; expiry, cancellation and retry transitions are not exercised after the single user login.`, ownerAction: 'Use isolated pre-configuration fixture proof; retain this authenticated session.' },
      { requirement: 'AI-001', reasonCode: 'CREDENTIAL_DELETE_NOT_EXERCISED', safeDetail: `configurationRetained=${results.configurationRetained};connection=${results.connection}; live key deletion is deliberately not exercised.`, ownerAction: 'Retain the configured vault; use isolated deletion contracts and report remaining device coverage.' },
      { requirement: 'AI-003', reasonCode: 'CREDENTIAL_TRANSLATION_VALIDATION_PARTIAL', safeDetail: `translationUi=${results.translationUi}; visible fresh completion is not independent proof of all cache alignment, revision or secret-leakage cases.`, ownerAction: 'Combine bounded contract/security proof without exporting lyrics, responses or credentials.' },
    ],
    recovery: { cleanupStatus: 'not-required', deviceStateRestored: true, rollbackArtifactSha256: build.build.sha256, steps: ['retained installed APK and encrypted configuration', 'no settings toggles or destructive data operations', 'no screenshots, UI dumps, account identity or model response exported'] },
  };
  assertRecord(record, run);
  writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return record;
}
