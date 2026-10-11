#!/usr/bin/env node
// Retained-data observations only. No account identity, input text, QR or lyrics are accepted.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertRecord, pathWithinRun, sha256 } from './evidence.mjs';
const PHASES = ['baseline', 'resume', 'playback', 'offline'];
export const CREDENTIAL_GAPS = { 'AUTH-002': 'CREDENTIAL_QR_LIFECYCLE_PARTIAL', 'AI-001': 'CREDENTIAL_DELETE_NOT_EXERCISED', 'AI-003': 'CREDENTIAL_TRANSLATION_VALIDATION_PARTIAL', 'PLAY-001': 'BILIBILI_EXACT_CID_AND_RENDITION_NOT_PROVEN', 'CACHE-001': 'DOWNLOAD_UI_READY_NATIVE_INTEGRITY_PARTIAL', 'CACHE-002': 'OFFLINE_RESTART_EXACT_PART_LIFECYCLE_PARTIAL' };
export const CREDENTIAL_MANIFEST = { schemaVersion: 1, scenario: 'retained-data-ui-credential', phases: PHASES, inputMode: 'visible-native-ui-only', destructiveActions: false, generatedMedia: false, networkMutations: 'bounded-wifi-data-disable-and-restore', partSelection: 'unique-visible-P1-only-exact-CID-not-proven' };
const STATES = {
  entry: ['IN_PROGRESS', 'UNAVAILABLE'],
  account: ['AUTHENTICATED', 'NOT_AUTHENTICATED', 'UNAVAILABLE'],
  configuration: ['CONFIGURED', 'NOT_CONFIGURED'],
  connection: ['PASS', 'NOT_VERIFIED', 'UNAVAILABLE'],
  translation: ['PASS', 'NOT_VERIFIED', 'NOT_REQUESTED', 'ELIGIBLE_LYRIC_UNAVAILABLE', 'CONSENT_UNAVAILABLE'],
};
const NUMERIC_FIELDS = ['positionstartms', 'positionendms'];
const PHASE_FIELDS = {baseline:['entry','account','configuration','connection','translation'],resume:['entry','account','configuration'],playback:['entry','account','selection','playback','download',...NUMERIC_FIELDS],offline:['entry','playback','download',...NUMERIC_FIELDS]};
Object.assign(STATES, {selection:['UNIQUE_P1','NOT_VERIFIED'],playback:['PLAYING_ADVANCING','NOT_VERIFIED','PROVIDER_UNAVAILABLE','NOT_AUTHENTICATED'],download:['READY_CHECKED','NOT_VERIFIED','DOWNLOAD_FAILED','NOT_ELIGIBLE']});
export const emptyCredentialNetwork = () => ({originalWifi:null,originalData:null,offlineWifi:null,offlineData:null,defaultNetworkAbsent:false,restoredWifi:null,restoredData:null,restoreStatus:'NOT_REQUESTED',signal:'NONE'});
const reject = code => { throw new Error(code); };
export function parseCredentialOutput(output, phase) {
  if (!PHASES.includes(phase)) reject('CREDENTIAL_PHASE_INVALID');
  const result = {};
  for (const line of output.split(/\r?\n/u)) {
    if (!line.includes('credential-observation=')) continue;
    const match = line.trim().match(/^(?:INSTRUMENTATION_STATUS: stream=)?credential-observation=([a-z]+):([a-z]+):([A-Z_]+|[0-9]{1,12})$/u);
    if (!match) reject('CREDENTIAL_OBSERVATION_INVALID');
    const [, observedPhase, name, raw] = match;
    const value = NUMERIC_FIELDS.includes(name) ? Number(raw) : raw;
    if (observedPhase !== phase || !PHASE_FIELDS[phase].includes(name) || Object.hasOwn(result, name) || (NUMERIC_FIELDS.includes(name) ? !Number.isSafeInteger(value) || value < 0 || value > 86400000 : !STATES[name]?.includes(value))) reject('CREDENTIAL_OBSERVATION_INVALID');
    result[name] = value;
  }
  return result;
}
export function assertCredentialObservations(value) {
  const required = ['baseline','resume','schemaVersion','serialHash','startedAt'];
  if (!value || required.some(key=>!Object.hasOwn(value,key)) || Object.keys(value).some(key=>![...required,'playback','offline','network'].includes(key)) || value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(value.serialHash) || typeof value.startedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.startedAt) || !Number.isFinite(Date.parse(value.startedAt))) reject('CREDENTIAL_OBSERVATIONS_SCHEMA_INVALID');
  for (const phase of PHASES) {
    const observations = value[phase] ?? {};
    if (typeof observations !== 'object' || Array.isArray(observations)) reject('CREDENTIAL_OBSERVATIONS_SCHEMA_INVALID');
    if (Object.hasOwn(observations, 'entry') && Object.keys(observations).length !== 1) reject('CREDENTIAL_OBSERVATION_INVALID');
    for (const [name, state] of Object.entries(observations)) if (!PHASE_FIELDS[phase].includes(name) || (NUMERIC_FIELDS.includes(name) ? !Number.isSafeInteger(state) || state < 0 || state > 86400000 : !STATES[name]?.includes(state))) reject('CREDENTIAL_OBSERVATION_INVALID');
  }
  if (value.network !== undefined) {
    const network=value.network, template=emptyCredentialNetwork();
    if (!network || Object.keys(network).sort().join(',') !== Object.keys(template).sort().join(',') || typeof network.defaultNetworkAbsent !== 'boolean' || !['NOT_REQUESTED','RESTORED','RESTORE_FAILED'].includes(network.restoreStatus) || !['NONE','SIGINT','SIGTERM','SIGHUP'].includes(network.signal) || ['originalWifi','originalData','offlineWifi','offlineData','restoredWifi','restoredData'].some(key=>![null,0,1].includes(network[key]))) reject('CREDENTIAL_NETWORK_INVALID');
  }
}
export function credentialResults(observations) {
  assertCredentialObservations(observations);
  const b = observations.baseline, r = observations.resume, p=observations.playback??{}, o=observations.offline??{}, n=observations.network??emptyCredentialNetwork();
  const advances = phase => phase.playback === 'PLAYING_ADVANCING' && Number.isSafeInteger(phase.positionstartms) && phase.positionstartms > 0 && Number.isSafeInteger(phase.positionendms) && phase.positionendms > phase.positionstartms;
  const playback=b.account==='AUTHENTICATED' && p.account==='AUTHENTICATED' && p.selection==='UNIQUE_P1' && advances(p);
  const download=playback && p.download==='READY_CHECKED';
  const offline=download && o.download==='READY_CHECKED' && advances(o) && n.offlineWifi===0 && n.offlineData===0 && n.defaultNetworkAbsent && n.restoreStatus==='RESTORED' && n.originalWifi!==null && n.originalData!==null && n.originalWifi===n.restoredWifi && n.originalData===n.restoredData && n.signal==='NONE';
  return {
    accountRetained: b.account === 'AUTHENTICATED' && r.account === 'AUTHENTICATED' ? 'PASS' : 'NOT_VERIFIED',
    configurationRetained: b.configuration === 'CONFIGURED' && r.configuration === 'CONFIGURED' ? 'PASS' : 'NOT_VERIFIED',
    connection: b.connection === 'PASS' ? 'PASS' : 'NOT_VERIFIED',
    translationUi: b.translation === 'PASS' ? 'PASS' : 'NOT_VERIFIED',
    authenticatedPlayback:playback?'PASS':'NOT_VERIFIED', downloadReady:download?'PASS':'NOT_VERIFIED', offlineRestart:offline?'PASS':'NOT_VERIFIED',
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
    network: { mode: 'retained-data-visible-credential-ui', transport: 'emulator', offlineWindows: observations.network?.defaultNetworkAbsent ? ['verified-no-default-network-after-wifi-and-data-disable'] : [], proxyConfigured: false },
    fixture: { id: 'phase08-credential-live', revision: '2', manifestSha256: sha256(resolve(directory, 'scenario-manifest.json')), generatedMediaSha256: '0'.repeat(64), queryIds: [], accountLane: observations.baseline.configuration === 'CONFIGURED' && observations.baseline.account === 'AUTHENTICATED' ? 'authorized-in-app' : 'none' },
    command: { id: 'retained-data-credential-ui', argvRedacted: ['explicit-api35-serial', 'baseline-safe-ui', 'fixed-public-query-unique-visible-p1', 'verified-download-ui', 'offline-data-preserving-process-stop', 'restore-original-network', 'resume-safe-ui'], startedAt: observations.startedAt, endedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', exitCode: passed ? 0 : 4, evidenceKinds: ['INSTRUMENTATION', 'API35_E2E', 'CREDENTIAL_LIVE'] },
    outcome: passed ? 'PASS' : 'NOT_VERIFIED', requirements: Object.keys(CREDENTIAL_GAPS), metrics: [],
    artifacts: artifactPaths.map(path => { const file = pathWithinRun(run, path); return { kind: path.endsWith('observations.json') ? 'credential-observations' : path.endsWith('scenario-manifest.json') ? 'credential-scenario-manifest' : 'candidate-seal-reference', relativePath: path, sha256: sha256(file), bytes: readFileSync(file).length, sanitized: true }; }),
    uncovered: [
      { requirement: 'AUTH-002', reasonCode: 'CREDENTIAL_QR_LIFECYCLE_PARTIAL', safeDetail: `authenticatedAndRetained=${results.accountRetained}; expiry, cancellation and retry transitions are not exercised after the single user login.`, ownerAction: 'Use isolated pre-configuration fixture proof; retain this authenticated session.' },
      { requirement: 'AI-001', reasonCode: 'CREDENTIAL_DELETE_NOT_EXERCISED', safeDetail: `configurationRetained=${results.configurationRetained};connection=${results.connection}; live key deletion is deliberately not exercised.`, ownerAction: 'Retain the configured vault; use isolated deletion contracts and report remaining device coverage.' },
      { requirement: 'AI-003', reasonCode: 'CREDENTIAL_TRANSLATION_VALIDATION_PARTIAL', safeDetail: `translationUi=${results.translationUi}; visible fresh completion is not independent proof of all cache alignment, revision or secret-leakage cases.`, ownerAction: 'Combine bounded contract/security proof without exporting lyrics, responses or credentials.' },
      {requirement:'PLAY-001',reasonCode:CREDENTIAL_GAPS['PLAY-001'],safeDetail:`authenticatedPlayback=${results.authenticatedPlayback}; visible P1 and numeric progress do not independently bind expected CID or prove premium rendition.`,ownerAction:'Retain honest partial observations; do not infer exact identity or account entitlement from titles.'},
      {requirement:'CACHE-001',reasonCode:CREDENTIAL_GAPS['CACHE-001'],safeDetail:`downloadReady=${results.downloadReady}; ready and checked UI is observed, not an independent native file integrity audit.`,ownerAction:'Combine existing atomic/hash contracts while retaining exact identity coverage limits.'},
      {requirement:'CACHE-002',reasonCode:CREDENTIAL_GAPS['CACHE-002'],safeDetail:`offlineRestart=${results.offlineRestart}; same exact CID, partial repair and full recovery lifecycle remain unproven.`,ownerAction:'Preserve the configured vault and downloaded content; do not clear or delete them for coverage.'},
    ],
    recovery: { cleanupStatus: observations.network?.restoreStatus === 'RESTORED' ? 'restored' : observations.network?.restoreStatus === 'RESTORE_FAILED' ? 'restore-failed' : 'not-required', deviceStateRestored: observations.network?.restoreStatus !== 'RESTORE_FAILED', rollbackArtifactSha256: build.build.sha256, steps: ['retained installed APK and encrypted configuration', 'original wifi and mobile-data states restored after bounded offline probe; no destructive data operations', 'no screenshots, UI dumps, account identity or model response exported'] },
  };
  assertRecord(record, run);
  writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return record;
}
