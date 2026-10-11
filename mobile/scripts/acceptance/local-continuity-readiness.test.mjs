import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const base=resolve(import.meta.dirname,'../../android/app/src/androidTest/java/com/listen2mobile/acceptance');
const source=readFileSync(resolve(base,'AccessibilityDriver.java'),'utf8');
const start=source.indexOf('    /** Read-only continuity preparation,');
assert.ok(start>0);
const methods=source.slice(start,source.indexOf('    private static boolean targetSessionPlaying',start));
const entrySource=readFileSync(resolve(base,'PerformanceRecoveryTest.java'),'utf8');
const entry=entrySource.slice(entrySource.indexOf('    public static void awaitLocalContinuity('),entrySource.indexOf('    public static void resumeLocal('));
const representative=process.argv.includes('--representative');
const firstAudioMethods=source.slice(source.indexOf('    private PerformanceSample observeVisibleAudioAdvancement('),source.indexOf('    /** Preparation only:'));
const java=`import java.util.*;import java.nio.charset.StandardCharsets;
public class AccessibilityDriver {
 static String mode;static long tick;static int reads,actions;final Instrumentation instrumentation;
 AccessibilityDriver(Instrumentation i){instrumentation=i;}
 static class SystemClock {static long elapsedRealtime(){return tick;}static void sleep(long n){tick+=n;}}
 static class Bundle {String value;void putString(String key,String v){value=key+"="+v;}}
 static class Instrumentation {List<String> rows=new ArrayList<>();void sendStatus(int c,Bundle b){rows.add(b.value);}}
 static class ScenarioProgress {List<String> stages=new ArrayList<>();void step(String s){stages.add(s);}}
 static class Entry {${entry}}
 static class PerformanceSample {String status,reason;long elapsedMillis;PerformanceSample(String s,long e,String r,Object ignored){status=s;elapsedMillis=e;reason=r;}}
 static class NativePlaybackObservation {
  static class Sample {long positionMs,elapsedMs;boolean available;Sample(boolean a){available=a;positionMs=position();elapsedMs=tick;}
   boolean observed(){return available&&!mode.equals("missing-getter");}static Sample unavailable(){return new Sample(false);}}
  static Sample read(Instrumentation i){reads++;if(mode.equals("span"))tick+=501;return new Sample(true);}
 }
 static long position(){return mode.equals("static")?60000:60000+tick;}
 static String control(String label){return "<node content-desc=\\\""+label+"\\\" enabled=\\\"true\\\" clickable=\\\"true\\\"/>";}
 String dumpWindow(){tick+=100;if(mode.equals("exception"))throw new AssertionError("private-sentinel");if(mode.equals("overshoot"))tick=15001;
  boolean ready=!mode.equals("late")||tick>=7000;return "<hierarchy>"+(ready&&!mode.equals("missing-ui")?control("关闭播放器")+"<node text=\\\"Listen2AcceptanceSignal\\\"/>":"")+"</hierarchy>";}
 Long progressPosition(String window){return window.contains("关闭播放器")?(mode.equals("coherence")?0L:position()/1000):null;}
 String shell(String command){if(!command.equals("dumpsys media_session"))throw new AssertionError("non-readonly-command");String title=mode.equals("wrong-synthetic")?"DifferentSignal":"Listen2AcceptanceSignal";
  return "package=com.dazzlingwuming.listen2\\nPlaybackState {state=3, position=0}\\nmetadata: size=3, description="+title+", "+(mode.equals("identity-change")&&tick>500?"changed":"artist")+", null";}
 boolean hasClickableTarget(String s){return false;}void allowNotificationPermissionIfPrompted(){actions++;throw new AssertionError("action-forbidden");}
 void launchTarget(){actions++;throw new AssertionError("action-forbidden");}void tapLabel(String s){actions++;throw new AssertionError("action-forbidden");}
 static void require(boolean b,String reason){if(!b)throw new AssertionError(reason);}
${methods}
${firstAudioMethods}
 static void check(boolean b,String reason){if(!b)throw new AssertionError(reason);}
 static LocalContinuityObservation pair(){LocalContinuityObservation o=new LocalContinuityObservation();check(o.observe(0,60L,60000L,0,0,true,"fixed")==null,"first-pair");return o;}
 public static void main(String[] args){
  String[][] rows={{"normal","PASS","steady-ready"},{"late","PASS","steady-ready"},{"missing-ui","TIMEOUT","audio-pair-unavailable"},{"missing-getter","TIMEOUT","audio-pair-unavailable"},{"wrong-synthetic","TIMEOUT","audio-pair-unavailable"},{"static","TIMEOUT","audio-not-advancing"},{"identity-change","NOT_VERIFIED","identity-changed"},{"span","TIMEOUT","audio-pair-unavailable"},{"coherence","TIMEOUT","audio-pair-unavailable"},{"overshoot","TIMEOUT","audio-pair-unavailable"},{"exception","NOT_VERIFIED","observation-unavailable"}};
  for(int n=0;n<(args.length>0?2:rows.length);n++){String[] row=rows[n];mode=row[0];tick=0;reads=0;actions=0;Instrumentation i=new Instrumentation();ScenarioProgress p=new ScenarioProgress();boolean success=true;try{Entry.awaitLocalContinuity(i,p);}catch(AssertionError e){success=false;}
   check(success==row[1].equals("PASS"),"entry-status:"+mode);check(i.rows.size()==1,"unique-marker:"+mode);String[] fields=i.rows.get(0).split("\\\\|",-1);
   check(fields.length==9&&fields[0].equals("phase08LocalContinuity=v1")&&fields[1].equals(row[1])&&fields[3].equals(row[2]),"closed-marker:"+mode+":"+i.rows);
   long elapsed=Long.parseLong(fields[2]);check(elapsed>=0&&elapsed<=20000,"elapsed-range");check(actions==0,"zero-actions");check(!i.rows.toString().contains("Listen2AcceptanceSignal")&&!i.rows.toString().contains("private-sentinel"),"privacy");
   check(p.stages.get(0).equals("local-continuity-wait")&&p.stages.contains("local-continuity-complete")==success,"progress-status");
   if(success){check(elapsed<=15000&&Long.parseLong(fields[5])-Long.parseLong(fields[4])>=1&&Long.parseLong(fields[7])-Long.parseLong(fields[6])>=1000,"proof-deltas");check(fields[8].matches("[a-f0-9]{64}"),"identity-hash");}
   if(mode.equals("late"))check(elapsed>6000&&elapsed<15000,"late-readiness-independent-of-first-audio");
   if(mode.equals("missing-ui")||mode.equals("wrong-synthetic"))check(reads==0,"no-premature-getter");
  }
  if(args.length>0)return;
  mode="late";tick=0;reads=0;actions=0;AccessibilityDriver original=new AccessibilityDriver(new Instrumentation());
  PerformanceSample firstAudio=original.observeVisibleAudioAdvancement("Listen2AcceptanceSignal",0,true,null);
  check(firstAudio.status.equals("TIMEOUT")&&firstAudio.elapsedMillis>=6000&&actions==0,"original-first-audio-remains-nonpass");
  LocalContinuityObservation o=pair();check(o.observe(100,59L,59000L,100,100,true,"fixed").equals("position-rollback"),"rollback");
  o=pair();check(o.observe(-1,60L,60000L,100,100,true,"fixed").equals("invalid-clock"),"negative-clock");
  o=pair();check(o.observe(100,60L,60000L,100,99,true,"fixed").equals("invalid-clock"),"reverse-pair-clock");
  o=pair();o.observe(100,60L,60000L,100,100,true,"fixed");check(o.observe(99,60L,60000L,100,100,true,"fixed").equals("invalid-clock"),"elapsed-rollback");
  o=pair();o.observe(100,60L,60000L,100,100,true,"fixed");check(o.observe(200,60L,60000L,99,200,true,"fixed").equals("invalid-clock"),"sample-clock-rollback");
  o=pair();check(o.observe(15001,61L,61000L,15001,15001,true,"fixed").equals("audio-not-advancing"),"deadline-no-late-pass");
  o=pair();check(o.observe(1000,61L,61000L,1000,1500,true,"fixed").equals("steady-ready"),"span-inclusive");
  o=pair();check(o.observe(1000,61L,61000L,1000,1501,true,"fixed")==null,"span-reject");
  o=pair();check(o.observe(1000,61L,60999L,1000,1000,true,"fixed")==null,"native-advance-minimum");
  o=pair();check(o.observe(1000,61L,63500L,1000,1000,true,"fixed").equals("steady-ready"),"coherence-inclusive");
  o=pair();check(o.observe(1000,61L,63501L,1000,1000,true,"fixed")==null,"coherence-reject");
  o=pair();check(o.observe(15000,61L,61000L,15000,15000,true,"fixed").equals("steady-ready"),"deadline-inclusive");
  for(long v:new long[]{-1,604801}){o=new LocalContinuityObservation();check(o.observe(1,v,60000L,1,1,true,"fixed")==null&&o.firstUi==null,"ui-bounds");}
  for(long v:new long[]{-1,604800001}){o=new LocalContinuityObservation();check(o.observe(1,60L,v,1,1,true,"fixed")==null&&o.firstUi==null,"native-bounds");}
  o=pair();check(o.safeLine("steady-ready",1000).endsWith("992a93455c71fedd36ac9bbc439952c041cf61445958472af479269b8d873513"),"exact-utf8-sha256");
 }
}`;
const runner=readFileSync(resolve(base,'Phase08Instrumentation.java'),'utf8');
assert.match(runner,/if \("com\.listen2mobile\.acceptance\.PerformanceRecoveryTest#awaitLocalContinuity"\.equals\(scenarioClass\)\) \{\s*PerformanceRecoveryTest\.awaitLocalContinuity\(this, progress\); return;/);
assert.match(runner,/if \("com\.listen2mobile\.acceptance\.PerformanceRecoveryTest#awaitLocalContinuity"\.equals\(scenarioClass\)\) return 20_000L;/);
assert.equal((runner.match(/return 20_000L;/g)??[]).length,1);
assert.match(runner,/#prepareLocal"\.equals\(scenarioClass\)\) return 120_000L/);
assert.match(source,/while \(SystemClock.elapsedRealtime\(\) - started < 6_000L\)/);
assert.doesNotMatch(methods,/launchTarget\(|tapLabel\(|prepareSyntheticLocalAudio\(|resumeVisiblePlayer\(|resolve|importSynthetic/);
const dir=mkdtempSync(resolve(tmpdir(),'listen2-local-continuity-'));
try{
 for(const name of ['GenericAudioObservation','BilibiliPlaybackObservation','SyntheticAudioObservation'])writeFileSync(resolve(dir,name+'.java'),readFileSync(resolve(base,name+'.java'),'utf8').replace('package com.listen2mobile.acceptance;',''));
 writeFileSync(resolve(dir,'AccessibilityDriver.java'),java);
 const home=process.env.JAVA_HOME??'/opt/homebrew/opt/openjdk@17';
 execFileSync(resolve(home,'bin/javac'),['GenericAudioObservation.java','BilibiliPlaybackObservation.java','SyntheticAudioObservation.java','AccessibilityDriver.java'],{cwd:dir,stdio:'pipe'});
 execFileSync(resolve(home,'bin/java'),['AccessibilityDriver',...(representative?['representative']:[])],{cwd:dir,stdio:'pipe'});
 console.log(representative?'Actual Java continuity normal and late-readiness representative cases passed.':'Actual Java continuity entry/pair/closed-marker fixtures passed, including zero actions and original 6s preservation.');
}finally{rmSync(dir,{recursive:true,force:true});}
