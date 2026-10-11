import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { makeRecord, safeLog, safeMapping } from './write-reproducibility.mjs';
import { baseRecord, sha256, writeRecord } from './evidence.mjs';

const root = mkdtempSync(resolve(tmpdir(), 'listen2-independent-repro-test-'));
const run = resolve(root, 'phase08-20261011T000000Z-aaaaaaaaaaaa'); mkdirSync(run);
try {
  const build = baseRecord(run, 'phase8-build', ['REL-001']);
  const original = JSON.stringify(build); writeFileSync(resolve(run, '08-build.json'), original);
  writeFileSync(resolve(run, '08-build.sha256'), sha256(resolve(run, '08-build.json')));
  const files = [['sealed-build-record', '08-build.json'], ['sealed-build-record-checksum', '08-build.sha256']];
  for (const label of ['one', 'two']) {
    const directory = `reproducibility/build-${label}`; mkdirSync(resolve(run, directory), { recursive: true });
    writeFileSync(resolve(run, directory, 'releaseLike.apk'), `synthetic-${label}`);
    files.push([`repro-build-${label}-apk`, `${directory}/releaseLike.apk`]);
  }
  const good = { startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), buildExit: 0, compareExit: 0, mappingStatus: 'retained' };
  assert.equal(makeRecord(run, build, [good, good], ['PASS', 'PASS'], files).outcome, 'PASS');
  assert.equal(makeRecord(run, build, [good, good], ['FAIL', 'PASS'], files).outcome, 'FAIL');
  assert.equal(makeRecord(run, build, [good, good], ['NOT_VERIFIED', 'PASS'], files).outcome, 'NOT_VERIFIED');
  assert.equal(makeRecord(run, build, [good, { ...good, buildExit: 1 }], ['PASS', 'NOT_VERIFIED'], files).outcome, 'FAIL');
  assert.equal(makeRecord(run, build, [good], ['PASS'], files.slice(0, 3)).outcome, 'NOT_VERIFIED');
  assert.equal(makeRecord(run, build, [good, { ...good, mappingStatus: 'unsafe-output-withheld' }], ['PASS', 'PASS'], files).outcome, 'FAIL');
  const record = makeRecord(run, build, [good, good], ['PASS', 'PASS'], files);
  assert.deepEqual(record.command.evidenceKinds, ['REPRO_BUILD']); assert.deepEqual(record.requirements, ['REL-001']);
  assert.equal(record.artifacts.filter(item => item.kind.endsWith('-apk')).length, 2);
  writeRecord(run, '08-reproducibility.json', record);
  assert.throws(() => writeRecord(run, '08-reproducibility.json', record), /immutable/);
  assert.equal(readFileSync(resolve(run, '08-build.json'), 'utf8'), original);
  const sanitized = safeLog('> Task :app:assembleReleaseLike\nBUILD SUCCESSFUL in 1m 2s\n/Users/private/workspace\ntoken=fixture-secret\nhttps://example.invalid/private\nPhase 8 reproducibility: repro-build-one /Users/private status=PASS');
  assert.equal(sanitized.includes('> Task :app:assembleReleaseLike'), true);
  assert.equal(/private|fixture-secret|https?:|token=/u.test(sanitized), false);
  assert.equal(safeMapping('com.example.Player -> a:\n'), true);
  for (const unsafe of ['/Users/private/path', '/home/private/path', 'C:\\Users\\private', 'https://example.invalid/private', '?token=private']) assert.equal(safeMapping(unsafe), false);
  console.log('Independent reproduction writer tests passed: both comparisons required, non-pass/missing/unsafe outputs retained honestly, schema-valid REL-001 record, original build/seal unchanged and immutable output.');
} finally { rmSync(root, { recursive: true, force: true }); }
