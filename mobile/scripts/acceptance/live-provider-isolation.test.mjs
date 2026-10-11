import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { providerOutcomes } from './live-provider-outcomes.mjs';

// Execute the actual Java scenario with a deterministic UI boundary. This proves
// failure isolation and bounded diagnostic contracts, not live network availability.
const temporary = mkdtempSync(resolve(tmpdir(), 'listen2-provider-isolation-'));
const sources = {
  'android/app/Instrumentation.java': 'package android.app; public class Instrumentation {}',
  'com/listen2mobile/acceptance/AccessibilityDriver.java': `package com.listen2mobile.acceptance;
import java.util.*;
final class AccessibilityDriver {
 static final String[] SOURCES={"网易云音乐","酷狗音乐","酷我音乐","QQ音乐","哔哩哔哩"};
 static String mode; static int next, current, captures, taps;
 static int[] submits, outcomes; static List<String> events, operations;
 AccessibilityDriver(android.app.Instrumentation i) {}
 static void reset(String value) { mode=value; next=0;current=-1;captures=0;taps=0;submits=new int[5];outcomes=new int[5];events=new ArrayList<>();operations=new ArrayList<>(); }
 static void check(boolean b) { if(!b)throw new AssertionError("fixture-contract"); }
 static void fail(String step) {
  boolean hit=(mode.equals("first")&&current==0&&step.equals("outcome")) ||
   (mode.equals("middle")&&current==2&&step.equals("outcome")) ||
   (mode.equals("multiple")&&(current==0||current==3)&&step.equals("outcome")) ||
   (mode.equals("all")&&step.equals("outcome")) ||
   (mode.equals("runtime")&&current==1&&step.equals("outcome")) ||
   (mode.equals("prepare")&&current==0&&step.equals("query")) ||
   (mode.equals("submit")&&current==2&&step.equals("submit"));
  if(hit) { if(mode.equals("runtime"))throw new IllegalStateException("private-sentinel content://private/secret");throw new AssertionError("private-sentinel content://private/secret"); }
 }
 void launchTarget() { if(mode.equals("fatal"))throw new LinkageError("private-sentinel"); }
 boolean waitForLabel(String s,long timeout) { check(timeout==20000L||timeout==10000L);return true; }
 void tapLabel(String s) { check(s.equals("搜索"));current=next++;taps++;operations.add("tap"+current); }
 void enterText(String s,String q) { check(s.equals("搜索歌曲、歌手或歌单")&&q.equals("青花瓷"));operations.add("query"+current);fail("query"); }
 void selectLiveSource(String source) { check(source.equals(SOURCES[current]));operations.add("source"+current); }
 void submitLiveSearch() { check(++submits[current]==1);operations.add("submit"+current);fail("submit"); }
 void outcome(String kind) { outcomes[current]++;operations.add(kind+current);fail("outcome");
  record(mode.equals("restrictions")&&(current==0||current==4)?"live-search-upstream-restriction-"+SOURCES[current]:"live-search-results-"+SOURCES[current]+"-1"); }
 void requireLiveNeteaseSearchOutcome() { check(current==0);outcome("netease"); }
 void requireLiveBilibiliSearchOutcome() { check(current==4);outcome("bilibili"); }
 void requireLiveSearchResults(String source) { check(current>0&&current<4&&source.equals(SOURCES[current]));outcome("ordinary"); }
 void record(String event) { events.add("acceptance-event="+event); }
 void captureLiveProviderEvidence() { check(taps==5);captures++;operations.add("capture");if(mode.equals("capture"))throw new IllegalStateException("private-sentinel"); }
}`,
  'com/listen2mobile/acceptance/ProviderIsolationFixture.java': `package com.listen2mobile.acceptance;
public final class ProviderIsolationFixture {
 public static void main(String[] args) {
  for(String mode:new String[]{"success","restrictions","first","middle","multiple","all","runtime","prepare","submit","capture","fatal"}) {
   AccessibilityDriver.reset(mode);ScenarioProgress progress=new ScenarioProgress();boolean failed=false;
   try { LiveAllProviderSearchSmokeTest.run(new android.app.Instrumentation(),progress); }
   catch(AssertionError error) { failed=true;AccessibilityDriver.check("live-all-provider-matrix-failed".equals(error.getMessage())); }
   catch(LinkageError error) { AccessibilityDriver.check(mode.equals("fatal"));failed=true; }
   AccessibilityDriver.check(failed==!(mode.equals("success")||mode.equals("restrictions")));
   if(mode.equals("fatal")) { AccessibilityDriver.check(AccessibilityDriver.taps==0);continue; }
   AccessibilityDriver.check(AccessibilityDriver.taps==5&&AccessibilityDriver.captures==1);
   AccessibilityDriver.check(AccessibilityDriver.operations.get(AccessibilityDriver.operations.size()-1).equals("capture"));
   for(int i=0;i<5;i++) {
    AccessibilityDriver.check(AccessibilityDriver.submits[i]==(mode.equals("prepare")&&i==0?0:1));
    int expectedOutcome=(mode.equals("prepare")&&i==0)||(mode.equals("submit")&&i==2)?0:1;
    AccessibilityDriver.check(AccessibilityDriver.outcomes[i]==expectedOutcome);
    int tap=AccessibilityDriver.operations.indexOf("tap"+i),query=AccessibilityDriver.operations.indexOf("query"+i);
    AccessibilityDriver.check(tap>=0&&query>tap);
    if(!(mode.equals("prepare")&&i==0)) {
     int source=AccessibilityDriver.operations.indexOf("source"+i),submit=AccessibilityDriver.operations.indexOf("submit"+i);
     AccessibilityDriver.check(source>query&&submit>source);
    }
   }
   for(String event:AccessibilityDriver.events) {
    AccessibilityDriver.check(!event.contains("private")&&!event.contains("content:")&&!event.contains("secret"));
    if(event.contains("-failed-"))AccessibilityDriver.check(event.matches("acceptance-event=live-all-source-(netease|kugou|kuwo|qq|bilibili)-failed-(search-tab|query|source|submit|outcome)-(assertion|runtime)"));
   }
   if(failed)AccessibilityDriver.check(progress.currentStep().equals("live-all-aggregate-failed"));
   if(mode.equals("first")||mode.equals("restrictions")) {
    System.out.println("CASE="+mode);
    for(String event:AccessibilityDriver.events)System.out.println(event);
   }
  }
 }
}`,
};
try {
  for (const [relative, source] of Object.entries(sources)) {
    const path = resolve(temporary, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source);
  }
  const binary = name => resolve(process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17', 'bin', name);
  const native = resolve(import.meta.dirname, '../../android/app/src/androidTest/java/com/listen2mobile/acceptance');
  execFileSync(binary('javac'), ['-encoding', 'UTF-8', '-d', temporary, ...Object.keys(sources).map(path => resolve(temporary, path)), resolve(native, 'LiveAllProviderSearchSmokeTest.java'), resolve(native, 'ScenarioProgress.java')], { stdio: 'pipe' });
  const output = execFileSync(binary('java'), ['-cp', temporary, 'com.listen2mobile.acceptance.ProviderIsolationFixture'], { encoding: 'utf8' });
  assert.doesNotMatch(output, /private-sentinel|content:\/\/private|secret/u);
  const cases = Object.fromEntries(output.trim().split('CASE=').filter(Boolean).map(value => { const [name, ...events] = value.split('\n'); return [name, events.join('\n')]; }));
  assert.deepEqual(providerOutcomes(cases.first, 'live-all-providers').map(row => row.status), ['NOT_VERIFIED', 'PASS', 'PASS', 'PASS', 'PASS']);
  assert.deepEqual(providerOutcomes(cases.restrictions, 'live-all-providers').map(row => row.status), ['DEGRADED', 'PASS', 'PASS', 'PASS', 'DEGRADED']);
  // Exercise the runner's actual sanitizer rather than duplicating its policy.
  const runner = readFileSync(resolve(import.meta.dirname, 'run-live-provider-smoke.sh'), 'utf8');
  const sanitizer = runner.match(/sanitize_log\(\) \{[\s\S]*?<<'NODE'\n([\s\S]*?)\nNODE/u)?.[1];
  assert.ok(sanitizer, 'existing sanitizer entrypoint must remain discoverable');
  const raw = resolve(temporary, 'raw.txt'), safe = resolve(temporary, 'safe.txt');
  writeFileSync(raw, output);
  execFileSync(process.execPath, ['--input-type=module', '-', raw, safe], { input: sanitizer, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(readFileSync(safe, 'utf8'), output, 'closed events must survive the existing sanitizer');
  console.log('Five-provider actual Java isolation passed: once-only submissions, later sources, fixed failures, aggregate failure, restrictions, sanitizer and outcome parser.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
