import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const native = resolve(import.meta.dirname, '../../android/app/src/androidTest/java/com/listen2mobile/acceptance');
const driver = readFileSync(resolve(native, 'AccessibilityDriver.java'), 'utf8');
const start = driver.indexOf('    void assertSearchTerminal(String source) {');
const end = driver.indexOf('\n    /**', start);
assert.ok(start >= 0 && end > start);
const method = driver.slice(start, end);
const titlesStart = driver.indexOf('    private static List<String> visiblePlayableTitles(String view) {');
const titlesEnd = driver.indexOf('\n    private void appendLiveResults', titlesStart);
assert.ok(titlesStart >= 0 && titlesEnd > titlesStart);
const titlesMethod = driver.slice(titlesStart, titlesEnd);
const temporary = mkdtempSync(resolve(tmpdir(), 'listen2-journey-terminal-'));
const sources = {
  'android/app/Instrumentation.java': 'package android.app; public class Instrumentation {}',
  'com/listen2mobile/acceptance/SystemClock.java': `package com.listen2mobile.acceptance;
final class SystemClock { static long now; static long elapsedRealtime(){return now;} static void sleep(long ms){now+=ms;} }`,
  'com/listen2mobile/acceptance/AccessibilityDriver.java': `package com.listen2mobile.acceptance;
import java.util.*; import java.util.regex.*;
final class AccessibilityDriver {
 static String view; static boolean scenario; static List<String> calls=new ArrayList<>(),events=new ArrayList<>();
 AccessibilityDriver(android.app.Instrumentation ignored){}
 static void check(boolean b){if(!b)throw new AssertionError("fixture-contract");}
 static void reset(String value){view=value;scenario=false;calls.clear();events.clear();SystemClock.now=0;}
 String dumpWindow(){return view;}
 boolean waitForLabel(String label,long budget){check(budget==8000L||budget==10000L||budget==20000L);return true;}
 static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 void record(String event){events.add(event);calls.add("terminal:"+event);}
 void launchTarget(){calls.add("launch");}
 void assertLegacyLibraryVisibleWithoutRecoveryFailure(){calls.add("library");}
 void tapLabel(String label){check(label.equals("搜索"));calls.add("search-tab");}
 void assertFiveSourceTabs(){calls.add("five-tabs");}
 void enterText(String label,String value){check(label.equals("搜索歌曲、歌手或歌单")&&value.equals("青花瓷"));calls.add("query");}
 void selectLiveSource(String source){check(source.equals("网易云音乐")||source.equals("哔哩哔哩"));calls.add("select:"+source);view=source.equals("网易云音乐")?JourneyTerminalFixture.NETEASE:JourneyTerminalFixture.BILI;}
 void submitLiveSearch(){calls.add("submit");}
 void exerciseVisibleSafeDomains(){calls.add("domains");}
 void captureForegroundEvidence(){calls.add("capture");}
${method}
${titlesMethod}
}`,
  'com/listen2mobile/acceptance/JourneyTerminalFixture.java': `package com.listen2mobile.acceptance;
import java.util.*;
public final class JourneyTerminalFixture {
 static final String NETEASE=${JSON.stringify('<node text="网易云要求完成验证"/><node text="当前匿名搜索被来源拦截，请先选择其他音乐来源。"/>')};
 static final String BILI=${JSON.stringify('<node text="来源安全策略拒绝了请求"/><node text="请选择其他来源，或稍后再试。"/>')};
 static void test(String source,String xml,boolean accepted){AccessibilityDriver.reset(xml);boolean pass=true;try{new AccessibilityDriver(null).assertSearchTerminal(source);}catch(AssertionError expected){pass=false;}AccessibilityDriver.check(pass==accepted);AccessibilityDriver.check(accepted?AccessibilityDriver.events.equals(Arrays.asList("terminal-"+source)):AccessibilityDriver.events.isEmpty());if(!accepted)AccessibilityDriver.check(SystemClock.now>=15000L);}
 public static void main(String[] ignored){
  test("网易",NETEASE,true);test("网易云音乐",NETEASE,true);test("哔哩哔哩",BILI,true);
  test("QQ音乐",NETEASE,false);test("网易",BILI,false);test("哔哩哔哩",NETEASE,false);test("网易旧",NETEASE,false);
  test("网易",NETEASE+"<node text=\\\"正在搜索网易云音乐\\\"/>",false);
  test("哔哩哔哩",BILI+"<node text=\\\"正在搜索哔哩哔哩\\\"/>",false);
  test("网易",NETEASE.substring(0,NETEASE.indexOf("/><node")+2),false);
  test("哔哩哔哩",BILI.substring(BILI.indexOf("<node",1)),false);
  test("网易",NETEASE.replace("网易云要求完成验证","前缀网易云要求完成验证后缀"),false);
  test("哔哩哔哩",BILI.replace("请选择其他来源，或稍后再试。","请选择其他来源"),false);
  test("网易","<node text=\\\"开始搜索\\\"/><node text=\\\"输入关键词后选择来源\\\"/>",false);
  test("网易","<node text=\\\"还没有搜索结果\\\"/>",true);
  test("网易","<node content-desc=\\\"重试搜索\\\"/>",true);
  String row=${JSON.stringify('<node content-desc="查看青花瓷详情"/><node content-desc="播放青花瓷"/>')};
  test("网易",row,true);
  test("哔哩哔哩",row.replace("青花瓷","现场版青花瓷完整版"),true);
  test("网易",NETEASE.replace("text=","content-desc="),true);
  test("哔哩哔哩",BILI.replace("text=","content-desc="),true);
  test("网易",row+"正在搜索",false);
  test("网易","<node text=\\\"网易云音乐暂时无法完成此操作\\\"/><node text=\\\"请检查网络后重试，或选择其他来源。\\\"/>",true);
  test("网易","<node text=\\\"暂时无法完成\\\"/>",false);
  test("网易","<node content-desc=\\\"打开播放器\\\"/><node content-desc=\\\"播放\\\"/><node content-desc=\\\"下一首\\\"/>",false);
  test("网易","<node text=\\\"开始搜索\\\"/>"+row,false);
  test("网易",row.replace("青花瓷","另一首"),false);
  test("网易","<node content-desc=\\\"查看青花瓷详情\\\"/>",false);
  test("网易","<node content-desc=\\\"播放青花瓷\\\"/>",false);
  AccessibilityDriver.reset("");ScenarioProgress progress=new ScenarioProgress();IntegratedJourneyTest.run(new android.app.Instrumentation(),progress);
  AccessibilityDriver.check(AccessibilityDriver.calls.equals(Arrays.asList("launch","library","search-tab","five-tabs","query","select:网易云音乐","submit","terminal:terminal-网易","select:哔哩哔哩","submit","terminal:terminal-哔哩哔哩","domains","capture")));
  AccessibilityDriver.check(progress.currentStep().equals("journey-capture"));
  for(String event:AccessibilityDriver.events)AccessibilityDriver.check(event.startsWith("terminal-")&&!event.contains("live-")&&!event.contains("results"));
  System.out.println("Journey exact terminals and actual two-source select-submit-assert sequence passed.");
 }
}`,
};
try {
  for (const [relative, source] of Object.entries(sources)) {
    const path = resolve(temporary, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source);
  }
  const binary = name => resolve(process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17', 'bin', name);
  execFileSync(binary('javac'), ['-encoding', 'UTF-8', '-d', temporary, ...Object.keys(sources).map(path => resolve(temporary, path)), resolve(native, 'IntegratedJourneyTest.java'), resolve(native, 'ScenarioProgress.java')], { stdio: 'pipe' });
  const output = execFileSync(binary('java'), ['-cp', temporary, 'com.listen2mobile.acceptance.JourneyTerminalFixture'], { encoding: 'utf8' });
  assert.match(output, /actual two-source select-submit-assert sequence passed/u);
  console.log(output.trim());
} finally { rmSync(temporary, { recursive: true, force: true }); }
