#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { assertIndex, implementation } from './finalize-evidence.mjs';
import { pathWithinRun, runRootFor, sha256 } from './evidence.mjs';
import { verify as verifyCandidate } from './candidate.mjs';
const REPO = resolve(import.meta.dirname, '../../..');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
export function argsFor(args) {
  const result = {};
  for (let i=0; i<args.length; i++) {
    const arg=args[i]; if(Object.hasOwn(result,arg)) fail('ARGUMENT_DUPLICATE');
    if(['--verify-only','--ack-backup','--ack-rollback'].includes(arg)) result[arg]=true;
    else if(['--index','--apk','--serial'].includes(arg)&&args[i+1]&&!args[i+1].startsWith('--')) result[arg]=args[++i];
    else fail('ARGUMENT_INVALID');
  }
  if(!result['--index']||!result['--apk']) fail('INDEX_AND_APK_REQUIRED');
  if(!result['--verify-only']&&(!result['--serial']||!result['--ack-backup']||!result['--ack-rollback'])) fail('EXPLICIT_SERIAL_BACKUP_AND_ROLLBACK_ACK_REQUIRED');
  if(result['--serial']&&!/^[A-Za-z0-9._:-]{1,128}$/.test(result['--serial'])) fail('SERIAL_INVALID');
  if(result['--verify-only']&&result['--serial']) fail('VERIFY_ONLY_HAS_NO_DEVICE_ACTION');
  return result;
}
function regularNoSymlink(file, root) {
  let probe=root;
  const rel=relative(root,file); if(rel==='..'||rel.startsWith(`..${sep}`)) fail('PATH_ESCAPE');
  for(const part of rel.split(sep).filter(Boolean)) { probe=resolve(probe,part); if(existsSync(probe)&&lstatSync(probe).isSymbolicLink()) fail('SYMLINK_REJECTED'); }
  if(!existsSync(file)||!lstatSync(file).isFile()||realpathSync(file)!==file) fail('FILE_INVALID');
}
export function parseBadging(output) {
  const pkg=output.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
  const min=output.match(/^sdkVersion:'(\d+)'/m),target=output.match(/^targetSdkVersion:'(\d+)'/m);
  if(!pkg||!min||!target) fail('APK_MANIFEST_INVALID');
  return {applicationId:pkg[1],versionCode:Number(pkg[2]),versionName:pkg[3],minSdk:Number(min[1]),targetSdk:Number(target[1])};
}
export function checkApk({apk,build,aapt,runCommand=execFileSync}) {
  if(sha256(apk)!==build.sha256||statSync(apk).size!==build.bytes) fail('APK_HASH_MISMATCH');
  const output=runCommand(aapt,['dump','badging',apk],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});
  const actual=parseBadging(output);
  if(actual.applicationId!==build.applicationId||actual.versionCode!==build.versionCode||actual.versionName!==build.versionName||actual.minSdk!==24||actual.targetSdk!==36) fail('APK_PACKAGE_VERSION_OR_API_MISMATCH');
  return actual;
}
export function verifyCertificate(apk, expected, apksigner, runCommand=execFileSync) {
  const output=runCommand(apksigner,['verify','--verbose','--print-certs',apk],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const digest=output.match(/(?:Signer #1|V[0-9.]+ Signer):? certificate SHA-256 digest: ([a-f0-9]{64})/i)?.[1]?.toLowerCase();
  if(digest!==expected) fail('HANDOFF_SIGNER_MISMATCH');
}
export function validateIndexCandidate(index, candidate) {
  assertIndex(index);
  if(!candidate||JSON.stringify(index.build)!==JSON.stringify(candidate.build)||index.git.sha!==candidate.git.sha||index.runId!==candidate.runId) fail('INDEX_CANDIDATE_MISMATCH');
  const tests=candidate.artifacts.filter(a=>a.kind==='release-like-android-test-apk');
  if(tests.length!==1||index.testPayloadSha256!==tests[0].sha256) fail('INDEX_TEST_PAYLOAD_MISMATCH');
  if(index.build.variant!=='releaseLike'||index.build.debuggable!==false||index.build.applicationId!=='com.dazzlingwuming.listen2'||!Number.isInteger(index.build.versionCode)||!/^[a-f0-9]{64}$/.test(index.build.signerSha256)) fail('CANDIDATE_METADATA_INVALID');
}
function main() {
  const args=argsFor(process.argv.slice(2));
  const indexFile=resolve(args['--index']);
  if(basename(indexFile)!=='08-evidence-index.json') fail('INDEX_NAME_INVALID');
  const run=runRootFor(dirname(indexFile)); regularNoSymlink(indexFile,resolve(REPO,'.planning'));
  const index=JSON.parse(readFileSync(indexFile,'utf8')); assertIndex(index);
  const buildFile=pathWithinRun(run,'08-build.json');
  const candidate=JSON.parse(readFileSync(buildFile,'utf8')); validateIndexCandidate(index,candidate);
  if(!basename(run).endsWith(`-${index.git.sha.slice(0,12)}`)) fail('INDEX_RUN_HEAD_MISMATCH');
  for(const item of index.records) {
    const file=pathWithinRun(run,item.relativePath); if(sha256(file)!==item.sha256) fail('INDEX_RECORD_HASH_MISMATCH');
    const record=JSON.parse(readFileSync(file,'utf8')); if(record.runId!==index.runId||record.git.sha!==index.git.sha||record.recordId!==item.recordId||record.outcome!==item.outcome) fail('INDEX_RECORD_PROVENANCE_MISMATCH');
  }
  for(const row of index.requirements) implementation(REPO,index.git.sha,row.implementationPaths,row);
  const apk=resolve(args['--apk']);
  const handoff=resolve(REPO,'dist/android/Listen2-2.34.0-android-release-like-development-signed.apk');
  if(apk!==handoff&&apk!==resolve(run,index.build.apkRelativePath)) fail('APK_LOCATION_INVALID'); regularNoSymlink(apk,REPO);
  const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME; if(!sdk) fail('ANDROID_SDK_REQUIRED');
  const apksigner=resolve(sdk,'build-tools/37.0.0/apksigner'),aapt=resolve(sdk,'build-tools/37.0.0/aapt');
  if(!existsSync(apksigner)||!existsSync(aapt)) fail('ANDROID_BUILD_TOOLS_REQUIRED');
  try { verifyCandidate(run,index.git.sha,apksigner,apk); } catch { fail('CANDIDATE_SEAL_OR_SIGNATURE_INVALID'); }
  checkApk({apk,build:index.build,aapt});
  // Verify the supplied copy's certificate independently of the sealed run copy.
  verifyCertificate(apk,index.build.signerSha256,apksigner);
  console.log(`Development-signed evaluation candidate; ${index.parityVerdict}. No formal release or store signing authority.`);
  console.log(`Verified SHA-256 ${index.build.sha256}; package ${index.build.applicationId}; version ${index.build.versionCode}.`);
  if(args['--verify-only']) return;
  const adb=resolve(sdk,'platform-tools/adb'); if(!existsSync(adb)) fail('ADB_REQUIRED');
  const serial=args['--serial'];
  const state=execFileSync(adb,['-s',serial,'get-state'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); if(state!=='device') fail('EXPLICIT_DEVICE_NOT_READY');
  const api=Number(execFileSync(adb,['-s',serial,'shell','getprop','ro.build.version.sdk'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()); if(!Number.isInteger(api)||api<24) fail('DEVICE_API_UNSUPPORTED');
  console.log('Replacement preserves data when signer/version are compatible. Prior-APK rollback must be independently verified; uninstall deletes private data. Semantic backup does not restore credentials or SAF grants.');
  execFileSync(adb,['-s',serial,'install','-r',apk],{stdio:'inherit'});
}
if(resolve(process.argv[1]||'')===resolve(import.meta.filename)) {
  try { main(); } catch(error) { console.error(`Installer rejected: ${/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'VERIFICATION_FAILED'}. No implicit device or release action is allowed.`); process.exitCode=3; }
}
