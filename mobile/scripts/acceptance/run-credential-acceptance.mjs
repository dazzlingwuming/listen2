#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { runRootFor } from './evidence.mjs';
import { verify as verifyCandidate } from './candidate.mjs';
import { nextCredentialAttempt, parseCredentialOutput, writeCredentialEvidence, emptyCredentialNetwork } from './credential-evidence.mjs';
const REPO = resolve(import.meta.dirname, '../../..');
const TARGET = 'com.dazzlingwuming.listen2', TEST = `${TARGET}.test`;
const reject = code => { const error = new Error(code); error.code = code; throw error; };
export function parseCredentialArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]; if (Object.hasOwn(result, arg)) reject('ARGUMENT_DUPLICATE');
    if (arg === '--allow-translation') result[arg] = true;
    else if (['--run-dir', '--serial'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) result[arg] = args[++i];
    else reject('ARGUMENT_INVALID');
  }
  if (!result['--run-dir'] || !/^[A-Za-z0-9._:-]{1,128}$/.test(result['--serial'] || '')) reject('RUN_AND_EXPLICIT_SERIAL_REQUIRED');
  return result;
}
const binaryState = value => /^[01]$/.test(value.trim()) ? Number(value.trim()) : null;
export async function withCredentialOfflineNetwork(device, probe, options = {}) {
  const network=emptyCredentialNetwork(), interrupted=options.interrupted??(()=>false), signal=options.signal??(()=>'NONE'), pause=options.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const read = key => { try { return binaryState(device('shell','settings','get','global',key)); } catch { return null; } };
  network.originalWifi=read('wifi_on'); network.originalData=read('mobile_data');
  if (network.originalWifi===null || network.originalData===null || interrupted()) { network.signal=signal(); return network; }
  let changed=false;
  try {
    changed=true;
    device('shell','svc','wifi','disable'); device('shell','svc','data','disable');
    const deadline=Date.now()+5000;
    do {
      network.offlineWifi=read('wifi_on'); network.offlineData=read('mobile_data');
      try { network.defaultNetworkAbsent=/^\s*Active default network:\s*(?:none|null)\s*$/mu.test(device('shell','dumpsys','connectivity')); } catch { network.defaultNetworkAbsent=false; }
      if (network.offlineWifi===0 && network.offlineData===0 && network.defaultNetworkAbsent || interrupted()) break;
      await pause(200);
    } while (Date.now()<deadline);
    if (!interrupted() && network.offlineWifi===0 && network.offlineData===0 && network.defaultNetworkAbsent) await probe();
  } catch { /* Partial observations remain NOT_VERIFIED; restoration is independent below. */ }
  finally {
    if (changed) {
      for (const [service,original] of [['wifi',network.originalWifi],['data',network.originalData]]) {
        try { device('shell','svc',service,original===1?'enable':'disable'); } catch { /* Verify the resulting state below. */ }
      }
      network.restoredWifi=read('wifi_on'); network.restoredData=read('mobile_data');
      network.restoreStatus=network.restoredWifi===network.originalWifi && network.restoredData===network.originalData?'RESTORED':'RESTORE_FAILED';
    }
    network.signal=signal();
  }
  return network;
}
export async function runCredentialWorkflow(observations, {device,instrument,interrupted=()=>false,signal=()=>'NONE',pause}) {
  observations.playback={};observations.offline={};observations.network=emptyCredentialNetwork();
  const observe=async phase=>{try{return await instrument(phase);}catch{return {};}};
  observations.baseline=await observe('baseline');
  if (!observations.baseline.entry && observations.baseline.account==='AUTHENTICATED' && !interrupted()) observations.playback=await observe('playback');
  const online=observations.playback;
  if (online.account==='AUTHENTICATED' && online.selection==='UNIQUE_P1' && online.playback==='PLAYING_ADVANCING' && online.download==='READY_CHECKED' && !interrupted()) {
    observations.network=await withCredentialOfflineNetwork(device,async()=>{
      device('shell','am','force-stop',TARGET);
      if (!interrupted()) observations.offline=await observe('offline');
    },{interrupted,signal,pause});
  }
  if (!observations.baseline.entry && observations.baseline.account==='AUTHENTICATED' && !interrupted()) {
    try { device('shell','am','force-stop',TARGET); observations.resume=await observe('resume'); } catch { observations.resume={}; }
  }
  observations.network.signal=signal();
  return observations;
}
export async function runCredentialInstrument({adb,serial,phase,allowTranslation=false,device,interrupted=()=>false,setActive=()=>{},timeoutMs=210000,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if (!['baseline','resume','playback','offline'].includes(phase)) reject('CREDENTIAL_PHASE_INVALID');
  let originalPid='';
  try {
    if(interrupted()) return {};
    device('shell','am','start','-W','-n',`${TARGET}/com.listen2mobile.MainActivity`);
    const deadline=Date.now()+5000;
    do {
      originalPid=device('shell','pidof',TARGET).trim();
      if(/^\d+$/.test(originalPid)||interrupted()) break;
      await pause(200);
    } while(Date.now()<deadline);
    if(!/^\d+$/.test(originalPid)||interrupted()) return {};
  } catch {return {};}
  return new Promise(resolveObservation=>{
    if(interrupted()) {resolveObservation({});return;}
    const args=['-s',serial,'shell','am','instrument','--no-restart','-w','-r','-e','class','com.listen2mobile.acceptance.CredentialAcceptanceTest','-e','credentialPhase',phase,'-e','allowTranslation',String(Boolean(allowTranslation)),`${TEST}/com.listen2mobile.acceptance.Phase08Instrumentation`];
    let output='',invalid=false;
    const child=spawn(adb,args,{stdio:['ignore','pipe','pipe']});setActive(child);
    const timeout=setTimeout(()=>{invalid=true;child.kill('SIGTERM');},timeoutMs);
    const collect=data=>{if(output.length+data.length>4*1024*1024){invalid=true;child.kill('SIGTERM');}else output+=data.toString('utf8');};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',()=>{invalid=true;});
    child.on('close',code=>{
      clearTimeout(timeout);setActive(null);
      if(invalid||interrupted()) {try {device('shell','am','force-stop',TARGET);}catch {/* Preserve data even when cancellation cannot be confirmed. */}}
      if(code!==0||invalid||interrupted()||[...output.matchAll(/^INSTRUMENTATION_CODE: -1\s*$/gmu)].length!==1||/INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|shortMsg=/u.test(output)){resolveObservation({});return;}
      try{if(device('shell','pidof',TARGET).trim()!==originalPid){resolveObservation({});return;}resolveObservation(parseCredentialOutput(output,phase));}catch{resolveObservation({});}
    });
  });
}
async function main() {
  const args = parseCredentialArgs(process.argv.slice(2));
  const requestedRun = resolve(args['--run-dir']);
  const run = runRootFor(requestedRun);
  const canonicalRun = resolve(REPO, '.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence', basename(run));
  if (requestedRun !== canonicalRun || run !== canonicalRun) reject('RUN_PATH_INVALID');
  let pathProbe = REPO;
  for (const part of relative(REPO, canonicalRun).split(sep)) { pathProbe = resolve(pathProbe, part); if (lstatSync(pathProbe).isSymbolicLink()) reject('RUN_SYMLINK_REJECTED'); }
  if (existsSync(resolve(run, '08-evidence-index.json'))) reject('FINAL_INDEX_ALREADY_SEALED');
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME; if (!sdk) reject('ANDROID_SDK_REQUIRED');
  const signer = resolve(sdk, 'build-tools/37.0.0/apksigner'), adb = resolve(sdk, 'platform-tools/adb');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const { record } = verifyCandidate(run, head, signer);
  const serial = args['--serial'];
  const device = (...argv) => execFileSync(adb, ['-s', serial, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  if (device('get-state').trim() !== 'device' || device('shell', 'getprop', 'ro.build.version.sdk').trim() !== '35') reject('EXPLICIT_API35_DEVICE_REQUIRED');
  const hashes = [record.build.sha256, record.build.testPayloadSha256];
  for (const [index, pkg] of [TARGET, TEST].entries()) {
    const lines = device('shell', 'pm', 'path', pkg).trim().split('\n');
    if (lines.length !== 1 || !/^package:\/data\/app\/[A-Za-z0-9_./=+\-]+\/base\.apk$/.test(lines[0])) reject('INSTALLED_PACKAGE_PATH_INVALID');
    const apk = execFileSync(adb, ['-s', serial, 'exec-out', 'cat', lines[0].slice(8)], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 128 * 1024 * 1024 });
    if (createHash('sha256').update(apk).digest('hex') !== hashes[index]) reject('INSTALLED_CANDIDATE_HASH_MISMATCH');
  }
  const suffix = nextCredentialAttempt(run);
  const observations = { schemaVersion: 1, serialHash: createHash('sha256').update(serial).digest('hex'), startedAt: new Date().toISOString(), baseline: {}, resume: {} };
  let activeChild=null, stopped='NONE';
  const onSignal=name=>()=>{ stopped=name; activeChild?.kill('SIGTERM'); };
  const handlers=Object.fromEntries(['SIGINT','SIGTERM','SIGHUP'].map(name=>[name,onSignal(name)]));
  for(const [name,handler] of Object.entries(handlers)) process.on(name,handler);
  const instrument=phase=>runCredentialInstrument({adb,serial,phase,allowTranslation:args['--allow-translation'],device,interrupted:()=>stopped!=='NONE',setActive:child=>{activeChild=child;}});
  try {
    await runCredentialWorkflow(observations,{device,instrument,interrupted:()=>stopped!=='NONE',signal:()=>stopped});
    // Finish leaves no credential entry screen open; a normal launch restores the user's UI.
    if(stopped==='NONE'&&!observations.baseline.entry) { try { device('shell','am','start','-n',`${TARGET}/com.listen2mobile.MainActivity`); } catch { /* Existing observations remain partial. */ } }
  } finally { for(const [name,handler] of Object.entries(handlers)) process.removeListener(name,handler); }
  const evidence = writeCredentialEvidence(run, suffix, observations);
  console.log(`${evidence.outcome}: ${evidence.recordId}; partial lifecycle coverage is retained. Credentials and installed data remain in place.`);
  if (evidence.outcome !== 'PASS') process.exitCode = 4;
}
if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  try { await main(); } catch (error) { console.error(`Credential acceptance rejected: ${/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SAFE_VALIDATION_FAILED'}.`); process.exitCode = 3; }
}
