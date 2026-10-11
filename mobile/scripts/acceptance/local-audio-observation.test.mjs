import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const source=readFileSync(new URL('../../android/app/src/androidTest/java/com/listen2mobile/acceptance/AccessibilityDriver.java',import.meta.url),'utf8');
const methods=source.slice(source.indexOf('    PerformanceSample measureVisibleAudio(String title) {'),source.indexOf('    /** Preparation only:'));
const java=`import java.util.*;
public class LocalAudioObservationFixture {
 static String mode; static long tick; static int dumps; final Recorder instrumentation=new Recorder();
 static class SystemClock { static long elapsedRealtime(){return tick;} static void sleep(long n){tick+=n;} }
 static class Bundle { String value; void putString(String key,String value){this.value=key+"="+value;} }
 static class Recorder { List<String> rows=new ArrayList<>(); void sendStatus(int code,Bundle b){rows.add(b.value);} }
 static class PerformanceSample { String status,reason; long elapsedMillis; PerformanceSample(String s,long e,String r,Object ignored){status=s;elapsedMillis=e;reason=r;} }
 static class NativePlaybackObservation { static class Sample {long positionMs=mode.equals("native-static")?0:tick;long elapsedMs=tick;boolean observed(){return !mode.equals("missing-getter");}} static Sample read(Recorder r){return new Sample();} }
 static class BilibiliPlaybackObservation { static class Snapshot {String metadata="fixed";} static Snapshot snapshot(String s,String t){if(mode.equals("missing-playing"))return null;Snapshot r=new Snapshot();if(mode.equals("metadata-change"))r.metadata="fixed"+tick;return r;} }
 void tapLabel(String label){if(mode.equals("initial-fail")||((mode.equals("mini-fail")||mode.equals("fresh-mini-only"))&&label.equals("打开播放器")))throw new AssertionError("private-sentinel");if(mode.equals("late-tap"))tick+=6100;}
 String dumpWindow(){tick+=mode.equals("sample-cap")?1:100;dumps++;if(mode.equals("unknown-fail"))throw new AssertionError("private-sentinel");if(mode.equals("notification-fail"))return "Allow Listen2 to send you notifications?";return mode.equals("transition")&&dumps<=3?"":mode.equals("fresh-mini-only")?"fixedwindow":"关闭播放器fixedwindow";}
 boolean hasClickableTarget(String label){return mode.equals("mini-fail")||mode.equals("fresh-mini-only");}
 void allowNotificationPermissionIfPrompted(){throw new AssertionError("private-sentinel");}
 Long progressPosition(String v){return mode.equals("missing-ui")||v.isEmpty()?null:(mode.equals("ui-static")||mode.equals("sample-cap"))?0:tick/1000;}
 String shell(String command){if(mode.equals("shell-fail"))throw new AssertionError("private-sentinel");return "fixed";}
${methods}
 public static void main(String[] args){
 String[][] cases={{"normal","PASS","visible-and-native-position-advancing"},{"transition","PASS","visible-and-native-position-advancing"},{"initial-fail","FAIL","audio-initial-tap-failed"},{"mini-fail","PASS","visible-and-native-position-advancing"},{"fresh-mini-only","TIMEOUT","audio-pair-unavailable"},{"notification-fail","FAIL","audio-notification-failed"},{"shell-fail","FAIL","audio-native-shell-failed"},{"unknown-fail","FAIL","audio-unknown-assert"},{"missing-ui","TIMEOUT","audio-ui-progress-unavailable"},{"missing-getter","TIMEOUT","audio-native-getter-unavailable"},{"missing-playing","TIMEOUT","audio-playing-identity-unavailable"},{"late-tap","TIMEOUT","audio-ui-progress-unavailable"},{"metadata-change","TIMEOUT","audio-not-advancing"},{"native-static","TIMEOUT","audio-not-advancing"},{"ui-static","TIMEOUT","audio-not-advancing"},{"sample-cap","TIMEOUT","audio-not-advancing"}};
 for(String[] row:cases){mode=row[0];tick=0;dumps=0;LocalAudioObservationFixture d=new LocalAudioObservationFixture();PerformanceSample s=d.measureVisibleAudio("fixed",true);d.emitLocalAudioSample(s);if(!row[1].equals(s.status)||!row[2].equals(s.reason))throw new AssertionError(mode+":"+s.status+":"+s.reason);if(s.status.equals("PASS")&&s.elapsedMillis>6000)throw new AssertionError("budget");if(d.instrumentation.rows.toString().contains("private-sentinel"))throw new AssertionError("privacy");if(mode.equals("sample-cap")&&(d.instrumentation.rows.stream().filter(r->r.startsWith("phase08LocalObservation=")).count()!=32||!d.instrumentation.rows.contains("phase08LocalObservationStatus=NOT_VERIFIED|sample-limit")))throw new AssertionError("sample-cap");}
 mode="mini-fail";tick=0;dumps=0;LocalAudioObservationFixture oldGeneric=new LocalAudioObservationFixture();if(!oldGeneric.measureVisibleAudio("fixed",false).reason.equals("audio-mini-tap-failed"))throw new AssertionError("generic-mini-contract");
 mode="normal";tick=0;dumps=0;LocalAudioObservationFixture generic=new LocalAudioObservationFixture();if(!generic.measureVisibleAudio("fixed",false).status.equals("PASS")||!generic.instrumentation.rows.isEmpty())throw new AssertionError("generic-lane-diagnostics");
 LocalAudioObservationFixture d=new LocalAudioObservationFixture();d.emitLocalAudioSample(new PerformanceSample("PASS",120001,"visible-and-native-position-advancing",null));if(!d.instrumentation.rows.get(0).equals("phase08LocalAudio=NOT_VERIFIED|0|diagnostic-elapsed-out-of-range"))throw new AssertionError("elapsed-bound");
 }
}`;
const preparation=source.slice(source.indexOf('    /** Preparation only:'),source.indexOf('    /** Imports only the generated file'));
const preparationJava=`import java.util.*;
public class LocalPreparationFixture {
 static long tick; static String mode; String route; List<String> actions=new ArrayList<>(); final Recorder instrumentation=new Recorder();
 static class SystemClock {static long elapsedRealtime(){return tick;}static void sleep(long n){tick+=n;}}
 static class Bundle {String value;void putString(String key,String v){value=key+"="+v;}}
 static class Recorder {List<String> rows=new ArrayList<>();void sendStatus(int code,Bundle b){rows.add(b.value);}}
 boolean hasClickableTarget(String label){return route.equals("shell")&&(label.equals("搜索")||label.equals("我的"))||route.equals("player")&&label.equals("关闭播放器")||route.equals("detail")&&label.equals("返回上一页");}
 String dumpWindow(){return route;}
 boolean waitForWindowChange(String before,long timeout){tick+=mode.equals("slow")?timeout:100;return !before.equals(route);}
 void tapLabel(String label){if(!hasClickableTarget(label))throw new AssertionError("untrusted-control");actions.add(label);if(mode.equals("failed"))throw new AssertionError("private-sentinel");if(mode.equals("slow"))tick+=11000;if(mode.equals("loop"))return;route=route.equals("player")?"detail":"shell";}
${preparation}
 public static void main(String[] args){
 String[][] cases={{"player","player","关闭播放器,返回上一页"},{"detail","detail","返回上一页"},{"shell","shell",""},{"unknown","unknown",""},{"loop","detail","返回上一页,返回上一页,返回上一页"},{"slow","detail","返回上一页"},{"failed","detail","返回上一页"}};
 for(String[] row:cases){mode=row[0];tick=0;LocalPreparationFixture d=new LocalPreparationFixture();d.route=row[1];boolean passed=true;try{d.returnToPhoneShellForLocalPreparation();}catch(AssertionError e){passed=false;}if(passed!=Arrays.asList("player","detail","shell").contains(mode))throw new AssertionError("result:"+mode);if(!String.join(",",d.actions).equals(row[2]))throw new AssertionError("actions:"+mode);if(d.actions.size()>3)throw new AssertionError("navigation-bound");if(mode.equals("unknown")&&tick!=10000)throw new AssertionError("deadline");if(d.instrumentation.rows.toString().contains("private-sentinel"))throw new AssertionError("privacy");if(passed&&!d.route.equals("shell"))throw new AssertionError("shell-not-ready");}
 }
}`;
const dir=mkdtempSync(resolve(tmpdir(),'listen2-local-audio-'));
try{writeFileSync(resolve(dir,'SyntheticAudioObservation.java'),readFileSync(new URL('../../android/app/src/androidTest/java/com/listen2mobile/acceptance/SyntheticAudioObservation.java',import.meta.url),'utf8').replace('package com.listen2mobile.acceptance;',''));writeFileSync(resolve(dir,'LocalAudioObservationFixture.java'),java);writeFileSync(resolve(dir,'LocalPreparationFixture.java'),preparationJava);const home=process.env.JAVA_HOME??'/opt/homebrew/opt/openjdk@17';execFileSync(resolve(home,'bin/javac'),['SyntheticAudioObservation.java','LocalAudioObservationFixture.java','LocalPreparationFixture.java'],{cwd:dir,stdio:'pipe'});execFileSync(resolve(home,'bin/java'),['LocalAudioObservationFixture'],{cwd:dir,stdio:'pipe'});execFileSync(resolve(home,'bin/java'),['LocalPreparationFixture'],{cwd:dir,stdio:'pipe'});assert.doesNotMatch(methods,/returnToPhoneShellForLocalPreparation/);assert.match(methods,/while \(SystemClock.elapsedRealtime\(\) - started < 6_000L\)/);console.log('Actual local observation and preparation methods passed: transition, bounded budget, operation failures, missing UI/getter/playing identity and private exception rejection.');}finally{rmSync(dir,{recursive:true,force:true});}
