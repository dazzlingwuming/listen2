#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const REQUIRED_IDS = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, '0'));

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

if (process.argv.includes('--self-test-exact-20')) {
  selfTest();
} else if (process.argv[2]) {
  const record = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(record.metrics.map(metric => ({ name: metric.name, ...summarizeFamily(metric.samples, metric.budget) })), null, 2));
} else {
  console.error('usage: summarize-performance.mjs --self-test-exact-20 | RECORD.json');
  process.exitCode = 2;
}
