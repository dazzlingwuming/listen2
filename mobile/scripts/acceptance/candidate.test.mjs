import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { verify } from './candidate.mjs';
import { providerOutcomes } from './live-provider-outcomes.mjs';
import { baseRecord, sha256, writeRecord } from './evidence.mjs';

const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'listen2-candidate-contract-')));
const head = 'a'.repeat(40), digest = 'b'.repeat(64);
const run = resolve(root, `phase08-20261011T000000Z-${head.slice(0, 12)}`);
const signer = resolve(root, 'apksigner');
mkdirSync(resolve(run, 'artifacts'), { recursive: true });
writeFileSync(signer, `#!/bin/sh\nprintf 'Signer #1: certificate SHA-256 digest: ${digest}\\n'\n`, { mode: 0o700 });
const product = resolve(run, 'artifacts/releaseLike.apk'), test = resolve(run, 'artifacts/releaseLikeAndroidTest.apk');
writeFileSync(product, 'synthetic-product'); writeFileSync(test, 'synthetic-test');
const record = baseRecord(run, 'phase8-build', ['REL-001', 'REL-002', 'TEST-004']);
record.git.sha = head;
record.artifacts = [[product, 'release-like-apk'], [test, 'release-like-android-test-apk']].map(([file, kind]) => ({ kind, relativePath: `artifacts/${file.split('/').pop()}`, sha256: sha256(file), bytes: readFileSync(file).length, sanitized: true }));
record.build = { ...record.build, apkRelativePath: record.artifacts[0].relativePath, sha256: record.artifacts[0].sha256, bytes: record.artifacts[0].bytes, signerSha256: digest };
writeRecord(run, '08-build.json', record);
const build = resolve(run, '08-build.json'), seal = resolve(run, '08-build.sha256');
const original = readFileSync(build);
function reseal() { writeFileSync(seal, `${sha256(build)}\n`); }
try {
  for (const script of ['candidate.mjs', 'evidence.mjs']) {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, script), '--unknown-argument']);
    assert.notEqual(result.status, 0, 'unknown argument must fail before any write');
  }
  assert.throws(() => verify(run, head, signer), /artifact file is missing/);
  reseal(); assert.equal(verify(run, head, signer).paths[0], product);
  assert.throws(() => verify(run, 'c'.repeat(40), signer), /HEAD mismatch/);
  const wrong = resolve(root, 'wrong.apk'); writeFileSync(wrong, 'wrong-candidate');
  assert.throws(() => verify(run, head, signer, wrong), /differs from sealed/);
  assert.throws(() => verify(run, head, signer, undefined, wrong), /differs from sealed/);
  writeFileSync(product, 'modified-product'); assert.throws(() => verify(run, head, signer), /SHA-256/); writeFileSync(product, 'synthetic-product');
  writeFileSync(build, `${original} `); assert.throws(() => verify(run, head, signer), /seal mismatch/); writeFileSync(build, original);
  const rebound = { ...record, git: { ...record.git, sha: 'c'.repeat(40) } };
  writeFileSync(build, JSON.stringify(rebound)); reseal(); assert.throws(() => verify(run, head, signer), /HEAD mismatch/); writeFileSync(build, original); reseal();
  const badSigner = resolve(root, 'wrong-signer'); writeFileSync(badSigner, `#!/bin/sh\nprintf 'Signer #1: certificate SHA-256 digest: ${'c'.repeat(64)}\\n'\n`, { mode: 0o700 });
  assert.throws(() => verify(run, head, badSigner), /signer mismatch/);
  assert.throws(() => writeRecord(run, '08-build.json', record), /immutable/);
  assert.deepEqual(readFileSync(build), original);
  assert.equal(verify(run, head, signer, product, test).record.git.sha, head);
  assert.deepEqual(providerOutcomes('acceptance-event=live-search-upstream-restriction-网易云音乐\nacceptance-event=live-search-results-哔哩哔哩-2', 'live-provider').map(item => item.status), ['DEGRADED', 'PASS']);
  assert.equal(providerOutcomes('', 'live-all-providers').every(item => item.status === 'NOT_VERIFIED'), true);
  console.log('Candidate contract passed: missing seal, wrong hash/test/HEAD/signer, rebinding and overwrite rejected; new candidate accepted; old record unchanged.');
} finally { rmSync(root, { recursive: true, force: true }); }
