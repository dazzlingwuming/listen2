import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCredentialOutput, assertCredentialObservations, credentialResults } from './credential-evidence.mjs';
import { parseCredentialArgs } from './run-credential-acceptance.mjs';
const observation = () => ({schemaVersion:1,serialHash:'a'.repeat(64),startedAt:new Date().toISOString(),baseline:{},resume:{}});
test('credential stdout accepts only fixed phase and status observations without persisting raw text',()=>{
  assert.deepEqual(parseCredentialOutput('unrelated private input\ncredential-observation=baseline:account:AUTHENTICATED\n','baseline'),{account:'AUTHENTICATED'});
  for(const output of ['credential-observation=baseline:account:PERSON_NAME','credential-observation=resume:account:AUTHENTICATED','credential-observation=baseline:account:AUTHENTICATED\ncredential-observation=baseline:account:AUTHENTICATED']) assert.throws(()=>parseCredentialOutput(output,'baseline'),/CREDENTIAL_OBSERVATION_INVALID/);
});
test('missing credentials and partial UI completion remain not verified',()=>{
  const value=observation();value.baseline={account:'NOT_AUTHENTICATED',configuration:'NOT_CONFIGURED'};
  assert.deepEqual(Object.values(credentialResults(value)),Array(4).fill('NOT_VERIFIED'));
  value.baseline={account:'AUTHENTICATED',configuration:'CONFIGURED',connection:'PASS',translation:'PASS'};
  assert.equal(credentialResults(value).accountRetained,'NOT_VERIFIED');
  value.resume={account:'AUTHENTICATED',configuration:'CONFIGURED'};
  assert.deepEqual(Object.values(credentialResults(value)),Array(4).fill('PASS'));
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
  assert.doesNotMatch(java,/dumpWindow|takeScreenshot|ACTION_SET_TEXT|ACTION_COPY|getClipboard|退出 Bilibili 登录|清除 DeepSeek API key|setText\(/);
  const runner=readFileSync(new URL('./run-credential-acceptance.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(runner,/['"]clear['"]|uninstall|logcat|screencap|uiautomator|run-as|delete-key|logout/);
  assert.match(runner,/'am', 'force-stop', TARGET/);assert.match(runner,/INSTALLED_CANDIDATE_HASH_MISMATCH/);
  const dispatch=readFileSync(new URL('../../android/app/src/androidTest/java/com/listen2mobile/acceptance/Phase08Instrumentation.java',import.meta.url),'utf8');
  assert.match(dispatch,/if \(!"com\.listen2mobile\.acceptance\.CredentialAcceptanceTest"\.equals\(requestedClass\)\) new AccessibilityDriver\(this\)\.captureFailureEvidence\(\)/);
});
