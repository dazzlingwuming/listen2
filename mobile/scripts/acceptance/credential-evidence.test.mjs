import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseCredentialOutput, assertCredentialObservations, credentialResults, emptyCredentialNetwork } from './credential-evidence.mjs';
import { parseCredentialArgs, withCredentialOfflineNetwork, runCredentialWorkflow, runCredentialInstrument } from './run-credential-acceptance.mjs';
const observation = () => ({schemaVersion:1,serialHash:'a'.repeat(64),startedAt:new Date().toISOString(),baseline:{},resume:{}});
test('credential stdout accepts only fixed phase and status observations without persisting raw text',()=>{
  assert.deepEqual(parseCredentialOutput('unrelated private input\ncredential-observation=baseline:account:AUTHENTICATED\n','baseline'),{account:'AUTHENTICATED'});
  for(const output of ['credential-observation=baseline:account:PERSON_NAME','credential-observation=resume:account:AUTHENTICATED','credential-observation=baseline:account:AUTHENTICATED\ncredential-observation=baseline:account:AUTHENTICATED']) assert.throws(()=>parseCredentialOutput(output,'baseline'),/CREDENTIAL_OBSERVATION_INVALID/);
});
test('missing credentials and partial UI completion remain not verified',()=>{
  const value=observation();value.baseline={account:'NOT_AUTHENTICATED',configuration:'NOT_CONFIGURED'};
  assert.deepEqual(Object.values(credentialResults(value)),Array(7).fill('NOT_VERIFIED'));
  value.baseline={account:'AUTHENTICATED',configuration:'CONFIGURED',connection:'PASS',translation:'PASS'};
  assert.equal(credentialResults(value).accountRetained,'NOT_VERIFIED');
  value.resume={account:'AUTHENTICATED',configuration:'CONFIGURED'};
  assert.deepEqual(Object.values(credentialResults(value)).slice(0,4),Array(4).fill('PASS'));
  Object.assign(value,completedBilibili());assert.deepEqual(Object.values(credentialResults(value)),Array(7).fill('PASS'));
  assert.throws(()=>assertCredentialObservations({...value,accountIdentity:'forbidden'}),/SCHEMA_INVALID/);
  assert.throws(()=>assertCredentialObservations({...value,baseline:{...value.baseline,entry:'IN_PROGRESS'}}),/OBSERVATION_INVALID/);
  assert.throws(()=>assertCredentialObservations({...value,resume:{connection:'PASS'}}),/OBSERVATION_INVALID/);
});
test('runner requires explicit serial and has no credential or destructive options',()=>{
  assert.deepEqual(parseCredentialArgs(['--run-dir','run','--serial','emulator-5554','--allow-translation']),{'--run-dir':'run','--serial':'emulator-5554','--allow-translation':true});
  for(const args of [['--run-dir','run'],['--run-dir','run','--serial','x','--api-key','private'],['--run-dir','run','--serial','x','--clear'],['--run-dir','run','--serial','x','--install'],['--run-dir','run','--serial','x','--serial','x']]) assert.throws(()=>parseCredentialArgs(args));
});
test('credential instrumentation uses bounded UI status without capture or destructive controls',()=>{
  const java=readFileSync(new URL('../../android/app/src/androidTest/java/com/listen2mobile/acceptance/CredentialAcceptanceTest.java',import.meta.url),'utf8');
  assert.match(java,/node\.isPassword\(\)/);assert.match(java,/if \(label == null \|\| node\.isEditable\(\) \|\| node\.isPassword\(\)\) return false/);assert.match(java,/count\[0\] > 800/);assert.match(java,/credential-observation=/);
  assert.match(java,/ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "青花瓷"/);
  const fixedInput=java.slice(java.indexOf('boolean setFixedSearchQuery()'),java.indexOf('void collectInputs('));
  assert.match(fixedInput,/if \(!waitSelected\("搜索", 5_000L\) \|\| !waitLabel\("搜索音乐", false, 5_000L\)\) return false/);
  assert.ok(fixedInput.indexOf('waitSelected("搜索"')<fixedInput.indexOf('collectInputs(root'));
  assert.ok(fixedInput.indexOf('waitLabel("搜索音乐"')<fixedInput.indexOf('ACTION_SET_TEXT'));
  const inputCollector=java.slice(java.indexOf('void collectInputs('),java.indexOf('String waitPublicValue('));assert.doesNotMatch(inputCollector,/getText|getContentDescription/);
  assert.doesNotMatch(java,/dumpWindow|takeScreenshot|ACTION_COPY|getClipboard|退出 Bilibili 登录|清除 DeepSeek API key|setText\(/);
  const runner=readFileSync(new URL('./run-credential-acceptance.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(runner,/['"]clear['"]|uninstall|logcat|screencap|uiautomator|run-as|delete-key|logout/);
  assert.match(runner,/'am',\s*'force-stop',\s*TARGET/);assert.match(runner,/INSTALLED_CANDIDATE_HASH_MISMATCH/);
  const dispatch=readFileSync(new URL('../../android/app/src/androidTest/java/com/listen2mobile/acceptance/Phase08Instrumentation.java',import.meta.url),'utf8');
  assert.match(dispatch,/if \(!"com\.listen2mobile\.acceptance\.CredentialAcceptanceTest"\.equals\(requestedClass\)\) new AccessibilityDriver\(this\)\.captureFailureEvidence\(\)/);
});

function completedBilibili(){return {playback:{account:'AUTHENTICATED',selection:'UNIQUE_P1',playback:'PLAYING_ADVANCING',download:'READY_CHECKED',positionstartms:1000,positionendms:4000},offline:{playback:'PLAYING_ADVANCING',download:'READY_CHECKED',positionstartms:4000,positionendms:7000},network:{...emptyCredentialNetwork(),originalWifi:1,originalData:1,offlineWifi:0,offlineData:0,defaultNetworkAbsent:true,restoredWifi:1,restoredData:1,restoreStatus:'RESTORED'}};}
function fakeNetwork(wifi=1,data=1){const state={wifi,data},calls=[];return {state,calls,device:(...args)=>{calls.push(args.join(' '));if(args[1]==='settings')return String(args.at(-1)==='wifi_on'?state.wifi:state.data);if(args[1]==='svc'){state[args[2]==='wifi'?'wifi':'data']=args[3]==='enable'?1:0;return '';}if(args[1]==='dumpsys')return state.wifi===0&&state.data===0?'Active default network: none\n':'Active default network: 100\n';return '';}};}
test('Bili progress parsing accepts only phase-specific enums and bounded numeric observations',()=>{
 assert.deepEqual(parseCredentialOutput('INSTRUMENTATION_STATUS: stream=credential-observation=playback:positionstartms:1000','playback'),{positionstartms:1000});
 for(const line of ['credential-observation=playback:positionstartms:1000 private-sentinel','credential-observation=offline:account:AUTHENTICATED','credential-observation=playback:positionendms:999999999999','credential-observation=playback:selection:CID_VERIFIED'])assert.throws(()=>parseCredentialOutput(line,line.includes('offline:')?'offline':'playback'),/INVALID/);
 const value={...observation(),...completedBilibili()};value.baseline={account:'AUTHENTICATED',configuration:'CONFIGURED',connection:'PASS',translation:'PASS'};value.resume={account:'AUTHENTICATED',configuration:'CONFIGURED'};assert.equal(credentialResults(value).offlineRestart,'PASS');
 value.offline.positionendms=value.offline.positionstartms;assert.equal(credentialResults(value).offlineRestart,'NOT_VERIFIED');value.offline.positionendms=7000;value.network.defaultNetworkAbsent=false;assert.equal(credentialResults(value).offlineRestart,'NOT_VERIFIED');
});
test('offline network cleanup restores each original state after probe exception or interruption',async()=>{
 for(const [wifi,data] of [[1,1],[1,0],[0,1],[0,0]]){const fake=fakeNetwork(wifi,data);let probed=false;const network=await withCredentialOfflineNetwork(fake.device,async()=>{probed=true;throw new Error('private-sentinel');});assert.equal(probed,true);assert.equal(network.restoreStatus,'RESTORED');assert.deepEqual(fake.state,{wifi,data});assert.doesNotMatch(JSON.stringify(network),/private-sentinel/);}
 const fake=fakeNetwork();let interrupted=false;const network=await withCredentialOfflineNetwork(fake.device,async()=>{interrupted=true;},{interrupted:()=>interrupted,signal:()=>interrupted?'SIGINT':'NONE'});assert.equal(network.signal,'SIGINT');assert.equal(network.restoreStatus,'RESTORED');assert.deepEqual(fake.state,{wifi:1,data:1});
});
test('partial toggle failure restores both services; unknown snapshot and active default network never run offline probe',async()=>{
 const fake=fakeNetwork();let failed=false;const device=(...args)=>{if(args.join(' ')==='shell svc data disable'&&!failed){failed=true;throw new Error('toggle-failed');}return fake.device(...args);};const result=await withCredentialOfflineNetwork(device,async()=>assert.fail('must not probe'));assert.equal(result.restoreStatus,'RESTORED');assert.equal(fake.calls.includes('shell svc wifi enable'),true);assert.equal(fake.calls.includes('shell svc data enable'),true);
 const unknown=fakeNetwork();const network=await withCredentialOfflineNetwork((...args)=>args.at(-1)==='mobile_data'?'unknown':unknown.device(...args),async()=>assert.fail('must not probe'));assert.equal(network.restoreStatus,'NOT_REQUESTED');assert.equal(unknown.calls.some(call=>call.includes(' svc ')),false);
 const active=fakeNetwork();const denied=await withCredentialOfflineNetwork((...args)=>args[1]==='dumpsys'?'Active default network: 100':active.device(...args),async()=>assert.fail('must not probe'),{pause:async()=>{throw new Error('bounded-fixture-stop');}});assert.equal(denied.defaultNetworkAbsent,false);assert.equal(denied.restoreStatus,'RESTORED');
});
test('real workflow never toggles network for missing credentials and binds offline result to restoration',async()=>{
 const missing=fakeNetwork(),observations=observation();await runCredentialWorkflow(observations,{device:missing.device,instrument:async()=>({account:'NOT_AUTHENTICATED',configuration:'NOT_CONFIGURED'})});assert.equal(missing.calls.length,0);assert.equal(credentialResults(observations).offlineRestart,'NOT_VERIFIED');
 const fake=fakeNetwork(),value=observation(),complete=completedBilibili(),phases=[];await runCredentialWorkflow(value,{device:fake.device,instrument:async phase=>{phases.push(phase);return phase==='playback'?complete.playback:phase==='offline'?complete.offline:phase==='baseline'?{account:'AUTHENTICATED',configuration:'CONFIGURED',connection:'PASS',translation:'PASS'}:{account:'AUTHENTICATED',configuration:'CONFIGURED'};}});assert.deepEqual(phases,['baseline','playback','offline','resume']);assert.deepEqual(fake.state,{wifi:1,data:1});assert.equal(credentialResults(value).offlineRestart,'PASS');assert.equal(fake.calls.filter(call=>call==='shell am force-stop com.dazzlingwuming.listen2').length,2);
});

function fakeAdb(source){
 const directory=mkdtempSync(resolve(tmpdir(),'listen2-credential-subprocess-')),adb=resolve(directory,'adb-fixture');
 writeFileSync(adb,`#!${process.execPath}\n${source}`,{mode:0o700});return {adb,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
function instrumentDevice(network=fakeNetwork(),pid='1234'){return {...network,device:(...args)=>args[1]==='pidof'?pid:network.device(...args)};}
test('actual instrument subprocess retains only strict enum/numeric fields and requires no-restart same PID',async()=>{
 const fixture=fakeAdb(`if(!process.argv.includes('--no-restart'))process.exit(9);console.log('private-secret-sentinel');console.log('credential-observation=playback:account:AUTHENTICATED');console.log('credential-observation=playback:positionstartms:1000');console.log('credential-observation=playback:positionendms:4000');console.log('INSTRUMENTATION_CODE: -1');`);
 try {
  const fake=instrumentDevice(),result=await runCredentialInstrument({adb:fixture.adb,serial:'fixture-serial',phase:'playback',device:fake.device});
  assert.deepEqual(result,{account:'AUTHENTICATED',positionstartms:1000,positionendms:4000});assert.doesNotMatch(JSON.stringify(result),/secret-sentinel/);assert.equal(fake.calls[0],'shell am start -W -n com.dazzlingwuming.listen2/com.listen2mobile.MainActivity');
  let reads=0;assert.deepEqual(await runCredentialInstrument({adb:fixture.adb,serial:'fixture-serial',phase:'playback',device:(...args)=>args[1]==='pidof'?String(++reads===1?1234:5678):fake.device(...args)}),{});
 } finally {fixture.cleanup();}
 const malformed=fakeAdb(`console.log('credential-observation=playback:account:AUTHENTICATED private-secret-sentinel');console.log('INSTRUMENTATION_CODE: -1');`);
 try {assert.deepEqual(await runCredentialInstrument({adb:malformed.adb,serial:'fixture-serial',phase:'playback',device:instrumentDevice().device}),{});}finally{malformed.cleanup();}
});
test('actual subprocess timeout and signal fail closed while offline finally restores original network',async()=>{
 const fixture=fakeAdb(`setInterval(()=>{},1000);`);
 try {
  for(const mode of ['timeout','signal']){
   const fake=instrumentDevice(fakeNetwork(1,0));let stopped=false,observation;
   const network=await withCredentialOfflineNetwork(fake.device,async()=>{
    observation=await runCredentialInstrument({adb:fixture.adb,serial:'fixture-serial',phase:'offline',device:fake.device,timeoutMs:mode==='timeout'?50:5000,interrupted:()=>stopped,setActive:child=>{if(child&&mode==='signal')setTimeout(()=>{stopped=true;child.kill('SIGTERM');},50);}});
   },{interrupted:()=>stopped,signal:()=>stopped?'SIGTERM':'NONE'});
   assert.deepEqual(observation,{});assert.equal(network.restoreStatus,'RESTORED');assert.deepEqual(fake.state,{wifi:1,data:0});assert.equal(network.signal,mode==='signal'?'SIGTERM':'NONE');assert.equal(fake.calls.includes('shell am force-stop com.dazzlingwuming.listen2'),true);
  }
 } finally{fixture.cleanup();}
});
