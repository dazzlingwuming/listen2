import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
const base=resolve(import.meta.dirname,'../../android/app/src/androidTest/java/com/listen2mobile/acceptance');
const source=readFileSync(resolve(base,'AccessibilityDriver.java'),'utf8');
const methods=source.slice(source.indexOf('    PerformanceSample measureVisibleAudio(String title) {'),source.indexOf('    /** Preparation only:'));
const directory=mkdtempSync(resolve(tmpdir(),'listen2-generic-audio-'));
const representative=process.argv.includes('--representative');
try{
 for(const name of ['GenericAudioObservation','SyntheticAudioObservation'])writeFileSync(resolve(directory,name+'.java'),readFileSync(resolve(base,name+'.java'),'utf8').replace('package com.listen2mobile.acceptance;',''));
 writeFileSync(resolve(directory,'GenericFixture.java'),`import java.util.*;
public class GenericFixture {
 static long tick,playAt;static String mode;static boolean playing,started,full;final Recorder instrumentation=new Recorder();
 static class SystemClock{static long elapsedRealtime(){return tick;}static void sleep(long ms){tick+=ms;}}
 static class Bundle{String value;void putString(String k,String v){value=k+"="+v;}}
 static class Recorder{List<String> rows=new ArrayList<>();void sendStatus(int c,Bundle b){rows.add(b.value);}}
 static class PerformanceSample{String status,reason;long elapsedMillis;PerformanceSample(String s,long e,String r,Object ignored){status=s;elapsedMillis=e;reason=r;}}
 static class NativePlaybackObservation{static class Sample{long positionMs=started?tick-playAt:100000;long elapsedMs=tick;boolean available=true;boolean observed(){return available && !mode.equals("missing-getter") && !(mode.equals("no-session") && !started);}static Sample unavailable(){Sample s=new Sample();s.available=false;return s;}}static Sample read(Recorder r){return new Sample();}}
 static class BilibiliPlaybackObservation{static class Snapshot{String metadata="size=3, description=title, artist, null";}static Snapshot snapshot(String s,String t){return playing?new Snapshot():null;}}
 static String control(String label){return "<node content-desc=\\\""+label+"\\\" enabled=\\\"true\\\" clickable=\\\"true\\\"/>";}
 void tapLabel(String label){if(label.equals("暂停播放")){if(!mode.equals("pause-failed"))playing=false;}else if(label.equals("播放title")){started=true;playing=true;playAt=tick;}else if(label.equals("打开播放器"))full=true;}
 String dumpWindow(){tick+=100;return "<hierarchy>"+(full?control("关闭播放器")+"<node text=\\\"title\\\"/>":control("播放title")+(mode.equals("duplicate")?control("播放title"):"")+(playing?control("暂停播放"):control("继续播放")))+"</hierarchy>";}
 boolean hasClickableTarget(String label){return label.equals("打开播放器")&&started&&!full;}
 Long progressPosition(String xml){return full?(tick-playAt)/1000:null;}
 String shell(String c){if(mode.equals("no-session")&&!started)return "MEDIA SESSION SERVICE";return "package=com.dazzlingwuming.listen2\\nstate=PlaybackState {state="+(playing?3:2)+", position=0}";}
 void allowNotificationPermissionIfPrompted(){throw new AssertionError("private-sentinel");}
${methods}
 static void check(boolean b){if(!b)throw new AssertionError("generic-contract");}
 public static void main(String[] args){
 for(String m:new String[]{"normal","no-session"}){mode=m;tick=0;playing=true;started=false;full=false;GenericFixture fixture=new GenericFixture();PerformanceSample sample=fixture.measureVisibleAudio("title");check(sample.status.equals("PASS")&&sample.elapsedMillis<=6000);check(fixture.instrumentation.rows.contains("phase08AudioPrecondition="+(m.equals("normal")?"paused-existing":"no-existing-session")));}
 if(args.length>0)return;
 for(String m:new String[]{"pause-failed","duplicate","missing-getter"}){mode=m;tick=0;playing=true;started=false;full=false;PerformanceSample sample=new GenericFixture().measureVisibleAudio("title");check(sample.status.equals("NOT_VERIFIED")&&!started);}
 check(GenericAudioObservation.precondition("",true)==GenericAudioObservation.Precondition.UNKNOWN);
 check(GenericAudioObservation.precondition("MEDIA SESSION SERVICE",false)==GenericAudioObservation.Precondition.NO_SESSION);
 check(GenericAudioObservation.precondition("MEDIA SESSION SERVICE",true)==GenericAudioObservation.Precondition.UNKNOWN);
 String session="package=com.dazzlingwuming.listen2\\nPlaybackState {state=PAUSED(2), position=0}";
 check(GenericAudioObservation.precondition(session,true)==GenericAudioObservation.Precondition.PAUSED);
 for(String state:new String[]{"PLAYING(2)","PAUSED(3)","2x","6","UNKNOWN"})check(GenericAudioObservation.precondition(session.replace("PAUSED(2)",state),true)==GenericAudioObservation.Precondition.UNKNOWN);
 check(GenericAudioObservation.precondition(session+session,true)==GenericAudioObservation.Precondition.UNKNOWN);
 check(GenericAudioObservation.precondition(session,false)==GenericAudioObservation.Precondition.UNKNOWN);
 check(GenericAudioObservation.uniqueControl("<hierarchy>"+control("播放title")+"</hierarchy>","播放title"));
 check(!GenericAudioObservation.uniqueControl("<hierarchy>"+control("播放title")+control("播放title")+"</hierarchy>","播放title"));
 check(!GenericAudioObservation.uniqueControl("<!DOCTYPE hierarchy><hierarchy/>","播放title"));
 check(!GenericAudioObservation.fullPlayerTitle("<hierarchy>"+control("关闭播放器")+"<node text=\\\"title remix\\\"/></hierarchy>","title"));
 check(GenericAudioObservation.exactMetadataTitle("size=3, description=title, artist, null","title"));
 check(!GenericAudioObservation.exactMetadataTitle("size=3, description=title remix, artist, null","title"));
 check(!GenericAudioObservation.exactMetadataTitle("size=3, description=x,title, artist, null","x,title"));
 }
}`);
 const java=process.env.JAVA_HOME??'/opt/homebrew/opt/openjdk@17';execFileSync(resolve(java,'bin/javac'),['GenericAudioObservation.java','SyntheticAudioObservation.java','GenericFixture.java'],{cwd:directory,stdio:'pipe'});execFileSync(resolve(java,'bin/java'),['GenericFixture',...(representative?['representative']:[])],{cwd:directory,stdio:'pipe'});
 assert.match(methods,/GenericAudioObservation\.uniqueControl\(dumpWindow\(\), "播放" \+ title\)/);
 assert.doesNotMatch(methods,/currentNative\.positionMs > firstNative\.positionMs/);
 console.log(representative?'Actual generic driver two representative cases passed.':'Actual generic driver/public-UI/session boundary fixtures passed.');
}finally{rmSync(directory,{recursive:true,force:true});}
