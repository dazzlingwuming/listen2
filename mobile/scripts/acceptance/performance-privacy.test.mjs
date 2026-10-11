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
