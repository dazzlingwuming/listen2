import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { summarizeFamily } from './summarize-performance.mjs';
import { runRootFor, writeRecord } from './evidence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const ids = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, '0'));
export function nativeSnapshot(raw, elapsedMs) {
  // Consume only the exact target package's section; never persist raw sessions.
  const sections = raw.split(/\bpackage=/u).slice(1);
  const target = sections.find(section => /^com\.dazzlingwuming\.listen2(?:\s|$)/u.test(section));
  const state = target?.match(/PlaybackState\s*\{\s*state=(\d+)/u)?.[1];
  const position = target?.match(/PlaybackState\s*\{[^\n]*?\bposition=(\d+)/u)?.[1];
  const metadata = target?.match(/metadata:\s*([^\n]+)/u)?.[1];
  return { status: state && position && metadata ? 'PASS' : 'NOT_VERIFIED', state: state ? Number(state) : null,
    positionMs: position ? Number(position) : null, identitySha256: metadata ? hash(metadata) : null,
    synthetic: Boolean(metadata?.includes('Listen2AcceptanceSignal')), elapsedMs };
}
export function liveFamilies(output, terminalDurationMs) {
  return [['first-search', 5000], ['first-audio', 6000]].map(([name, budget]) => {
    const found = [...output.matchAll(/phase08Metric=([a-z-]+)\|([0-9]{2})\|([A-Z_]+)\|([0-9]+)\|([a-z0-9-]+)/gu)].filter(match => match[1] === name);
    if (new Set(found.map(match => match[2])).size !== found.length || found.some(match => !ids.includes(match[2]))) throw new Error('duplicate or invalid live metric attempt ID');
    const samples = ids.map(id => {
      const row = found.find(match => match[2] === id);
      return row ? { id, status: row[3], elapsedMs: Number(row[4]), reasonCode: row[5], stage: name === 'first-search' ? 'visible-kugou-semantic-live-result' : 'visible-live-track-and-native-playing-position' }
        : { id, status: 'NOT_VERIFIED', elapsedMs: terminalDurationMs, reasonCode: 'instrumentation-ended-before-observation', stage: 'terminal-command-duration-only' };
    });
    return { name, unit: 'ms', samples, ...summarizeFamily(samples, budget) };
  });
}
export function coldFamilies(ledger) {
  const rows = ledger.trim().split('\n').filter(Boolean).map(line => line.split('|'));
  return [['ttid', 3000, 4, 'device-am-start-total-time'], ['ttfd', 4000, 6, 'device-monotonic-visible-upper-bound-including-uiautomator-observer']].map(([name, budget, index, stage]) => {
    const samples = rows.map(row => ({ id: row[0], status: row[1], elapsedMs: row[index] ? Number(row[index]) : Number(row[3]), stage: row[index] ? stage : 'terminal-command-duration-only', reasonCode: row[8] }));
    return { name, unit: 'ms', samples, ...summarizeFamily(samples, budget) };
  });
}
export function assessContinuity(rows, seconds = 600) {
  if (!rows.length || rows.some(row => row.status !== 'PASS' || row.state !== 3 || !row.synthetic)) return 'NOT_VERIFIED';
  if (rows.length < 61 || rows.at(-1).elapsedMs - rows[0].elapsedMs < seconds * 1000) return 'FAIL';
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1], row = rows[i];
    const elapsed = row.elapsedMs - previous.elapsedMs, advanced = row.positionMs - previous.positionMs;
    if (row.identitySha256 !== previous.identitySha256 || elapsed <= 0 || elapsed > 15000 || advanced <= 0 || Math.abs(advanced - elapsed) > 3000) return 'FAIL';
  }
  return 'PASS';
}
export function assessRecovery(before, after) {
  if ([before, after].some(row => row.status !== 'PASS' || !row.synthetic)) return 'NOT_VERIFIED';
  return before.identitySha256 === after.identitySha256 && Math.abs(after.positionMs - before.positionMs) <= 3000 ? 'PASS' : 'FAIL';
}
export function generateSignal(file) {
  const rate = 8000, seconds = 720, pcm = Buffer.alloc(rate * seconds * 2);
  for (let frame = 0; frame < rate * seconds; frame++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * frame / rate) * 1200), frame * 2);
  const title = Buffer.from('Listen2AcceptanceSignal\0');
  const info = Buffer.alloc(12 + title.length + title.length % 2); info.write('INFO', 0); info.write('INAM', 4); info.writeUInt32LE(title.length, 8); title.copy(info, 12);
  const list = Buffer.alloc(8); list.write('LIST'); list.writeUInt32LE(info.length, 4);
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + pcm.length + list.length + info.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([header, pcm, list, info]), { flag: 'wx', mode: 0o600 });
  return { sha256: hash(readFileSync(file)), bytes: statSync(file).size, seconds, source: 'generated-synthetic-pcm-with-fixed-title', copyrightedMedia: false };
}
export function writePerformanceRecord(run, startedAt, serialHash, liveDuration, cleanupStatus) {
  const build = JSON.parse(readFileSync(resolve(run, '08-build.json'), 'utf8'));
  const read = name => readFileSync(resolve(run, 'performance', name), 'utf8');
  const metrics = [...coldFamilies(read('api35-cold.tsv')), ...liveFamilies(read('api35-instrumentation.txt'), Number(liveDuration))];
  const recovery = JSON.parse(read('recovery.json'));
  const soak = JSON.parse(read('soak.json'));
  const network = JSON.parse(read('network.json'));
  const continuity = assessContinuity(soak);
  const recovered = recovery.length === 5 && recovery.every(row => row.resumeVerified === true && assessRecovery(row.before, row.after) === 'PASS');
  const networkPass = network.disabledConfirmed && network.enabledConfirmed && [network.before, network.offline, network.after].every(row => row?.status === 'PASS' && row.state === 3 && row.synthetic && row.identitySha256 === network.before?.identitySha256) && network.offline.positionMs > network.before.positionMs && network.after.positionMs > network.offline.positionMs;
  const measuredPass = metrics.every(metric => metric.status === 'PASS') && recovered && continuity === 'PASS' && networkPass && cleanupStatus === 'restored';
  const files = ['api35-cold.tsv', 'api35-instrumentation.txt', 'synthetic-media.json', 'listen2-performance-signal.wav', 'recovery.json', 'soak.json', 'network.json', 'continuity-status.json', 'resources-meminfo.txt'].filter(name => existsSync(resolve(run, 'performance', name)));
  const record = { ...build, recordId: 'api35-performance-sealed', recordedAt: new Date().toISOString(),
    device: { ...build.device, serialHash, apiLevel: 35 }, network: { mode: 'live-public-search-and-generated-local-continuity', transport: 'emulator', offlineWindows: ['recorded-wifi-off-window'], proxyConfigured: false },
    fixture: { ...build.fixture, id: 'phase08-performance-local', revision: '1', manifestSha256: hash(readFileSync(resolve(run, 'performance/synthetic-media.json'))), queryIds: ['qinghuaci-kugou-live'], generatedMediaSha256: JSON.parse(read('synthetic-media.json')).sha256 },
    command: { id: 'api35-performance-once', argvRedacted: ['explicit-api35-serial', '20-fixed-cold-live-search-live-audio-attempts', 'generated-local-saf', 'five-process-recovery', '600-second-native-position-soak'], startedAt, endedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', exitCode: measuredPass ? 0 : 4, evidenceKinds: ['PERFORMANCE', 'LIVE_PUBLIC_PROVIDER', 'RECOVERY_SOAK'] },
    requirements: ['PERF-001', 'PERF-002', 'PERF-003', 'TEST-004'], metrics, outcome: metrics.some(metric => metric.samples.some(sample => ['FAIL', 'TIMEOUT'].includes(sample.status)) || metric.samples.every(sample => sample.status === 'PASS') && metric.status === 'FAIL') || continuity === 'FAIL' ? 'FAIL' : 'NOT_VERIFIED',
    artifacts: files.map(name => { const file = resolve(run, 'performance', name); return { kind: name, relativePath: `performance/${name}`, sha256: hash(readFileSync(file)), bytes: statSync(file).size, sanitized: true }; }),
    uncovered: [{ requirement: 'PERF-001', reasonCode: 'COMPATIBILITY_MATRIX_PENDING', safeDetail: 'This record covers API35 measurements only; API26 and API36 device metrics are separate.', ownerAction: 'Consume separately sealed compatibility lanes before claiming PERF-001.' }, { requirement: 'PERF-002', reasonCode: 'LIVE_METRICS_REQUIRE_INDIVIDUAL_REVIEW', safeDetail: `liveSearch=${metrics[2].status};liveAudio=${metrics[3].status};bridgeNetworkMedia3Substages=NOT_VERIFIED`, ownerAction: 'Review actual terminal samples; no local fixture may replace a live sample.' }, { requirement: 'PERF-003', reasonCode: 'PERFORMANCE_OR_CONTINUITY_NON_PASS', safeDetail: `compatibilityMatrix=NOT_VERIFIED;providerNetworkRecovery=NOT_VERIFIED;duplicateMutationAndAnrCrash=NOT_VERIFIED;coldLiveMetricsPass=${metrics.every(metric => metric.status === 'PASS')};fiveRecoveryPass=${recovered};generatedPlaybackSoak=${continuity};networkLocalContinuityPass=${Boolean(networkPass)};cleanup=${cleanupStatus}`, ownerAction: 'Inspect immutable attempt and state evidence; fix the cause before a new candidate run. Local continuity does not establish provider network recovery.' }],
    recovery: { cleanupStatus, deviceStateRestored: cleanupStatus === 'restored', rollbackArtifactSha256: build.build.sha256, steps: ['original wifi setting restored', 'screen woken', 'retained immutable native position observations'] } };
  writeFileSync(resolve(run, '.api35-performance.json'), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
  return measuredPass;
}

export function writeCompatibilityRecord(run) {
  const read = name => readFileSync(resolve(run, name), 'utf8');
  const api35 = JSON.parse(read('08-api35-performance.json'));
  const build = JSON.parse(read('08-build.json'));
  const api35Metrics = api35.metrics.filter(metric => ['ttid', 'ttfd'].includes(metric.name));
  if (api35Metrics.length !== 2 || api35.git.sha !== build.git.sha || api35.runId !== build.runId || api35.build.sha256 !== build.build.sha256) throw new Error('API35 performance provenance is inconsistent');
  const metrics = [
    ...api35Metrics.map(metric => ({ ...metric, name: `api35-${metric.name}`, ...summarizeFamily(metric.samples, metric.budget) })),
    ...[26, 36].flatMap(api => coldFamilies(read(`performance/api${api}-cold.tsv`)).map(metric => ({ ...metric, name: `api${api}-${metric.name}` }))),
  ];
  const pass = metrics.every(metric => metric.status === 'PASS');
  const files = ['08-api35-performance.json', '08-build.json', '08-build.sha256', 'performance/api26-cold.tsv', 'performance/api36-cold.tsv'];
  const now = new Date().toISOString();
  const record = { ...build, recordId: 'phase8-performance-matrix', recordedAt: now, fixture: { id: 'none', revision: '0', manifestSha256: '0'.repeat(64), generatedMediaSha256: '0'.repeat(64), queryIds: [], accountLane: 'none' }, requirements: ['PERF-001', 'TEST-004'], metrics,
    command: { id: 'aggregate-sealed-compatibility-matrix', argvRedacted: ['aggregate-compatibility', 'immutable-api26-api35-api36-ledgers'], startedAt: now, endedAt: now, timezone: 'Asia/Shanghai', exitCode: pass ? 0 : 4, evidenceKinds: ['PERFORMANCE'] },
    outcome: pass ? 'PASS' : metrics.some(metric => metric.samples.some(sample => ['FAIL', 'TIMEOUT'].includes(sample.status))) ? 'FAIL' : 'NOT_VERIFIED',
    artifacts: files.map(name => ({ kind: name.split('/').pop(), relativePath: name, sha256: hash(readFileSync(resolve(run, name))), bytes: statSync(resolve(run, name)).size, sanitized: true })),
    uncovered: pass ? [] : [{ requirement: 'PERF-001', reasonCode: 'COLD_MATRIX_NON_PASS', safeDetail: 'Every API retains all 20 terminal slots. TTFD is a visible-shell upper bound including UiAutomator observer overhead, not an isolated render duration.', ownerAction: 'Review all immutable device timing samples before a new candidate run.' }],
  };
  writeRecord(run, '08-performance.json', record);
  return record;
}

if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== '--aggregate-compatibility' || process.argv[3] !== '--run-dir') throw new Error('usage: performance-evidence.mjs --aggregate-compatibility --run-dir DIR');
    const run = runRootFor(process.argv[4]);
    const repo = resolve(import.meta.dirname, '../../..');
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('diff', '--quiet'); git('diff', '--cached', '--quiet');
    const build = JSON.parse(readFileSync(resolve(run, '08-build.json'), 'utf8'));
    if (build.git.sha !== git('rev-parse', 'HEAD')) throw new Error('current HEAD differs from candidate');
    if (readFileSync(resolve(run, '08-build.sha256'), 'utf8').trim() !== hash(readFileSync(resolve(run, '08-build.json')))) throw new Error('build seal mismatch');
    console.log(JSON.stringify({ outcome: writeCompatibilityRecord(run).outcome }));
  } catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 3; }
}
