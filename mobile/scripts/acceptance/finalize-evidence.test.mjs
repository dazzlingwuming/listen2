import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, basename } from 'node:path';
import { createHash, randomInt } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeCredentialEvidence, nextCredentialAttempt } from './credential-evidence.mjs';
import { writeCompatibilityRecord } from './performance-evidence.mjs';
import { baseRecord, sha256 } from './evidence.mjs';
import { evaluate, loadRecords, parseMap, parseRequirements, implementation, checkMetrics, assertIndex, markdown } from './finalize-evidence.mjs';
const repo = resolve(import.meta.dirname, '../../..');
const phase = resolve(repo, '.planning/phases/08-integrated-api-35-acceptance-release-like-evidence');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const requirementsText = readFileSync(resolve(repo, '.planning/REQUIREMENTS.md'), 'utf8');
const mapText = readFileSync(resolve(phase, '08-REQUIREMENT-EVIDENCE-MAP.md'), 'utf8');
const ids = parseRequirements(requirementsText).map(row => row.id);
const kinds = [...new Set(parseMap(mapText).flatMap(row => row.kinds))].filter(k => !['CURRENT_HEAD_REACHABILITY', 'FINAL_INDEX'].includes(k));
const files = ['08-prerequisites.json', '08-build.json', '08-journey.json', '08-api35-performance.json', '08-performance.json', '08-live-provider.json', '08-reproducibility.json'];
function fixture(fn) {
  const root = mkdtempSync(resolve(tmpdir(), 'listen2-finalizer-test-')); const run = resolve(root, `phase08-20261011T000000Z-${head.slice(0, 12)}`); mkdirSync(run);
  writeFileSync(resolve(run, 'product.apk'), 'product-fixture'); writeFileSync(resolve(run, 'test.apk'), 'test-fixture'); writeFileSync(resolve(run, 'repro.apk'), 'product-fixture');
  writeFileSync(resolve(run,'fixture.json'),'fixture-metadata');writeFileSync(resolve(run,'signal.wav'),'synthetic-media');
  const productHash = sha256(resolve(run, 'product.apk')); const testHash = sha256(resolve(run, 'test.apk'));
  const metrics = Object.entries({ ttid:3000, ttfd:4000, 'first-search':5000, 'first-audio':6000, 'api26-ttid':3000, 'api26-ttfd':4000, 'api36-ttid':3000, 'api36-ttfd':4000 }).map(([name,budget]) => ({ name,budget,status:'PASS',p50:100,p95:100,max:100,samples:Array.from({length:20},(_,i)=>({id:String(i+1).padStart(2,'0'),status:'PASS',elapsedMs:100})) }));
  const original = files.map((file, i) => {
    const record = baseRecord(run, `fixture-${i}`, ids); record.git.sha = head;
    record.command.evidenceKinds = kinds; record.metrics = structuredClone(metrics);
    record.build = { variant:'releaseLike', applicationId:'com.dazzlingwuming.listen2', versionCode:1000001, versionName:'2.34.0-android', apkRelativePath:'product.apk', sha256:productHash, bytes:15, signerSha256:'a'.repeat(64), testPayloadSha256:testHash, zipAligned16KiB:true, minified:true, debuggable:false };
    record.device = { serialHash:createHash('sha256').update('fixture-serial').digest('hex'), apiLevel:35 };
    record.fixture = { id:'fixture',revision:'1',manifestSha256:sha256(resolve(run,'fixture.json')),generatedMediaSha256:sha256(resolve(run,'signal.wav')),accountLane:'authorized-in-app' };
    record.recovery = { cleanupStatus:'restored',deviceStateRestored:true,steps:[] };
    record.artifacts = [{kind:'release-like-apk',relativePath:'product.apk',sha256:productHash,bytes:15,sanitized:true},{kind:'release-like-android-test-apk',relativePath:'test.apk',sha256:testHash,bytes:12,sanitized:true}];
    for (const path of ['fixture.json','signal.wav']) record.artifacts.push({kind:'fixture-input',relativePath:path,sha256:sha256(resolve(run,path)),bytes:readFileSync(resolve(run,path)).length,sanitized:true});
    if (file === '08-performance.json') record.artifacts.push({kind:'sealed-api35-input',relativePath:'08-api35-performance.json',sha256:sha256(resolve(run,'08-api35-performance.json')),bytes:readFileSync(resolve(run,'08-api35-performance.json')).length,sanitized:true});
    if (file === '08-reproducibility.json') {
      record.artifacts.push({kind:'repro-build-one-apk',relativePath:'product.apk',sha256:productHash,bytes:15,sanitized:true},{kind:'repro-build-two-apk',relativePath:'repro.apk',sha256:productHash,bytes:15,sanitized:true});
      for (const path of ['08-build.json','08-build.sha256']) record.artifacts.push({kind:'build-seal-reference',relativePath:path,sha256:sha256(resolve(run,path)),bytes:readFileSync(resolve(run,path)).length,sanitized:true});
    }
    writeFileSync(resolve(run,file), JSON.stringify(record)); if (file === '08-build.json') writeFileSync(resolve(run,'08-build.sha256'),`${sha256(resolve(run,file))}\n`); return record;
  });
  const anchors = ids.map(id => ({id,paths:['mobile/README.md']}));
  const rewrite = (index, mutation) => { const record = structuredClone(original[index]); mutation(record); writeFileSync(resolve(run,files[index]),JSON.stringify(record)); if (index === 1) { writeFileSync(resolve(run,'08-build.sha256'),`${sha256(resolve(run,files[1]))}\n`); for (const path of ['08-build.json','08-build.sha256']) {const link=original[6].artifacts.find(a=>a.relativePath===path);link.sha256=sha256(resolve(run,path));link.bytes=readFileSync(resolve(run,path)).length;} writeFileSync(resolve(run,files[6]),JSON.stringify(original[6])); } if (index === 3) { const link=original[4].artifacts.find(a=>a.kind==='sealed-api35-input');link.sha256=sha256(resolve(run,files[index]));link.bytes=readFileSync(resolve(run,files[index])).length;writeFileSync(resolve(run,files[4]),JSON.stringify(original[4])); } return record; };
  const evaluateFixture = changes => evaluate({repo,run,head,requirementsText,mapText,anchors,records:loadRecords(run,head),candidateVerified:true,reproducibilityVerified:true,...changes});
  try { fn({run,root,original,rewrite,anchors,evaluateFixture}); } finally { rmSync(root,{recursive:true,force:true}); }
}
test('authoritative requirements and map contain exact unique 58 IDs', () => {
  assert.equal(ids.length,58); assert.equal(parseMap(mapText).length,58);
  assert.throws(()=>parseRequirements(requirementsText.replace('- [ ] **PERF-001**','- [ ] **PERF-099**')),/REQUIREMENT_IDS_INVALID/);
  assert.throws(()=>parseMap(mapText.replace('| 58 | REL-003 |','| 58 | REL-002 |')),/EVIDENCE_MAP_IDS_INVALID/);
  assert.throws(()=>parseMap(mapText.replace('| 58 | REL-003 | CURRENT_HEAD_REACHABILITY, FINAL_INDEX |','')),/EVIDENCE_MAP_IDS_INVALID/);
});
test('current HEAD anchors include explicit unresolved SEC-001 and cannot pass parity', () => fixture(({evaluateFixture}) => {
  const anchors=JSON.parse(readFileSync(new URL('./implementation-anchors.json',import.meta.url),'utf8'));
  assert.equal(anchors.length,58); assert.deepEqual(anchors.find(row=>row.id==='SEC-001').paths,[]);
  const model=evaluateFixture({anchors}); assert.equal(model.parityVerdict,'NOT_PARITY_READY'); assert.equal(model.requirements.find(row=>row.id==='SEC-001').status,'NOT_VERIFIED');
}));
test('complete synthetic evidence proves reducer positive path; this is never device evidence', () => fixture(({evaluateFixture}) => {
  const model=evaluateFixture(); assert.equal(model.parityVerdict,'PARITY_READY'); assert.equal(model.requirements.length,58); assertIndex(model); assert.match(markdown(model),/\*\*PARITY_READY\*\*/);
}));
test('missing records produce an honest index, never synthetic PASS', () => fixture(({run,evaluateFixture}) => {
  for(const file of files) rmSync(resolve(run,file)); const model=evaluateFixture(); assert.equal(model.parityVerdict,'NOT_PARITY_READY'); assert.equal(model.records.length,0); assert.equal(model.build,null);
}));
test('credential evidence cannot be replaced by public, source, or legacy broad TEST rows', () => fixture(({rewrite,evaluateFixture}) => {
  for(let i=0;i<files.length;i++)rewrite(i,r=>{r.command.evidenceKinds=r.command.evidenceKinds.filter(k=>k!=='CREDENTIAL_LIVE');});
  const model=evaluateFixture(); assert.equal(model.requirements.find(r=>r.id==='AUTH-002').status,'NOT_VERIFIED'); assert.equal(model.parityVerdict,'NOT_PARITY_READY');
}));
test('reached platform limitation remains DEGRADED', () => fixture(({rewrite,evaluateFixture}) => {
  for(let i=0;i<files.length;i++)rewrite(i,r=>{r.outcome='DEGRADED';});
  const model=evaluateFixture(); assert.equal(model.requirements.find(r=>r.id==='AUTH-002').status,'DEGRADED'); assert.equal(model.parityVerdict,'NOT_PARITY_READY');
}));
test('wrong SHA, old run, changed artifact, and wrong test payload reject', () => {
  fixture(({rewrite,run})=>{rewrite(2,r=>{r.git.sha='f'.repeat(40);});assert.throws(()=>loadRecords(run,head),/RECORD_HEAD_MISMATCH/);});
  fixture(({rewrite,run})=>{rewrite(2,r=>{r.runId='phase08-20261010T000000Z-0123456789ab';});assert.throws(()=>loadRecords(run,head),/RECORD_SCHEMA_OR_ARTIFACT_INVALID/);});
  fixture(({run})=>{writeFileSync(resolve(run,'product.apk'),'substitute');assert.throws(()=>loadRecords(run,head),/RECORD_SCHEMA_OR_ARTIFACT_INVALID/);});
  fixture(({rewrite,evaluateFixture})=>{rewrite(2,r=>{r.build.sha256='f'.repeat(64);});assert.throws(()=>evaluateFixture(),/CANDIDATE_SHA_MISMATCH/);});
  fixture(({rewrite,evaluateFixture})=>{rewrite(2,r=>{r.build.testPayloadSha256='f'.repeat(64);});assert.throws(()=>evaluateFixture(),/TEST_PAYLOAD_SHA_MISMATCH/);});
});
test('wrong blob and non-ancestor implementation reject', () => {
  const anchor=implementation(repo,head,['mobile/README.md']);
  assert.throws(()=>implementation(repo,head,['mobile/README.md'],{...anchor,implementationBlobSha256:['f'.repeat(64)]}),/IMPLEMENTATION_BLOB_MISMATCH/);
  assert.throws(()=>implementation(repo,head,['mobile/README.md'],{...anchor,implementationCommit:'f'.repeat(40)}),/IMPLEMENTATION_COMMIT_NOT_ANCESTOR/);
});
test('PASS cannot survive missing credential entry, cleanup, or command completion', () => {
  fixture(({rewrite,run})=>{rewrite(2,r=>{r.fixture.accountLane='none';});assert.throws(()=>loadRecords(run,head),/CREDENTIAL_LANE_MISSING/);});
  fixture(({rewrite,run})=>{rewrite(2,r=>{r.recovery.deviceStateRestored=false;});assert.throws(()=>loadRecords(run,head),/CLEANUP_FALSE_PASS/);});
  fixture(({rewrite,run})=>{rewrite(2,r=>{r.command.exitCode=1;});assert.throws(()=>loadRecords(run,head),/COMMAND_FALSE_PASS/);});
});
test('exact twenty unique samples, computed p95 and fixed budgets are enforced', () => fixture(({original})=>{
  let record=structuredClone(original[3]); record.metrics[0].samples.pop();assert.throws(()=>checkMetrics(record),/PERFORMANCE_SAMPLES_INVALID/);
  record=structuredClone(original[3]);record.metrics[0].samples[1].id='01';assert.throws(()=>checkMetrics(record),/PERFORMANCE_SAMPLES_INVALID/);
  record=structuredClone(original[3]);record.metrics[0].p95=99;assert.throws(()=>checkMetrics(record),/PERFORMANCE_SUMMARY_MISMATCH/);
  record=structuredClone(original[3]);record.metrics[0].budget=9999;assert.throws(()=>checkMetrics(record),/PERFORMANCE_SUMMARY_MISMATCH/);
}));
test('symlink artifact escapes reject and final index cannot lie about its rows', () => fixture(({run,root,evaluateFixture})=>{
  writeFileSync(resolve(root,'escape'),'escape'); rmSync(resolve(run,'product.apk'));symlinkSync(resolve(root,'escape'),resolve(run,'product.apk'));assert.throws(()=>loadRecords(run,head),/RECORD_SCHEMA_OR_ARTIFACT_INVALID/);
}));

test('CLI malformed input writes only sanitized run-root failure and preserves report',()=>{
  const evidence=resolve(phase,'evidence'); mkdirSync(evidence,{recursive:true});
  const run=resolve(evidence,`phase08-20990101T${String(randomInt(100000,999999))}Z-${head.slice(0,12)}`);mkdirSync(run);
  const report=resolve(phase,'08-ACCEPTANCE.md'); let before; try{before=readFileSync(report);}catch{}
  try {
    writeFileSync(resolve(run,'08-build.json'),JSON.stringify({token:'SENSITIVE_TEST_CANARY',unknown:'host-path-canary'}));
    const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'finalize-evidence.mjs'),'--run-dir',run],{encoding:'utf8'});
    assert.equal(result.status,3); assert.doesNotMatch(result.stdout+result.stderr,/SENSITIVE_TEST_CANARY|host-path-canary/);
    const failure=JSON.parse(readFileSync(resolve(run,'08-finalizer-failure.json'),'utf8'));
    assert.equal(failure.schemaVersion,1);assert.equal(failure.outcome,'FAIL');assert.ok(['RECORD_SCHEMA_OR_ARTIFACT_INVALID','RUN_HEAD_MISMATCH'].includes(failure.reasonCode));assert.equal(Object.keys(failure).length,3);
    assert.throws(()=>readFileSync(resolve(run,'08-evidence-index.json')));
    if(before) assert.deepEqual(readFileSync(report),before); else assert.throws(()=>readFileSync(report));
  } finally { rmSync(run,{recursive:true,force:true}); }
});

test('performance family PASS is specific and bootstrap build NV can be resolved by independent reproduction',()=>fixture(({rewrite,evaluateFixture})=>{
  rewrite(1,r=>{r.outcome='NOT_VERIFIED';r.uncovered=[{requirement:'REL-001',reasonCode:'REPRODUCIBILITY_PENDING'}];r.command.evidenceKinds=[];});
  let model=evaluateFixture();assert.equal(model.requirements.find(r=>r.id==='REL-001').status,'PASS');
  model=evaluateFixture({reproducibilityVerified:false});assert.equal(model.requirements.find(r=>r.id==='REL-001').status,'NOT_VERIFIED');
  for(let i=0;i<files.length;i++)if(i!==1)rewrite(i,r=>{r.outcome='NOT_VERIFIED';r.metrics=r.metrics.filter(m=>!m.name.startsWith('api'));});
  model=evaluateFixture();assert.equal(model.requirements.find(r=>r.id==='PERF-002').requiredEvidenceKinds.find(k=>k.kind==='PERFORMANCE').status,'PASS');assert.equal(model.requirements.find(r=>r.id==='PERF-001').status,'NOT_VERIFIED');assert.equal(model.parityVerdict,'NOT_PARITY_READY');
}));

test('fixture identity separates distinct lanes but NV cannot hide a false hash',()=>fixture(({rewrite,evaluateFixture})=>{
  rewrite(2,r=>{r.fixture.id='journey-distinct';});assert.equal(evaluateFixture().parityVerdict,'PARITY_READY');
  rewrite(2,r=>{r.outcome='NOT_VERIFIED';r.fixture.generatedMediaSha256='f'.repeat(64);});assert.throws(()=>evaluateFixture(),/FIXTURE_ARTIFACT_UNLINKED/);
}));

test('actual compatibility writer integrates six cold families without exempting live fixture provenance',()=>fixture(({run,evaluateFixture})=>{
  rmSync(resolve(run,'08-performance.json'));mkdirSync(resolve(run,'performance'));
  const cold=Array.from({length:20},(_,i)=>`${String(i+1).padStart(2,'0')}|PASS|true|9000|100|100|100|COLD|none`).join('\n');
  for(const api of [26,36])writeFileSync(resolve(run,`performance/api${api}-cold.tsv`),cold);
  const matrix=writeCompatibilityRecord(run);assert.equal(matrix.recordId,'phase8-performance-matrix');assert.equal(matrix.metrics.length,6);assert.equal(matrix.fixture.id,'none');
  assert.doesNotThrow(()=>loadRecords(run,head));
  let model=evaluateFixture();assert.equal(model.requirements.find(row=>row.id==='PERF-001').status,'PASS');
  const invalid=structuredClone(matrix);invalid.metrics.find(m=>m.name==='api35-ttid').p95=99;assert.throws(()=>checkMetrics(invalid),/PERFORMANCE_SUMMARY_MISMATCH/);
  invalid.metrics.find(m=>m.name==='api35-ttid').p95=100;invalid.command.evidenceKinds.push('LIVE_PUBLIC_PROVIDER');assert.throws(()=>checkMetrics(invalid),/PERFORMANCE_MATRIX_SCOPE_INVALID/);
  const api35=JSON.parse(readFileSync(resolve(run,'08-api35-performance.json')));api35.outcome='NOT_VERIFIED';api35.fixture=structuredClone(matrix.fixture);writeFileSync(resolve(run,'08-api35-performance.json'),JSON.stringify(api35));
  const ref=matrix.artifacts.find(a=>a.relativePath==='08-api35-performance.json');ref.sha256=sha256(resolve(run,'08-api35-performance.json'));ref.bytes=readFileSync(resolve(run,'08-api35-performance.json')).length;writeFileSync(resolve(run,'08-performance.json'),JSON.stringify(matrix));
  assert.throws(()=>evaluateFixture(),/FIXTURE_FREE_SCOPE_INVALID/);
}));

test('honest failed reproducibility without generated APKs retains FAIL instead of malformed',()=>fixture(({rewrite,evaluateFixture})=>{
  rewrite(6,r=>{r.outcome='FAIL';r.command.exitCode=4;r.artifacts=r.artifacts.filter(a=>!['repro-build-one-apk','repro-build-two-apk'].includes(a.kind));});
  const model=evaluateFixture();assert.equal(model.requirements.find(r=>r.id==='REL-001').status,'FAIL');assert.equal(model.parityVerdict,'NOT_PARITY_READY');
}));

test('actual live record emitter accepts explicit public fixture-free lane but forbids credential exemption',()=>fixture(({run,evaluateFixture})=>{
  const shell=readFileSync(resolve(import.meta.dirname,'run-live-provider-smoke.sh'),'utf8');
  const source=shell.match(/<<'NODE' > \"\$RUN_DIR\/\.live-provider\.json\"\n([\s\S]*?)\nNODE/);
  assert.ok(source,'actual live record emitter is discoverable');
  writeFileSync(resolve(run,'live-provider-results.txt'),'acceptance-event=live-search-results-kugou-2');
  const emitted=spawnSync(process.execPath,['--input-type=module','-',run,'e'.repeat(64),'PASS','results','200','restored','fixture-serial','PASS',head,'live-provider',new Date().toISOString()],{input:source[1],encoding:'utf8',cwd:repo});
  assert.equal(emitted.status,0,emitted.stderr);const record=JSON.parse(emitted.stdout);assert.equal(record.fixture.id,'none');assert.ok(record.command.evidenceKinds.includes('LIVE_PUBLIC_PROVIDER'));writeFileSync(resolve(run,'08-live-provider.json'),JSON.stringify(record));
  assert.doesNotThrow(()=>evaluateFixture());
  record.command.evidenceKinds.push('CREDENTIAL_LIVE');record.outcome='NOT_VERIFIED';writeFileSync(resolve(run,'08-live-provider.json'),JSON.stringify(record));assert.throws(()=>evaluateFixture(),/FIXTURE_FREE_SCOPE_INVALID/);
}));

const retainedObservations = serialHash => ({schemaVersion:1,serialHash,startedAt:new Date().toISOString(),baseline:{account:'AUTHENTICATED',configuration:'CONFIGURED',connection:'PASS',translation:'PASS'},resume:{account:'AUTHENTICATED',configuration:'CONFIGURED'},playback:{account:'AUTHENTICATED',selection:'UNIQUE_P1',playback:'PLAYING_ADVANCING',download:'READY_CHECKED',positionstartms:1000,positionendms:4000},offline:{playback:'PLAYING_ADVANCING',download:'READY_CHECKED',positionstartms:4000,positionendms:7000},network:{originalWifi:1,originalData:1,offlineWifi:0,offlineData:0,defaultNetworkAbsent:true,restoredWifi:1,restoredData:1,restoreStatus:'RESTORED',signal:'NONE'}});
test('append-only credential writer integrates with finalizer and cannot erase lifecycle gaps',()=>fixture(({run,original,evaluateFixture})=>{
  const observations=retainedObservations(original[2].device.serialHash);
  const first=writeCredentialEvidence(run,nextCredentialAttempt(run),observations);
  assert.equal(first.outcome,'PASS');assert.equal(first.fixture.generatedMediaSha256,'0'.repeat(64));
  assert.throws(()=>writeCredentialEvidence(run,'001',observations),/IMMUTABLE/);
  writeCredentialEvidence(run,nextCredentialAttempt(run),observations);
  const model=evaluateFixture();assert.equal(model.records.filter(r=>r.recordId.startsWith('phase8-credential-live-')).length,2);
  for(const id of ['AUTH-002','AI-001','AI-003','PLAY-001','CACHE-001','CACHE-002'])assert.equal(model.requirements.find(r=>r.id===id).status,'NOT_VERIFIED');
  first.uncovered=[];writeFileSync(resolve(run,'08-credential-live-001.json'),JSON.stringify(first));
  assert.throws(()=>evaluateFixture(),/CREDENTIAL_LIFECYCLE_GAP_REMOVED/);
}));
test('credential observations are hash bound, missing input stays NV, and directories cannot escape',()=>{
  fixture(({run,original,evaluateFixture})=>{
    writeCredentialEvidence(run,'001',retainedObservations(original[2].device.serialHash));
    writeFileSync(resolve(run,'credential/attempt-001/observations.json'),'{}');
    assert.throws(()=>evaluateFixture(),/RECORD_SCHEMA_OR_ARTIFACT_INVALID/);
  });
  fixture(({run,original,evaluateFixture})=>{
    const value=retainedObservations(original[2].device.serialHash);value.baseline={account:'NOT_AUTHENTICATED',configuration:'NOT_CONFIGURED'};value.resume={};
    assert.equal(writeCredentialEvidence(run,'001',value).outcome,'NOT_VERIFIED');
    assert.equal(evaluateFixture().requirements.find(r=>r.id==='AI-001').status,'NOT_VERIFIED');
  });
  fixture(({run,root,original})=>{
    symlinkSync(root,resolve(run,'credential'));
    assert.throws(()=>writeCredentialEvidence(run,'001',retainedObservations(original[2].device.serialHash)),/CREDENTIAL_DIRECTORY_INVALID/);
  });
});
