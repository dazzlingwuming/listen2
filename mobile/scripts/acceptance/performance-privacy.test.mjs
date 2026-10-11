import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { baseRecord } from './evidence.mjs';
import { sanitizePerformanceInstrumentation, sanitizePerformanceMemory, assertPerformanceMemory, performanceInstrumentationOk, liveFamilies, writePerformanceRecord } from './performance-evidence.mjs';
const ids=Array.from({length:20},(_,i)=>String(i+1).padStart(2,'0'));
const valid=ids.flatMap(id=>[`INSTRUMENTATION_STATUS: phase08Metric=first-search|${id}|PASS|4900|semantic-live-result`,`INSTRUMENTATION_STATUS: phase08Metric=first-audio|${id}|PASS|5900|visible-and-native-position-advancing`]).join('\n');
const rawMemory='** MEMINFO in pid 123 [com.dazzlingwuming.listen2] **\n App Summary\n Java Heap: 123 456\n Native Heap: 234 567\n TOTAL PSS: 1000 TOTAL RSS: 2000 TOTAL SWAP PSS: 0\nprivate-sentinel token=private-sentinel\n';
test('strict instrumentation sanitizer preserves all 20 metric slots, failure flags and fixed progress',()=>{
 const raw=`${valid}\nINSTRUMENTATION_STATUS: stage=live-performance-attempt-20\nINSTRUMENTATION_CODE: -1\naccount=private-sentinel token=private-sentinel`;
 const safe=sanitizePerformanceInstrumentation(raw,0);assert.doesNotMatch(safe,/private-sentinel/);assert.equal(sanitizePerformanceInstrumentation(safe),safe);assert.equal(performanceInstrumentationOk(safe),true);
 const before=liveFamilies(raw,1234),after=liveFamilies(safe,1234);assert.deepEqual(after,before);assert.equal(after.every(m=>m.samples.length===20&&m.status==='PASS'),true);
 const fail=sanitizePerformanceInstrumentation(`${raw}\nINSTRUMENTATION_STATUS: shortMsg=private-sentinel`,4);assert.doesNotMatch(fail,/private-sentinel/);assert.equal(sanitizePerformanceInstrumentation(fail),fail);assert.equal(performanceInstrumentationOk(fail),false);assert.equal(performanceInstrumentationOk(`${safe}INSTRUMENTATION_CODE: 1\n`),false);
 const malformed=sanitizePerformanceInstrumentation('phase08Metric=first-search|01|PASS|1|private-sentinel\nINSTRUMENTATION_CODE: -1',0);assert.equal(performanceInstrumentationOk(malformed),false);assert.equal(liveFamilies(malformed,1234)[0].samples[0].status,'NOT_VERIFIED');
 const failedSlot=sanitizePerformanceInstrumentation(raw.replace('first-search|20|PASS','first-search|20|TIMEOUT'),0);assert.equal(liveFamilies(failedSlot,1234)[0].samples[19].status,'TIMEOUT');
});
test('memory sanitizer exports only exact target scope and numeric known statistics',()=>{
 const value=sanitizePerformanceMemory(rawMemory);assertPerformanceMemory(value);assert.equal(value.status,'PASS');assert.equal(value.values['TOTAL PSS'],1000);assert.equal(value.values['TOTAL RSS'],2000);assert.equal(value.values['TOTAL SWAP PSS'],0);assert.doesNotMatch(JSON.stringify(value),/private-sentinel|pid/);
 assert.equal(sanitizePerformanceMemory(`${rawMemory}\n** MEMINFO in pid 99 [other.app] **\n TOTAL PSS: 9999`).values['TOTAL PSS'],1000);
 assert.equal(sanitizePerformanceMemory(rawMemory.replace('com.dazzlingwuming.listen2','other.app')).status,'NOT_VERIFIED');
 assert.throws(()=>assertPerformanceMemory({...value,privateField:'private-sentinel'}),/not sanitized/);assert.throws(()=>assertPerformanceMemory({...value,values:{privateField:1}}),/not sanitized/);
});
test('actual writer rejects raw inputs and indexes only verified safe metric and memory files',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'listen2-perf-privacy-'));const run=resolve(root,'phase08-20261011T000000Z-aaaaaaaaaaaa');mkdirSync(resolve(run,'performance'),{recursive:true});
 try {
 const build=baseRecord(run,'phase8-build',['REL-001']);writeFileSync(resolve(run,'08-build.json'),JSON.stringify(build));
 const put=(name,value)=>writeFileSync(resolve(run,'performance',name),typeof value==='string'?value:JSON.stringify(value));
 put('api35-cold.tsv',ids.map(id=>`${id}|PASS|true|9000|2900|3000|3900|COLD|none`).join('\n'));put('api35-instrumentation.txt',`${valid}\nprivate-sentinel`);put('resources-meminfo.txt',sanitizePerformanceMemory(rawMemory));put('recovery.json',[]);put('soak.json',[]);put('network.json',{});put('synthetic-media.json',{sha256:'a'.repeat(64)});
 const write=()=>writePerformanceRecord(run,new Date().toISOString(),'b'.repeat(64),1234,'restored');assert.throws(write,/not sanitized/);
 put('api35-instrumentation.txt',sanitizePerformanceInstrumentation(`${valid}\nINSTRUMENTATION_CODE: -1\nprivate-sentinel`,0));put('resources-meminfo.txt',rawMemory);assert.throws(write);
 put('resources-meminfo.txt',sanitizePerformanceMemory(rawMemory));write();const record=JSON.parse(readFileSync(resolve(run,'.api35-performance.json'),'utf8'));
 assert.equal(record.metrics[2].samples.length,20);assert.equal(record.metrics[2].status,'PASS');assert.equal(record.outcome,'NOT_VERIFIED');assert.equal(record.artifacts.find(a=>a.kind==='resources-meminfo.txt').sanitized,true);
 for(const item of record.artifacts)assert.doesNotMatch(readFileSync(resolve(run,item.relativePath),'utf8'),/private-sentinel/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('actual runner instrument function filters raw adb stdout before writing evidence',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'listen2-perf-runner-'));try{
 const runner=readFileSync(new URL('./run-performance-recovery.sh',import.meta.url),'utf8');const body=runner.match(/instrument\(\) \{[\s\S]*?\n\}/)[0];const fake=resolve(root,'fake-adb'),out=resolve(root,'safe.txt');writeFileSync(fake,`#!/bin/bash\ncat <<'TEXT'\n${valid}\nINSTRUMENTATION_CODE: -1\nprivate-sentinel\nTEXT\n`,{mode:0o700});
 const quote=v=>`'${v.replaceAll("'","'\\''")}'`;execFileSync('bash',['-c',`${body}\nADB=${quote(fake)}; SERIAL=fixture; DEVICE_API=35; TEST_PACKAGE=fixture; instrument fixture ${quote(out)}`],{cwd:resolve(import.meta.dirname,'../../..')});const safe=readFileSync(out,'utf8');assert.doesNotMatch(safe,/private-sentinel/);assert.equal(performanceInstrumentationOk(safe),true);assert.equal(liveFamilies(safe,0)[0].samples.length,20);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('local audio diagnostics accept only closed tuples, bounded clocks and preserve failure',()=>{
 const terminal='\nINSTRUMENTATION_CODE: -1';
 const tuples=['NOT_VERIFIED|0|audio-resume-anchor-unavailable','NOT_VERIFIED|12|audio-observation-clock-invalid','FAIL|12|audio-resume-position-rollback','TIMEOUT|6000|audio-pair-unavailable','PASS|5900|visible-and-native-position-advancing','FAIL|12|audio-initial-tap-failed','FAIL|12|audio-mini-tap-failed','FAIL|12|audio-notification-failed','FAIL|12|audio-native-shell-failed','FAIL|12|audio-unknown-assert','FAIL|12|audio-resume-control-failed','TIMEOUT|6000|audio-ui-progress-unavailable','TIMEOUT|6000|audio-native-getter-unavailable','TIMEOUT|6000|audio-playing-identity-unavailable','TIMEOUT|6000|audio-not-advancing','NOT_VERIFIED|0|diagnostic-elapsed-out-of-range'];
 for(const tuple of tuples){const safe=sanitizePerformanceInstrumentation('INSTRUMENTATION_STATUS: phase08LocalAudio='+tuple+terminal,0);assert.match(safe,/phase08LocalAudio=/);assert.equal(sanitizePerformanceInstrumentation(safe),safe);assert.equal(performanceInstrumentationOk(safe),tuple.startsWith('PASS|'));}
 for(const tuple of ['PASS|1|audio-not-advancing','FAIL|1|visible-and-native-position-advancing','PASS|120001|visible-and-native-position-advancing','PASS|-1|visible-and-native-position-advancing','PASS|1|private-sentinel','NOT_VERIFIED|1|diagnostic-elapsed-out-of-range','PASS|1|visible-and-native-position-advancing|private-sentinel']){const safe=sanitizePerformanceInstrumentation('phase08LocalAudio='+tuple+terminal,0);assert.doesNotMatch(safe,/phase08LocalAudio=|private-sentinel/);assert.equal(performanceInstrumentationOk(safe),false);}
 for(const stage of ['initial-tap-complete','first-observation']){const raw='phase08LocalTiming='+stage+'|120000|999999999999'+terminal;const safe=sanitizePerformanceInstrumentation(raw,0);assert.match(safe,/phase08LocalTiming=/);assert.equal(sanitizePerformanceInstrumentation(safe),safe);}
 for(const tuple of ['private-sentinel|1|2','first-observation|120001|2','first-observation|1|-1','first-observation|1|1000000000000','first-observation|1|2|private-sentinel']){const safe=sanitizePerformanceInstrumentation('phase08LocalTiming='+tuple+terminal,0);assert.doesNotMatch(safe,/phase08LocalTiming=|private-sentinel/);assert.equal(performanceInstrumentationOk(safe),false);}
});

test('preparation diagnostics expose only closed navigation stages and monotonic numbers',()=>{
 const terminal='\nINSTRUMENTATION_CODE: -1';
 for(const stage of ['start','close-player','back-detail','shell-ready','navigation-limit','action-failed','deadline-exceeded']){const safe=sanitizePerformanceInstrumentation('phase08LocalPreparation='+stage+'|999999999999'+terminal,0);assert.match(safe,/phase08LocalPreparation=/);assert.equal(sanitizePerformanceInstrumentation(safe),safe);assert.equal(performanceInstrumentationOk(safe),!['navigation-limit','action-failed','deadline-exceeded'].includes(stage));}
 for(const tuple of ['private-sentinel|1','shell-ready|-1','shell-ready|1000000000000','shell-ready|1|private-sentinel']){const safe=sanitizePerformanceInstrumentation('phase08LocalPreparation='+tuple+terminal,0);assert.doesNotMatch(safe,/phase08LocalPreparation=|private-sentinel/);assert.equal(performanceInstrumentationOk(safe),false);}
});

test('SDK failure types remain closed diagnostic failures without exception text',()=>{
 for(const type of ['PatternSyntaxException','IllegalStateException','IllegalArgumentException','NullPointerException','SecurityException','NoSuchMethodError','NoClassDefFoundError','AbstractMethodError','AssertionError','Exception']){const safe=sanitizePerformanceInstrumentation('INSTRUMENTATION_STATUS: failureType='+type+'\nINSTRUMENTATION_CODE: 0',0);assert.match(safe,new RegExp('failureType='+type));assert.equal(sanitizePerformanceInstrumentation(safe),safe);assert.equal(performanceInstrumentationOk(safe),false);}
 for(const raw of ['INSTRUMENTATION_STATUS: failureType=private-sentinel','INSTRUMENTATION_STATUS: failureType=PatternSyntaxException private-sentinel','INSTRUMENTATION_STATUS: failureType=CustomPrivateSentinelException']){const safe=sanitizePerformanceInstrumentation(raw+'\nINSTRUMENTATION_CODE: 0',0);assert.doesNotMatch(safe,/private-sentinel|CustomPrivateSentinel/);assert.match(safe,/failureType=EvidencePrivacyOrScenarioFailure/);assert.equal(performanceInstrumentationOk(safe),false);}
});

test('synthetic observation diagnostics contain bounded numeric and boolean tuples only',()=>{
 const terminal='\nINSTRUMENTATION_CODE: -1';const valid=['1|0|-1|-1|-1|-1|false|false|false','32|120000|604800|604800|604800000|604800000|true|true|true'];
 for(const row of valid){const safe=sanitizePerformanceInstrumentation('phase08LocalObservation='+row+terminal,0);assert.match(safe,/phase08LocalObservation=/);assert.equal(sanitizePerformanceInstrumentation(safe),safe);}
 for(const row of ['0|0|0|0|0|0|true|true|true','33|0|0|0|0|0|true|true|true','1|120001|0|0|0|0|true|true|true','1|0|-2|0|0|0|true|true|true','1|0|604801|0|0|0|true|true|true','1|0|0|0|604800001|0|true|true|true','1|0|0|0|0|0|1|true|true','1|0|0|0|0|0|true|true|private-sentinel','1|0|0|0|0|0|true|true|true|private-sentinel']){const safe=sanitizePerformanceInstrumentation('phase08LocalObservation='+row+terminal,0);assert.doesNotMatch(safe,/phase08LocalObservation=|private-sentinel/);assert.equal(performanceInstrumentationOk(safe),false);}
 for(const reason of ['sample-limit','diagnostic-values-out-of-range']){const safe=sanitizePerformanceInstrumentation('phase08LocalObservationStatus=NOT_VERIFIED|'+reason+terminal,0);assert.match(safe,/phase08LocalObservationStatus=/);assert.equal(performanceInstrumentationOk(safe),false);}
 const unknown=sanitizePerformanceInstrumentation('phase08LocalObservationStatus=PASS|private-sentinel'+terminal,0);assert.doesNotMatch(unknown,/private-sentinel|phase08LocalObservationStatus=/);assert.equal(performanceInstrumentationOk(unknown),false);
});

 test('generic preconditions remain closed and unverified metrics cannot become PASS', () => {
  for (const value of ['paused-existing', 'no-existing-session']) assert.match(sanitizePerformanceInstrumentation(`INSTRUMENTATION_STATUS: phase08AudioPrecondition=${value}`, 0), new RegExp(value));
  for (const value of ['private-sentinel', 'paused-existing private-sentinel']) { const safe = sanitizePerformanceInstrumentation(`INSTRUMENTATION_STATUS: phase08AudioPrecondition=${value}`, 0); assert.doesNotMatch(safe, /private-sentinel/); assert.match(safe, /EvidencePrivacyOrScenarioFailure/); }
  for (const reason of ['audio-selection-ambiguous', 'audio-precondition-unverified', 'audio-metadata-unverified']) {
    assert.match(sanitizePerformanceInstrumentation(`phase08Metric=first-audio|01|NOT_VERIFIED|0|${reason}`, 0), /first-audio\|01\|NOT_VERIFIED/);
    assert.doesNotMatch(sanitizePerformanceInstrumentation(`phase08Metric=first-audio|01|PASS|0|${reason}`, 0), /first-audio\|01\|PASS/);
  }
 });

 test('search preparation exposes only closed stages and bounded numeric monotonic values', () => {
  for (const stage of ['start','close-player','back-detail','shell-ready','navigation-limit','action-failed','deadline-exceeded','search-tab-tap','input-wait','input-ready','source-qq','source-kugou','sources-ready']) assert.match(sanitizePerformanceInstrumentation(`phase08SearchPreparation=${stage}|12345`,0), /phase08SearchPreparation=/);
  for (const row of ['private-sentinel|12345','input-ready|private-sentinel','input-ready|1234567890123']) {const safe=sanitizePerformanceInstrumentation(`phase08SearchPreparation=${row}`,0);assert.doesNotMatch(safe,/private-sentinel|phase08SearchPreparation=/);assert.match(safe,/EvidencePrivacyOrScenarioFailure/);}
 });

test('fixed public input diagnostics reject unknown values and never carry input text',()=>{
 for(const value of ['field-unavailable','existing-fixed-query','focus-already','focus-requested','focus-action-failed','set-action-failed','set-action-complete','retained','retained-mismatch'])assert.match(sanitizePerformanceInstrumentation('phase08FixedInput='+value,0),/phase08FixedInput=/);
 for(const value of ['private-sentinel','retained private-sentinel','青花瓷']){const safe=sanitizePerformanceInstrumentation('phase08FixedInput='+value,0);assert.doesNotMatch(safe,/phase08FixedInput=|private-sentinel|青花瓷/);assert.match(safe,/EvidencePrivacyOrScenarioFailure/);}
 for(const value of ['1|PASS','2|PASS'])assert.match(sanitizePerformanceInstrumentation('phase08FixedInputSample='+value,0),/phase08FixedInputSample=/);
 for(const value of ['0|PASS','3|PASS','1|private-sentinel','1|PASS|private-sentinel'])assert.doesNotMatch(sanitizePerformanceInstrumentation('phase08FixedInputSample='+value,0),/phase08FixedInputSample=|private-sentinel/);
});
