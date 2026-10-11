#!/usr/bin/env node
// Source reachability is provenance, never proof of a device or live behavior.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRecord, pathWithinRun, runRootFor, sha256 } from './evidence.mjs';
import { verify as verifyCandidate } from './candidate.mjs';
import { assertCredentialObservations, credentialResults, CREDENTIAL_MANIFEST, CREDENTIAL_GAPS } from './credential-evidence.mjs';

const REPO = resolve(import.meta.dirname, '../../..');
const PHASE = '.planning/phases/08-integrated-api-35-acceptance-release-like-evidence';
const IDS = 'PERF-001 PERF-002 PERF-003 UI-001 UI-002 UI-003 NET-001 NET-002 NET-003 NET-004 SRCH-001 SRCH-002 SRCH-003 PLAY-001 PLAY-002 PLAY-003 PLAY-004 PLAY-005 PLAY-006 LYR-001 LYR-002 LYR-003 LIB-001 LIB-002 LIB-003 AUTH-001 AUTH-002 AUTH-003 LOCAL-001 LOCAL-002 LOCAL-003 DATA-001 DATA-002 DATA-003 HIST-001 HIST-002 HIST-003 CACHE-001 CACHE-002 CACHE-003 CACHE-004 FX-001 FX-002 FX-003 AI-001 AI-002 AI-003 SEC-001 SEC-002 SEC-003 SEC-004 TEST-001 TEST-002 TEST-003 TEST-004 REL-001 REL-002 REL-003'.split(' ');
const KINDS = new Set('SOURCE_CONTRACT CURRENT_HEAD_REACHABILITY INSTRUMENTATION API35_E2E API35_ACCESSIBILITY LIVE_PUBLIC_PROVIDER CREDENTIAL_LIVE SYSTEM_MEDIA PERFORMANCE RECOVERY_SOAK APK_SECURITY REPRO_BUILD FINAL_INDEX'.split(' '));
const FILES = ['08-prerequisites.json', '08-build.json', '08-journey.json', '08-api35-performance.json', '08-performance.json', '08-live-provider.json', '08-reproducibility.json'];
const OUTCOMES = ['FAIL', 'BLOCKED', 'NOT_VERIFIED', 'DEGRADED', 'PASS'];
const DEVICE_KINDS = new Set('INSTRUMENTATION API35_E2E API35_ACCESSIBILITY LIVE_PUBLIC_PROVIDER CREDENTIAL_LIVE SYSTEM_MEDIA PERFORMANCE RECOVERY_SOAK'.split(' '));
const BUDGETS = { ttid: 3000, ttfd: 4000, 'first-search': 5000, 'first-audio': 6000 };
const reject = code => { const error = new Error(code); error.code = code; throw error; };
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const BLOB_CACHE = new Map();
const ANCESTOR_CACHE = new Set();
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const reduceStatus = values => OUTCOMES.find(status => values.includes(status)) || 'NOT_VERIFIED';
function exactIds(ids, code) {
  if (ids.length !== 58 || new Set(ids).size !== 58 || IDS.some(id => !ids.includes(id))) reject(code);
}
export function parseRequirements(text) {
  const rows = [...text.matchAll(/^\s*- \[[ xX]\] \*\*([A-Z]+-\d{3})\*\*\s*(.*)$/gm)].map(m => ({ id: m[1], behavior: m[2] }));
  exactIds(rows.map(row => row.id), 'REQUIREMENT_IDS_INVALID'); return rows;
}
export function parseMap(text, ids = IDS) {
  const rows = [...text.matchAll(/^\|\s*\d+\s*\|\s*([A-Z]+-\d{3})\s*\|\s*([^|]+)\|\s*$/gm)].map(m => ({ id: m[1], kinds: m[2].split(',').map(k => k.trim()) }));
  exactIds(rows.map(row => row.id), 'EVIDENCE_MAP_IDS_INVALID');
  if (ids.some(id => !rows.some(row => row.id === id))) reject('EVIDENCE_MAP_MISMATCH');
  for (const row of rows) if (!row.kinds.length || new Set(row.kinds).size !== row.kinds.length || row.kinds.some(kind => !KINDS.has(kind)) || !row.kinds.includes('CURRENT_HEAD_REACHABILITY')) reject('EVIDENCE_MAP_KINDS_INVALID');
  return rows;
}
function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..') && !/[\0\r\n]/.test(path);
}
export function implementation(repo, head, paths, recorded) {
  if (!Array.isArray(paths) || paths.some(path => !safePath(path)) || new Set(paths).size !== paths.length) reject('IMPLEMENTATION_PATH_INVALID');
  const hashes = paths.map(path => {
    const key = `${repo}:${head}:${path}`;
    if (BLOB_CACHE.has(key)) return BLOB_CACHE.get(key);
    let mode;
    try { mode = git(repo, 'ls-tree', head, '--', path).split(/\s/)[0]; } catch { reject('IMPLEMENTATION_PATH_MISSING'); }
    if (!['100644', '100755'].includes(mode)) reject('IMPLEMENTATION_PATH_MISSING');
    const bytes = execFileSync('git', ['show', `${head}:${path}`], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
    const hash = hashBytes(bytes); BLOB_CACHE.set(key, hash); return hash;
  });
  const commit = recorded?.implementationCommit || head;
  const ancestorKey = `${repo}:${commit}:${head}`;
  if (!ANCESTOR_CACHE.has(ancestorKey)) {
    try { git(repo, 'merge-base', '--is-ancestor', commit, head); } catch { reject('IMPLEMENTATION_COMMIT_NOT_ANCESTOR'); }
    ANCESTOR_CACHE.add(ancestorKey);
  }
  if (recorded && (JSON.stringify(recorded.implementationPaths) !== JSON.stringify(paths) || JSON.stringify(recorded.implementationBlobSha256) !== JSON.stringify(hashes))) reject('IMPLEMENTATION_BLOB_MISMATCH');
  return { implementationCommit: commit, implementationPaths: paths, implementationBlobSha256: hashes };
}
export function checkMetrics(record) {
  const seen = new Set();
  for (const metric of record.metrics) {
    if (typeof metric.name !== 'string' || seen.has(metric.name)) reject('PERFORMANCE_METRIC_DUPLICATE');
    seen.add(metric.name);
    const familyName = metric.name.replace(/^api(?:26|35|36)-/, '');
    if (!Object.hasOwn(BUDGETS, familyName)) continue;
    const rows = metric.samples;
    if (!Array.isArray(rows) || rows.length !== 20 || new Set(rows.map(row => row.id)).size !== 20 || rows.some(row => typeof row.id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(row.id) || !['PASS', 'FAIL', 'BLOCKED', 'DEGRADED', 'NOT_VERIFIED', 'TIMEOUT', 'CANCELLED'].includes(row.status) || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0)) reject('PERFORMANCE_SAMPLES_INVALID');
    const values = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
    if (metric.budget !== BUDGETS[familyName] || metric.p50 !== values[9] || metric.p95 !== values[18] || metric.max !== values[19]) reject('PERFORMANCE_SUMMARY_MISMATCH');
    const pass = rows.every(row => row.status === 'PASS') && metric.p95 <= metric.budget;
    if (metric.status === 'PASS' && !pass || !OUTCOMES.includes(metric.status)) reject('PERFORMANCE_FALSE_PASS');
  }
  if ((record.command.evidenceKinds || []).includes('PERFORMANCE')) {
    const matrix = record.recordId === 'phase8-performance-matrix';
    const expected = matrix ? [26, 35, 36].flatMap(api => [`api${api}-ttid`, `api${api}-ttfd`]) : Object.keys(BUDGETS);
    if (matrix && (record.command.evidenceKinds.length !== 1 || record.command.evidenceKinds[0] !== 'PERFORMANCE' || record.requirements.some(id => !['PERF-001', 'TEST-004'].includes(id)))) reject('PERFORMANCE_MATRIX_SCOPE_INVALID');
    if (expected.some(name => !seen.has(name)) || matrix && seen.size !== expected.length) reject('PERFORMANCE_FAMILY_MISSING');
    if (record.outcome === 'PASS' && record.metrics.some(metric => metric.status !== 'PASS')) reject('PERFORMANCE_FALSE_PASS');
  }
}
function noSymlinks(root, target) {
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) reject('OUTPUT_PATH_ESCAPE');
  let probe = root;
  if (lstatSync(root).isSymbolicLink()) reject('SYMLINK_REJECTED');
  for (const piece of rel.split(sep).filter(Boolean)) {
    probe = resolve(probe, piece);
    if (existsSync(probe) && lstatSync(probe).isSymbolicLink()) reject('SYMLINK_REJECTED');
  }
}
export function loadRecords(run, head) {
  const records = [];
  const credentialFiles = readdirSync(run).filter(name => name.startsWith('08-credential-live-') && name.endsWith('.json'));
  if (credentialFiles.length > 32 || credentialFiles.some(name => !/^08-credential-live-0(?:0[1-9]|[12][0-9]|3[0-2])\.json$/.test(name))) reject('CREDENTIAL_RECORD_NAME_INVALID');
  for (const file of [...FILES, ...credentialFiles.sort()]) {
    if (!existsSync(resolve(run, file))) continue;
    let record; try { record = JSON.parse(readFileSync(pathWithinRun(run, file), 'utf8')); } catch { reject('RECORD_JSON_INVALID'); }
    try { assertRecord(record, run); } catch { reject('RECORD_SCHEMA_OR_ARTIFACT_INVALID'); }
    if (record.git.sha !== head) reject('RECORD_HEAD_MISMATCH');
    if (!Number.isFinite(Date.parse(record.command.startedAt)) || !Number.isFinite(Date.parse(record.command.endedAt)) || !Number.isInteger(record.command.exitCode)) reject('COMMAND_COMPLETION_INVALID');
    if (record.outcome === 'PASS' && record.command.exitCode !== 0) reject('COMMAND_FALSE_PASS');
    const kinds = record.command.evidenceKinds || [];
    if (!Array.isArray(kinds) || new Set(kinds).size !== kinds.length || kinds.some(k => !KINDS.has(k) || ['CURRENT_HEAD_REACHABILITY', 'FINAL_INDEX'].includes(k))) reject('RECORD_EVIDENCE_KINDS_INVALID');
    if (kinds.length && !record.artifacts.length) reject('EVIDENCE_ARTIFACT_MISSING');
    if (kinds.includes('CREDENTIAL_LIVE') && record.outcome === 'PASS' && !['authorized-in-app', 'credential-authorized'].includes(record.fixture.accountLane)) reject('CREDENTIAL_LANE_MISSING');
    if (kinds.some(k => DEVICE_KINDS.has(k)) && record.outcome === 'PASS' && (record.recovery.deviceStateRestored !== true || !(record.recordId === 'phase8-performance-matrix' || /^phase8-credential-live-0(?:0[1-9]|[12][0-9]|3[0-2])$/.test(record.recordId) ? ['restored', 'not-required'] : ['restored']).includes(record.recovery.cleanupStatus))) reject('CLEANUP_FALSE_PASS');
    if (kinds.some(k => k.startsWith('API35_')) && record.device.apiLevel !== 35) reject('API35_DEVICE_MISMATCH');
    checkMetrics(record);
    records.push({ file, sha256: sha256(resolve(run, file)), record });
  }
  if (new Set(records.map(item => item.record.recordId)).size !== records.length) reject('RECORD_ID_DUPLICATE');
  return records;
}
export function evaluate({ repo, run, head, requirementsText, mapText, anchors, records, candidateVerified = false, reproducibilityVerified = false }) {
  const requirements = parseRequirements(requirementsText); const map = parseMap(mapText);
  if (!Array.isArray(anchors)) reject('ANCHORS_INVALID'); exactIds(anchors.map(row => row.id), 'ANCHOR_IDS_INVALID');
  for (const row of anchors) if (Object.keys(row).sort().join(',') !== 'id,paths') reject('ANCHOR_FIELDS_INVALID');
  const buildEntry = records.find(item => item.file === '08-build.json'); const build = buildEntry?.record.build || null;
  const test = buildEntry?.record.artifacts.find(a => a.kind === 'release-like-android-test-apk');
  const fixtures = new Map(); const devices = new Set();
  for (const { file, record } of records) {
    if (file === '08-prerequisites.json' || file === '08-build.json' || file === '08-reproducibility.json') continue;
    if (build && record.build.sha256 !== build.sha256) reject('CANDIDATE_SHA_MISMATCH');
    if (record.build.testPayloadSha256 && test && record.build.testPayloadSha256 !== test.sha256) reject('TEST_PAYLOAD_SHA_MISMATCH');
    const kinds = record.command.evidenceKinds || [];
    if (kinds.some(k => DEVICE_KINDS.has(k))) {
      if (build && (!test || record.build.testPayloadSha256 !== test.sha256)) reject('TEST_PAYLOAD_SHA_MISSING');
      const fixture = record.fixture;
      if (typeof fixture.id !== 'string' || typeof fixture.revision !== 'string' || !/^[a-f0-9]{64}$/.test(fixture.manifestSha256) || !/^[a-f0-9]{64}$/.test(fixture.generatedMediaSha256)) reject('FIXTURE_HASH_INVALID');
      if (/^08-credential-live-/.test(file)) {
        const suffix = file.match(/(\d{3})\.json$/)[1];
        if (record.recordId !== `phase8-credential-live-${suffix}` || record.network.mode !== 'retained-data-visible-credential-ui' || fixture.id !== 'phase08-credential-live' || fixture.revision !== '1' || !/^0+$/.test(fixture.generatedMediaSha256) || !['authorized-in-app', 'none'].includes(fixture.accountLane) || record.requirements.slice().sort().join(',') !== 'AI-001,AI-003,AUTH-002' || kinds.slice().sort().join(',') !== 'API35_E2E,CREDENTIAL_LIVE,INSTRUMENTATION') reject('CREDENTIAL_LANE_SCOPE_INVALID');
        const manifestFile = pathWithinRun(run, `credential/attempt-${suffix}/scenario-manifest.json`), observationFile = pathWithinRun(run, `credential/attempt-${suffix}/observations.json`);
        if (fixture.manifestSha256 !== sha256(manifestFile) || !record.artifacts.some(a => a.relativePath === `credential/attempt-${suffix}/scenario-manifest.json` && a.sha256 === fixture.manifestSha256) || !record.artifacts.some(a => a.relativePath === `credential/attempt-${suffix}/observations.json` && a.sha256 === sha256(observationFile)) || JSON.stringify(JSON.parse(readFileSync(manifestFile, 'utf8'))) !== JSON.stringify(CREDENTIAL_MANIFEST)) reject('CREDENTIAL_MANIFEST_INVALID');
        const observations = JSON.parse(readFileSync(observationFile, 'utf8')); assertCredentialObservations(observations);
        if (Object.entries(CREDENTIAL_GAPS).some(([id, code]) => !record.uncovered.some(item => item.requirement === id && item.reasonCode === code))) reject('CREDENTIAL_LIFECYCLE_GAP_REMOVED');
        if (record.device.serialHash !== observations.serialHash || record.outcome === 'PASS' && Object.values(credentialResults(observations)).some(status => status !== 'PASS')) reject('CREDENTIAL_FALSE_PASS');
        if (!buildEntry || !record.artifacts.some(a => a.relativePath === '08-build.json' && a.sha256 === buildEntry.sha256) || !record.artifacts.some(a => a.relativePath === '08-build.sha256' && a.sha256 === sha256(pathWithinRun(run, '08-build.sha256')))) reject('CREDENTIAL_BUILD_SEAL_UNLINKED');
      } else if (fixture.id === 'none') {
        const coldMatrix = record.recordId === 'phase8-performance-matrix' && kinds.length === 1 && kinds[0] === 'PERFORMANCE';
        const livePublic = /^phase8-live-(?:provider|bilibili)-smoke$/.test(record.recordId) && record.network.mode === 'production-routes-fixture-free' && kinds.every(k => ['INSTRUMENTATION', 'LIVE_PUBLIC_PROVIDER', 'SYSTEM_MEDIA'].includes(k)) && kinds.includes('LIVE_PUBLIC_PROVIDER');
        if (!coldMatrix && !livePublic) reject('FIXTURE_FREE_SCOPE_INVALID');
        if (fixture.revision !== '0' || fixture.accountLane !== 'none' || !Array.isArray(fixture.queryIds) || coldMatrix && fixture.queryIds.length || livePublic && (!fixture.queryIds.length || fixture.queryIds.length > 20 || fixture.queryIds.some(id => typeof id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(id)))) reject('FIXTURE_FREE_PROVENANCE_INVALID');
        if (!/^0+$/.test(fixture.manifestSha256) || !/^0+$/.test(fixture.generatedMediaSha256)) reject('FIXTURE_FREE_PROVENANCE_INVALID');
      } else {
        const artifactHashes = record.artifacts.map(a => a.sha256);
        if (!artifactHashes.includes(fixture.manifestSha256) || !artifactHashes.includes(fixture.generatedMediaSha256)) reject('FIXTURE_ARTIFACT_UNLINKED');
        const key = `${fixture.id}:${fixture.revision}`, hashes = `${fixture.manifestSha256}:${fixture.generatedMediaSha256}`;
        if (fixtures.has(key) && fixtures.get(key) !== hashes) reject('FIXTURE_HASH_MISMATCH'); fixtures.set(key, hashes);
      }
      if (record.device.apiLevel === 35) { if (!/^[a-f0-9]{64}$/.test(record.device.serialHash)) reject('DEVICE_IDENTITY_INVALID'); devices.add(record.device.serialHash); }
    }
  }
  if (devices.size > 1) reject('DEVICE_IDENTITY_MISMATCH');
  const api35 = records.find(item => item.file === '08-api35-performance.json');
  const compatibility = records.find(item => item.file === '08-performance.json');
  if (api35 && compatibility && !compatibility.record.artifacts.some(a => a.relativePath === api35.file && a.sha256 === api35.sha256)) reject('API35_SEALED_INPUT_UNLINKED');
  const repro = records.find(item => item.file === '08-reproducibility.json');
  let reproducible = false;
  if (repro) {
    if (!buildEntry || repro.record.build.sha256 !== build.sha256) reject('REPRO_CANDIDATE_MISMATCH');
    const refs = repro.record.artifacts;
    if (!refs.some(a => a.relativePath === '08-build.json' && a.sha256 === buildEntry.sha256) || !refs.some(a => a.relativePath === '08-build.sha256' && a.sha256 === sha256(pathWithinRun(run, '08-build.sha256')))) reject('REPRO_BUILD_SEAL_UNLINKED');
    const first = refs.filter(a => a.kind === 'repro-build-one-apk');
    const second = refs.filter(a => a.kind === 'repro-build-two-apk');
    if (first.length > 1 || second.length > 1 || repro.record.outcome === 'PASS' && (first.length !== 1 || second.length !== 1 || first[0].relativePath === second[0].relativePath)) reject('REPRO_ARTIFACTS_INVALID');
    reproducible = candidateVerified && reproducibilityVerified && repro.record.outcome === 'PASS';
  }
  const globalReasons = [];
  for (const file of FILES) if (!records.some(item => item.file === file)) globalReasons.push(`MISSING_${file.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`);
  if (!candidateVerified) globalReasons.push('CANDIDATE_SIGNATURE_NOT_VERIFIED');
  for (const { record } of records) {
    const sealedBuildSatisfied = record === buildEntry?.record && candidateVerified && reproducible;
    if (record.outcome !== 'PASS' && !sealedBuildSatisfied) globalReasons.push(`RECORD_${record.recordId}_${record.outcome}`);
    if (record.uncovered.some(item => !(sealedBuildSatisfied && item.reasonCode === 'REPRODUCIBILITY_PENDING'))) globalReasons.push(`RECORD_${record.recordId}_UNCOVERED`);
    if (record.recovery.deviceStateRestored !== true || !['restored', 'not-required'].includes(record.recovery.cleanupStatus)) globalReasons.push(`RECORD_${record.recordId}_CLEANUP_INCOMPLETE`);
  }
  const rows = requirements.map(req => {
    const paths = anchors.find(a => a.id === req.id).paths;
    const reachability = implementation(repo, head, paths);
    const matched = records.filter(({ record }) => record.requirements.includes(req.id));
    const gaps = [];
    const kinds = map.find(row => row.id === req.id).kinds.map(kind => {
      if (kind === 'CURRENT_HEAD_REACHABILITY') { if (!paths.length) gaps.push('IMPLEMENTATION_ANCHOR_UNRESOLVED'); return { kind, status: paths.length ? 'PASS' : 'NOT_VERIFIED', recordIds: [] }; }
      if (kind === 'FINAL_INDEX') { if (globalReasons.length) gaps.push('FINAL_INDEX_GATES_INCOMPLETE'); return { kind, status: globalReasons.length ? 'NOT_VERIFIED' : 'PASS', recordIds: [] }; }
      let providers = matched.filter(({ file, record }) => (record.command.evidenceKinds || []).includes(kind) && (kind !== 'REPRO_BUILD' || file === '08-reproducibility.json'));
      if (kind === 'PERFORMANCE' && req.id === 'PERF-001' && providers.some(item => item.record.recordId === 'phase8-performance-matrix')) providers = providers.filter(item => item.record.recordId === 'phase8-performance-matrix');
      const specificStatus = ({ record }) => {
        if (kind === 'REPRO_BUILD') return reproducible ? 'PASS' : (record.outcome === 'PASS' ? 'NOT_VERIFIED' : record.outcome);
        if (kind !== 'PERFORMANCE' || !['PASS', 'NOT_VERIFIED'].includes(record.outcome)) return record.outcome;
        const names = req.id === 'PERF-001' ? ['api26-ttid', 'api26-ttfd', 'api36-ttid', 'api36-ttfd'] : req.id === 'PERF-002' ? ['first-search', 'first-audio'] : [];
        if (!names.length) return record.outcome;
        return names.every(name => record.metrics.some(m => m.name === name && m.status === 'PASS')) ? 'PASS' : 'NOT_VERIFIED';
      };
      let status = providers.length ? reduceStatus(providers.map(specificStatus)) : 'NOT_VERIFIED';
      if (['APK_SECURITY', 'REPRO_BUILD'].includes(kind) && !candidateVerified) status = 'NOT_VERIFIED';
      if (!providers.length) gaps.push(kind === 'CREDENTIAL_LIVE' ? 'CREDENTIAL_LIVE_NOT_VERIFIED' : `MISSING_${kind}`);
      for (const { record } of providers) if (record.uncovered.some(item => item.requirement === req.id && !(kind === 'PERFORMANCE' && specificStatus({ record }) === 'PASS' && item.reasonCode === 'PERFORMANCE_OR_CONTINUITY_NON_PASS'))) { if (status === 'PASS') status = 'NOT_VERIFIED'; gaps.push('UNCOVERED_BEHAVIOR'); }
      return { kind, status, recordIds: providers.map(item => item.record.recordId) };
    });
    return { id: req.id, behavior: req.behavior, ...reachability, requiredEvidenceKinds: kinds, evidenceRecordIds: [...new Set(kinds.flatMap(k => k.recordIds))], artifactSha256: [...new Set(matched.flatMap(item => item.record.artifacts.map(a => a.sha256)))], status: reduceStatus(kinds.map(k => k.status)), uncoveredReasonCodes: gaps, recoveryAction: 'Supply current-run proof for each missing or non-pass kind; retain prior evidence and obtain authorized credentials only through visible app entry.' };
  });
  const parityVerdict = rows.every(row => row.status === 'PASS') && !globalReasons.length ? 'PARITY_READY' : 'NOT_PARITY_READY';
  const model = { schemaVersion: 1, runId: basename(run), recordedAt: new Date().toISOString(), git: { sha: head }, build, testPayloadSha256: test?.sha256 || null, records: records.map(({ file, sha256: hash, record }) => ({ relativePath: file, sha256: hash, recordId: record.recordId, outcome: record.outcome, evidenceKinds: record.command.evidenceKinds || [], requirements: record.requirements })), requirements: rows, parityVerdict, gateReasonCodes: globalReasons, developmentSigned: true, releaseAuthority: false };
  assertIndex(model); return model;
}
export function assertIndex(model) {
  const keys = ['schemaVersion', 'runId', 'recordedAt', 'git', 'build', 'testPayloadSha256', 'records', 'requirements', 'parityVerdict', 'gateReasonCodes', 'developmentSigned', 'releaseAuthority'];
  if (!model || Object.keys(model).sort().join(',') !== keys.sort().join(',') || model.schemaVersion !== 1 || !/^phase08-\d{8}T\d{6}Z-[a-f0-9]{12}$/.test(model.runId) || !/^[a-f0-9]{40}$/.test(model.git.sha) || model.developmentSigned !== true || model.releaseAuthority !== false) reject('INDEX_SCHEMA_INVALID');
  exactIds(model.requirements.map(row => row.id), 'INDEX_REQUIREMENT_IDS_INVALID');
  if (!['PARITY_READY', 'NOT_PARITY_READY'].includes(model.parityVerdict) || model.requirements.some(row => !OUTCOMES.includes(row.status))) reject('INDEX_STATUS_INVALID');
  if (model.parityVerdict === 'PARITY_READY' && (model.gateReasonCodes.length || model.requirements.some(row => row.status !== 'PASS'))) reject('INDEX_FALSE_PARITY');
}
export function markdown(model) {
  const build = model.build;
  const lines = ['# Phase 8 Android acceptance', '', `Parity verdict: **${model.parityVerdict}**`, '', `Run: \`${model.runId}\`; exact HEAD: \`${model.git.sha}\`.`, '', 'This is a development-signed evaluation candidate. Formal signing, store readiness, merge, publication and deployment are not authorized.', '', `Index: \`${PHASE}/evidence/${model.runId}/08-evidence-index.json\`.`, ''];
  if (build) lines.push(`Candidate: \`${PHASE}/evidence/${model.runId}/${build.apkRelativePath}\`.`, `Handoff: \`dist/android/Listen2-2.34.0-android-release-like-development-signed.apk\` (usable only after independently matching these exact bytes).`, `SHA-256: \`${build.sha256}\`; bytes: ${build.bytes}; signer SHA-256: \`${build.signerSha256}\`.`, `Package: \`${build.applicationId}\`; version: \`${build.versionName}\` (${build.versionCode}); test payload: \`${model.testPayloadSha256}\`.`, '', 'Verify the handoff copy:', '', '```sh', `bash mobile/scripts/acceptance/install-verified-apk.sh --verify-only --index ${PHASE}/evidence/${model.runId}/08-evidence-index.json --apk dist/android/Listen2-2.34.0-android-release-like-development-signed.apk`, '```', '', 'After making a semantic library backup, use an explicit device serial:', '', '```sh', `bash mobile/scripts/acceptance/install-verified-apk.sh --serial YOUR_DEVICE_SERIAL --ack-backup --ack-rollback --index ${PHASE}/evidence/${model.runId}/08-evidence-index.json --apk dist/android/Listen2-2.34.0-android-release-like-development-signed.apk`, '```', '');
  lines.push('Replacement uses `adb -s SERIAL install -r APK` and preserves app data when Android accepts the same signer/package/version lineage. Uninstall deletes private app data. Preserve the prior verified APK and its index before replacement; rollback requires its matching signer and a version Android accepts, and must be verified with its own index. A downgrade is never forced. If replacement cannot be reversed without uninstall, stop and restore the semantic library backup through the application after an explicitly authorized reinstall. Credentials and SAF grants are outside the semantic backup.', '', '| Requirement | Status | Missing or uncovered evidence |', '|---|---|---|');
  for (const row of model.requirements) lines.push(`| ${row.id} | ${row.status} | ${row.uncoveredReasonCodes.join(', ') || row.requiredEvidenceKinds.filter(k => k.status !== 'PASS').map(k => `${k.kind}:${k.status}`).join(', ') || 'none'} |`);
  lines.push('', 'Gate limitations:', ...model.gateReasonCodes.map(code => `- ${code}`), '', 'Record outcomes:', ...model.records.map(row => `- ${row.recordId}: ${row.outcome}; ${row.relativePath}; SHA-256 ${row.sha256}`), '', 'Reproducibility independently compares ZIP metadata (including timestamps), ordered entry content, stripped APK payload and verified signer identity against the sealed candidate. Only signing-block differences accepted by the checked-in comparator are allowed; raw SHA-256 values remain individually indexed. The JSON index and this report are rendered from the same validated model. Source anchors alone do not prove runtime behavior. Existing non-pass and credential gaps are retained.', '');
  return lines.join('\n');
}
function atomicWrite(file, text) {
  const temporary = resolve(dirname(file), `.${basename(file)}.${randomBytes(8).toString('hex')}.tmp`);
  writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
  try { renameSync(temporary, file); } finally { rmSync(temporary, { force: true }); }
}
function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (Object.hasOwn(result, key)) reject('ARGUMENT_DUPLICATE');
    if (key === '--self-test-58-current-head') result[key] = true;
    else { if (!['--run-dir', '--requirements', '--evidence-map', '--report', '--apksigner'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) reject('ARGUMENT_INVALID'); result[key] = args[++i]; }
  }
  return result;
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['--self-test-58-current-head']) { if (Object.keys(args).length !== 1) reject('ARGUMENT_INVALID'); execFileSync(process.execPath, ['--test', fileURLToPath(new URL('./finalize-evidence.test.mjs', import.meta.url))], { stdio: 'inherit' }); return; }
  let run;
  try {
    if (!args['--run-dir']) reject('RUN_REQUIRED');
    run = runRootFor(resolve(args['--run-dir'])); noSymlinks(resolve(REPO, PHASE, 'evidence'), resolve(args['--run-dir']));
    const head = git(REPO, 'rev-parse', 'HEAD'); if (!basename(run).endsWith(`-${head.slice(0, 12)}`)) reject('RUN_HEAD_MISMATCH');
    const report = resolve(args['--report'] || resolve(REPO, PHASE, '08-ACCEPTANCE.md'));
    if (report !== resolve(REPO, PHASE, '08-ACCEPTANCE.md')) reject('REPORT_PATH_INVALID'); noSymlinks(resolve(REPO, PHASE), report);
    const index = resolve(run, '08-evidence-index.json'); noSymlinks(run, index);
    if (existsSync(index) || existsSync(resolve(run, '08-finalizer-failure.json'))) reject('FINALIZATION_ALREADY_EXISTS');
    const requirements = resolve(args['--requirements'] || resolve(REPO, '.planning/REQUIREMENTS.md'));
    const map = resolve(args['--evidence-map'] || resolve(REPO, PHASE, '08-REQUIREMENT-EVIDENCE-MAP.md'));
    if (requirements !== resolve(REPO, '.planning/REQUIREMENTS.md') || map !== resolve(REPO, PHASE, '08-REQUIREMENT-EVIDENCE-MAP.md')) reject('INPUT_PATH_INVALID');
    const records = loadRecords(run, head); let candidateVerified = false; let reproducibilityVerified = false; let signer;
    if (records.some(item => item.file === '08-build.json')) {
      const seal = pathWithinRun(run, '08-build.sha256');
      if (readFileSync(seal, 'utf8').trim() !== sha256(pathWithinRun(run, '08-build.json'))) reject('BUILD_SEAL_MISMATCH');
      const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
      signer = args['--apksigner'] || (sdk && resolve(sdk, 'build-tools/37.0.0/apksigner'));
      if (signer && existsSync(signer)) { try { verifyCandidate(run, head, signer); candidateVerified = true; } catch { reject('CANDIDATE_SEAL_OR_SIGNATURE_INVALID'); } }
    }
    const repro = records.find(item => item.file === '08-reproducibility.json');
    if (candidateVerified && repro?.record.outcome === 'PASS') {
      const original = pathWithinRun(run, records.find(item => item.file === '08-build.json').record.build.apkRelativePath);
      const copies = ['repro-build-one-apk', 'repro-build-two-apk'].map(kind => {
        const items = repro.record.artifacts.filter(a => a.kind === kind); if (items.length !== 1) reject('REPRO_ARTIFACTS_INVALID'); return pathWithinRun(run, items[0].relativePath);
      });
      try {
        for (const copy of copies) execFileSync('bash', ['-c', 'source "$1"; phase8_compare_apks "$2" "$3" "$4" repro-independent', 'phase08-repro', resolve(import.meta.dirname, 'reproducibility-gate.sh'), original, copy, signer], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
        reproducibilityVerified = true;
      } catch { reject('REPRO_INDEPENDENT_COMPARISON_FAILED'); }
    }
    const model = evaluate({ repo: REPO, run, head, requirementsText: readFileSync(requirements, 'utf8'), mapText: readFileSync(map, 'utf8'), anchors: JSON.parse(readFileSync(new URL('./implementation-anchors.json', import.meta.url), 'utf8')), records, candidateVerified, reproducibilityVerified });
    // Validate both destinations first. No input evidence or candidate bytes are rewritten.
    atomicWrite(report, markdown(model)); atomicWrite(index, `${JSON.stringify(model, null, 2)}\n`);
    console.log(`${model.parityVerdict}: ${model.requirements.filter(row => row.status === 'PASS').length}/58 PASS`);
  } catch (error) {
    if (run && !existsSync(resolve(run, '08-evidence-index.json'))) {
      const failure = resolve(run, '08-finalizer-failure.json'); noSymlinks(run, failure);
      if (!existsSync(failure)) atomicWrite(failure, `${JSON.stringify({ schemaVersion: 1, outcome: 'FAIL', reasonCode: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'FINALIZATION_INPUT_INVALID' })}\n`);
    }
    throw error;
  }
}
if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  try { main(); } catch { console.error('Finalization rejected; inspect the sanitized run-root failure record.'); process.exitCode = 3; }
}
