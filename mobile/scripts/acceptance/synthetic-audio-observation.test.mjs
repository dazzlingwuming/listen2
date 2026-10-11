import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const dir=mkdtempSync(resolve(tmpdir(),'listen2-paired-audio-'));
const representative=process.argv.includes('--representative');
try {
 writeFileSync(resolve(dir,'SyntheticAudioObservationTest.java'),`package com.listen2mobile.acceptance;
public class SyntheticAudioObservationTest {
 static void check(boolean b){if(!b)throw new AssertionError("synthetic-pair-contract");}
 static SyntheticAudioObservation.Result row(SyntheticAudioObservation s,long e,long u,long n,long span,String m){return s.observe(e,u,n,10000+e,10000+e+span,true,true,m);}
 public static void main(String[] args){
 SyntheticAudioObservation fresh=new SyntheticAudioObservation(true,null);
 check(row(fresh,600,465,465000,0,"same")==SyntheticAudioObservation.Result.WAIT&&fresh.firstNativeMs==null);
 check(row(fresh,1800,0,500,0,"same")==SyntheticAudioObservation.Result.WAIT);
 check(row(fresh,3100,1,1800,0,"same")==SyntheticAudioObservation.Result.PASS);
 SyntheticAudioObservation resume=new SyntheticAudioObservation(false,100000L);
 check(row(resume,100,100,100000,0,"same")==SyntheticAudioObservation.Result.WAIT);
 check(row(resume,1100,101,101000,0,"same")==SyntheticAudioObservation.Result.PASS);
 if(args.length>0)return;
 SyntheticAudioObservation edge=new SyntheticAudioObservation(true,null);
 check(row(edge,2000,0,2500,500,"same")==SyntheticAudioObservation.Result.WAIT&&edge.firstNativeMs==2500);
 edge=new SyntheticAudioObservation(true,null);check(row(edge,2000,0,2501,500,"same")==SyntheticAudioObservation.Result.WAIT&&edge.firstNativeMs==null);
 edge=new SyntheticAudioObservation(true,null);check(row(edge,2000,0,2000,501,"same")==SyntheticAudioObservation.Result.WAIT&&edge.firstNativeMs==null);
 edge=new SyntheticAudioObservation(true,null);row(edge,1000,0,500,0,"one");check(row(edge,2000,1,1500,0,"two")==SyntheticAudioObservation.Result.WAIT);
 edge=new SyntheticAudioObservation(true,null);row(edge,1000,1,1500,0,"same");check(row(edge,2000,0,500,0,"same")==SyntheticAudioObservation.Result.WAIT&&edge.firstNativeMs==500);check(row(edge,6001,1,1500,0,"same")==SyntheticAudioObservation.Result.WAIT);
 edge=new SyntheticAudioObservation(false,100000L);row(edge,100,100,100000,0,"same");check(row(edge,1000,0,500,0,"same")==SyntheticAudioObservation.Result.ROLLBACK);
 edge=new SyntheticAudioObservation(false,100000L);check(row(edge,100,0,0,0,"same")==SyntheticAudioObservation.Result.WAIT&&edge.firstNativeMs==null);
 edge=new SyntheticAudioObservation(false,null);check(row(edge,100,0,0,0,"same")==SyntheticAudioObservation.Result.INVALID_ANCHOR);
 for(String value:new String[]{null,"","0","-1","private-sentinel","604800001","999999999999"})check(SyntheticAudioObservation.parseAnchor(value)==null);check(SyntheticAudioObservation.parseAnchor("100000")==100000);
 edge=new SyntheticAudioObservation(true,null);row(edge,1000,0,500,0,"same");check(row(edge,999,1,1500,0,"same")==SyntheticAudioObservation.Result.INVALID_CLOCK);
 edge=new SyntheticAudioObservation(true,null);check(edge.observe(100,0L,0L,1000,1001,false,true,"same")==SyntheticAudioObservation.Result.WAIT&&edge.firstNativeMs==null);check(edge.observe(200,0L,0L,1100,1101,true,false,"same")==SyntheticAudioObservation.Result.WAIT&&edge.firstNativeMs==null);
 }
}`);
 const home=process.env.JAVA_HOME??'/opt/homebrew/opt/openjdk@17';execFileSync(resolve(home,'bin/javac'),['-d',dir,resolve(import.meta.dirname,'../../android/app/src/androidTest/java/com/listen2mobile/acceptance/SyntheticAudioObservation.java'),resolve(dir,'SyntheticAudioObservationTest.java')],{stdio:'pipe'});execFileSync(resolve(home,'bin/java'),['-cp',dir,'com.listen2mobile.acceptance.SyntheticAudioObservationTest',...(representative?['representative']:[])],{stdio:'pipe'});console.log(representative?'Paired synthetic representative fresh/resume passed.':'Paired synthetic actual Java edge contracts passed.');
}finally{rmSync(dir,{recursive:true,force:true});}
