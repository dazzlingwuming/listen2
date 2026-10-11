import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256 } from './evidence.mjs';
import { argsFor,checkApk,parseBadging,verifyCertificate,validateIndexCandidate } from './install-verified-apk.mjs';
const base=['--index','fixture-index.json','--apk','fixture.apk'];
test('device actions need explicit single serial and both acknowledgements',()=>{
  assert.throws(()=>argsFor(base),/EXPLICIT_SERIAL_BACKUP_AND_ROLLBACK_ACK_REQUIRED/);
  assert.throws(()=>argsFor([...base,'--serial','emulator-5554','--ack-backup']),/EXPLICIT_SERIAL_BACKUP_AND_ROLLBACK_ACK_REQUIRED/);
  assert.equal(argsFor([...base,'--serial','emulator-5554','--ack-backup','--ack-rollback'])['--serial'],'emulator-5554');
  assert.throws(()=>argsFor([...base,'--serial','device one','--ack-backup','--ack-rollback']),/SERIAL_INVALID/);
  assert.throws(()=>argsFor([...base,'--serial','one','--serial','two']),/ARGUMENT_DUPLICATE/);
});
test('verify-only never accepts serial and release/publish arguments are closed',()=>{
  assert.equal(argsFor([...base,'--verify-only'])['--verify-only'],true);
  assert.throws(()=>argsFor([...base,'--verify-only','--serial','emulator-5554']),/VERIFY_ONLY_HAS_NO_DEVICE_ACTION/);
  for(const arg of ['--publish','--deploy','--release','--upload','--credentials','--force','--downgrade']) assert.throws(()=>argsFor([...base,'--verify-only',arg]),/ARGUMENT_INVALID/);
  const shell=spawnSync('bash',[resolve(import.meta.dirname,'install-verified-apk.sh'),...base,'--publish'],{encoding:'utf8'});
  assert.equal(shell.status,3);assert.match(shell.stderr,/ARGUMENT_INVALID/);
});
test('actual APK bytes and aapt metadata are verified before install',()=>{
  const root=mkdtempSync(resolve(tmpdir(),'listen2-installer-test-'));const apk=resolve(root,'candidate.apk');writeFileSync(apk,'candidate');
  const build={sha256:sha256(apk),bytes:9,applicationId:'com.dazzlingwuming.listen2',versionCode:1000001,versionName:'2.34.0-android'};
  const output="package: name='com.dazzlingwuming.listen2' versionCode='1000001' versionName='2.34.0-android'\nsdkVersion:'24'\ntargetSdkVersion:'36'\n";
  try{
    const calls=[]; const runCommand=(cmd,args)=>{calls.push([cmd,args]);return output;};
    assert.equal(checkApk({apk,build,aapt:'fixture-aapt',runCommand}).targetSdk,36);
    assert.deepEqual(calls,[['fixture-aapt',['dump','badging',apk]]]);
    assert.throws(()=>checkApk({apk,build:{...build,versionCode:1000002},aapt:'fixture-aapt',runCommand}),/APK_PACKAGE_VERSION_OR_API_MISMATCH/);
    assert.throws(()=>checkApk({apk,build,aapt:'fixture-aapt',runCommand:()=>output.replace("targetSdkVersion:'36'","targetSdkVersion:'35'")}),/APK_PACKAGE_VERSION_OR_API_MISMATCH/);
    writeFileSync(apk,'different');assert.throws(()=>checkApk({apk,build,aapt:'fixture-aapt',runCommand}),/APK_HASH_MISMATCH/);
    assert.throws(()=>parseBadging('not a manifest'),/APK_MANIFEST_INVALID/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('apksigner verifies certificate, refuses different signer and propagates tool failure',()=>{
  const calls=[];const signer='a'.repeat(64);
  verifyCertificate('fixture.apk',signer,'fixture-apksigner',(cmd,args)=>{calls.push([cmd,args]);return `Signer #1 certificate SHA-256 digest: ${signer}`;});
  assert.deepEqual(calls,[['fixture-apksigner',['verify','--verbose','--print-certs','fixture.apk']]]);
  assert.throws(()=>verifyCertificate('fixture.apk',signer,'fixture-apksigner',()=>`Signer #1 certificate SHA-256 digest: ${'b'.repeat(64)}`),/HANDOFF_SIGNER_MISMATCH/);
  assert.throws(()=>verifyCertificate('fixture.apk',signer,'fixture-apksigner',()=>{throw new Error('verification failed');}),/verification failed/);
});
test('index candidate mismatch is rejected before any device step',()=>{
  assert.throws(()=>validateIndexCandidate({schemaVersion:1},{}),/INDEX_SCHEMA_INVALID/);
});
