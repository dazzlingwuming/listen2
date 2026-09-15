#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const REQUIRED_IDS = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, '0'));
const PROBE_IDS = count => Array.from({ length: count }, (_, index) => String(index + 1).padStart(2, '0'));

function fail(message) {
  throw new Error(message);
}

export function percentile(values, percentage) {
  if (!Array.isArray(values) || values.length === 0) fail('samples are required');
  const ordered = [...values].sort((left, right) => left - right);
  if (!ordered.every(value => Number.isFinite(value) && value >= 0)) fail('samples must be finite non-negative durations');
  return ordered[Math.ceil((percentage / 100) * ordered.length) - 1];
}

export function summarizeFamily(samples, budget) {
  if (!Array.isArray(samples) || samples.length !== REQUIRED_IDS.length) fail('family must retain exactly 20 attempts');
  const ids = samples.map(sample => sample.id);
  if (new Set(ids).size !== REQUIRED_IDS.length || !REQUIRED_IDS.every((id, index) => ids[index] === id))
    fail('attempt IDs must be immutable and exactly 01 through 20');
  for (const sample of samples) {
    if (!['PASS', 'FAIL', 'TIMEOUT'].includes(sample.status)) fail('attempt status must be terminal');
    if (!Number.isFinite(sample.elapsedMs) || sample.elapsedMs < 0) fail('attempt elapsed time is invalid');
  }
  const durations = samples.map(sample => sample.elapsedMs);
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const max = Math.max(...durations);
  return { count: samples.length, p50, p95, max, budget, status: samples.every(sample => sample.status === 'PASS') && p95 <= budget ? 'PASS' : 'FAIL' };
}

export function summarizeStartupProbe(rows, budget = { ttid: 3000, ttfd: 4000 }) {
  if (!Array.isArray(rows) || (rows.length !== 3 && rows.length !== 5)) fail('startup probe must retain exactly 3 or 5 attempts');
  const expectedIds = PROBE_IDS(rows.length);
  if (!expectedIds.every((id, index) => rows[index]?.id === id)) fail('startup probe attempt IDs must be immutable and consecutive');

  const validStatus = new Set(['PASS', 'FAIL', 'TIMEOUT']);
  for (const row of rows) {
    if (!validStatus.has(row.status)) fail('startup probe status must be terminal');
    if (!Number.isFinite(row.hostElapsedMs) || row.hostElapsedMs < 0) fail('startup probe terminal elapsed time is invalid');
    if (row.status === 'PASS' && (!row.pidAbsent || row.launchState !== 'COLD' ||
        !Number.isFinite(row.totalTimeMs) || row.totalTimeMs < 0 ||
        !Number.isFinite(row.waitTimeMs) || row.waitTimeMs < 0 ||
        !Number.isFinite(row.a11yReadyMs) || row.a11yReadyMs < 0)) {
      fail('passing startup probe row lacks a cold device timing or interactive marker');
    }
  }

  const metric = (name, source, field, limit) => {
    const missingSource = rows.some(row => !Number.isFinite(row[field]) || row[field] < 0);
    const allPass = rows.every(row => row.status === 'PASS');
    const values = missingSource ? [] : rows.map(row => row[field]);
    const p50 = values.length === 0 ? null : percentile(values, 50);
    const p95 = values.length === 0 ? null : percentile(values, 95);
    const max = values.length === 0 ? null : Math.max(...values);
    return {
      name,
      source,
      budget: limit,
      count: rows.length,
      p50,
      p95,
      max,
      status: allPass && !missingSource && p95 <= limit ? 'PASS' : 'FAIL',
    };
  };

  return {
    attempts: rows,
    hostTransport: metric('host-transport', 'host-adb-wall-clock-diagnostic-only', 'hostElapsedMs', Number.MAX_SAFE_INTEGER),
    ttid: metric('ttid', 'am-start-total-time', 'totalTimeMs', budget.ttid),
    activityWait: metric('activity-wait', 'am-start-wait-time-diagnostic', 'waitTimeMs', Number.MAX_SAFE_INTEGER),
    ttfd: metric('ttfd', 'a11y-phone-shell-tabs-ready', 'a11yReadyMs', budget.ttfd),
  };
}

function parseProbeLedger(file) {
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((line, index) => {
    const [id, status, pidAbsent, hostElapsedMs, totalTimeMs, waitTimeMs, a11yReadyMs, launchState, reasonCode] = line.split('|');
    return {
      id,
      status,
      pidAbsent: pidAbsent === 'true',
      hostElapsedMs: Number(hostElapsedMs),
      totalTimeMs: totalTimeMs === '' ? null : Number(totalTimeMs),
      waitTimeMs: waitTimeMs === '' ? null : Number(waitTimeMs),
      a11yReadyMs: a11yReadyMs === '' ? null : Number(a11yReadyMs),
      launchState,
      reasonCode: reasonCode || 'none',
      row: index + 1,
    };
  });
}

function selfTest() {
  const valid = REQUIRED_IDS.map((id, index) => ({ id, status: 'PASS', elapsedMs: index + 1 }));
  const summary = summarizeFamily(valid, 20);
  if (summary.p50 !== 10 || summary.p95 !== 19 || summary.max !== 20 || summary.status !== 'PASS') fail('nearest-rank calculation failed');
  valid[19].status = 'TIMEOUT';
  if (summarizeFamily(valid, 21).status !== 'FAIL') fail('failed attempt must prevent a pass');
  let rejected = false;
  try { summarizeFamily(valid.slice(0, 19), 21); } catch { rejected = true; }
  if (!rejected) fail('19-row family accepted');
  console.log('Performance summary exact-20 self-test passed.');
}

function selfTestProbe() {
  const valid = PROBE_IDS(3).map((id, index) => ({
    id,
    status: 'PASS',
    pidAbsent: true,
    hostElapsedMs: 1000 + index,
    totalTimeMs: 900 + index,
    waitTimeMs: 950 + index,
    a11yReadyMs: 1100 + index,
    launchState: 'COLD',
  }));
  const summary = summarizeStartupProbe(valid);
  if (summary.ttid.status !== 'PASS' || summary.ttfd.status !== 'PASS' || summary.hostTransport.source !== 'host-adb-wall-clock-diagnostic-only') {
    fail('startup probe source contract failed');
  }
  valid[2] = { ...valid[2], status: 'FAIL', a11yReadyMs: null };
  if (summarizeStartupProbe(valid).ttfd.status !== 'FAIL') fail('missing interactive marker must fail the startup probe');
  console.log('Performance startup-probe self-test passed.');
}

if (process.argv.includes('--self-test-exact-20')) {
  selfTest();
} else if (process.argv.includes('--self-test-startup-probe')) {
  selfTestProbe();
} else if (process.argv[2] === '--startup-probe-ledger' && process.argv[3]) {
  console.log(JSON.stringify(summarizeStartupProbe(parseProbeLedger(process.argv[3])), null, 2));
} else if (process.argv[2]) {
  const record = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(record.metrics.map(metric => ({ name: metric.name, ...summarizeFamily(metric.samples, metric.budget) })), null, 2));
} else {
  console.error('usage: summarize-performance.mjs --self-test-exact-20 | --self-test-startup-probe | --startup-probe-ledger LEDGER | RECORD.json');
  process.exitCode = 2;
}
