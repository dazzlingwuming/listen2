import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const source=readFileSync(new URL('../../android/app/src/androidTest/java/com/listen2mobile/acceptance/AccessibilityDriver.java',import.meta.url),'utf8');
const methods=source.slice(source.indexOf('    void enterText(String label, String value) {'),source.indexOf('    void verifyFixedSearchInputPreparation()'));
const java=`import java.util.*;
public class FixedSearchInputFixture {
 static String mode; static int focusCalls,setCalls,validations; final Recorder instrumentation=new Recorder(); final AccessibilityNodeInfo node=new AccessibilityNodeInfo();
 static class Bundle {String value;void putString(String k,String v){value=v;}void putCharSequence(String k,String v){value=v;}}
 static class Recorder {List<String> rows=new ArrayList<>();void sendStatus(int n,Bundle b){rows.add(b.value);}void waitForIdleSync(){}}
 static class AccessibilityNodeInfo {static final int ACTION_FOCUS=1,ACTION_SET_TEXT=2;static final String ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE="fixed";String text="";boolean focused;
 boolean isVisibleToUser(){return !mode.equals("hidden");}boolean isEnabled(){return !mode.equals("disabled");}boolean isPassword(){return mode.equals("password");}boolean isFocused(){return focused;}String getText(){return text;}void recycle(){}
 boolean performAction(int action){focusCalls++;if(mode.equals("focus-refused"))return false;focused=true;return true;}
 boolean performAction(int action,Bundle b){setCalls++;if(mode.equals("set-refused"))return false;text=b.value;return true;}}
 AccessibilityNodeInfo findEditableNode(String label){return mode.equals("missing")?null:node;}
 boolean waitForExactEditableText(String label,String expected,long timeout){validations++;return !mode.equals("retain-failed")&&expected.equals(node.text);}
 void require(boolean ok,String message){if(!ok)throw new AssertionError(message);}
${methods}
 public static void main(String[] args){for(String value:new String[]{"fresh","focused","existing","focus-refused","set-refused","retain-failed","missing","hidden","disabled","password"}){
 mode=value;focusCalls=setCalls=validations=0;FixedSearchInputFixture d=new FixedSearchInputFixture();d.node.focused=mode.equals("focused")||mode.equals("existing");if(mode.equals("existing"))d.node.text="青花瓷";boolean passed=true;try{d.enterText("fixed","青花瓷");}catch(AssertionError e){passed=false;}boolean expected=Arrays.asList("fresh","focused","existing").contains(mode);if(passed!=expected)throw new AssertionError(mode);if(passed&&validations!=1)throw new AssertionError("new-validation");if(mode.equals("existing")&&(focusCalls!=0||setCalls!=0))throw new AssertionError("noop");if(mode.equals("focused")&&(focusCalls!=0||setCalls!=1))throw new AssertionError("focused");}
 mode="fresh";focusCalls=setCalls=validations=0;FixedSearchInputFixture d=new FixedSearchInputFixture();d.enterText("fixed","青花瓷");d.enterText("fixed","青花瓷");if(focusCalls!=1||setCalls!=1||validations!=2)throw new AssertionError("repeat");
 }
}`;
const credential=readFileSync(new URL('../../android/app/src/androidTest/java/com/listen2mobile/acceptance/CredentialAcceptanceTest.java',import.meta.url),'utf8');
const body=credential.slice(credential.indexOf('        boolean setFixedSearchQuery()'),credential.indexOf('        void collectInputs('));
assert.match(body,/isFocused\(\) \|\| inputs\.get\(0\)\.performAction/);
assert.doesNotMatch(body,/getText\(|getContentDescription\(/);
const dir=mkdtempSync(resolve(tmpdir(),'listen2-fixed-input-'));
try{writeFileSync(resolve(dir,'FixedSearchInputFixture.java'),java);execFileSync('/opt/homebrew/opt/openjdk@17/bin/javac',[resolve(dir,'FixedSearchInputFixture.java')]);execFileSync('/opt/homebrew/opt/openjdk@17/bin/java',['-cp',dir,'FixedSearchInputFixture']);}finally{rmSync(dir,{recursive:true,force:true});}


const editable=source.slice(source.indexOf('    private AccessibilityNodeInfo findEditableNode(String label)'),source.indexOf('    private ClickTarget clickableTargetFor'));
 const uniqueJava=`import java.util.*;
public class FixedInputUniquenessFixture {
 static final String PRODUCT="com.dazzlingwuming.listen2",TARGET_PACKAGE=PRODUCT;static final int MAX_NODES_PER_DUMP=800,MAX_DUMP_DEPTH=40;
 static class AccessibilityNodeInfo {List<AccessibilityNodeInfo> children=new ArrayList<>();String label="",pkg=PRODUCT;boolean visible=true,enabled=true,clickable,editable,password;AccessibilityNodeInfo(String s){label=s;}static AccessibilityNodeInfo obtain(AccessibilityNodeInfo n){return n;}void recycle(){}CharSequence getPackageName(){return pkg;}CharSequence getText(){return label;}CharSequence getContentDescription(){return label;}boolean isVisibleToUser(){return visible;}boolean isEnabled(){return enabled;}boolean isClickable(){return clickable;}boolean isEditable(){return editable;}boolean isPassword(){return password;}int getChildCount(){return children.size();}AccessibilityNodeInfo getChild(int i){return children.get(i);}}
 AccessibilityNodeInfo root;FixedInputUniquenessFixture instrumentation=this;FixedInputUniquenessFixture getUiAutomation(){return this;}AccessibilityNodeInfo getRootInActiveWindow(){return root;}
 static boolean labelMatches(AccessibilityNodeInfo n,String s){return s.equals(n.label);}

 ${editable}
 static AccessibilityNodeInfo node(String label,boolean action){AccessibilityNodeInfo n=new AccessibilityNodeInfo(label);n.clickable=action;return n;}
 static AccessibilityNodeInfo shell(){AccessibilityNodeInfo r=node("",false);r.children.add(node("搜索",true));r.children.add(node("我的",true));return r;}
 public static void main(String[] args){
 AccessibilityNodeInfo child;
 for(String mode:new String[]{"one","duplicate","limit","depth","null-child"}){FixedInputUniquenessFixture f=new FixedInputUniquenessFixture();f.root=node("",false);AccessibilityNodeInfo input=node("fixed",false);input.editable=true;f.root.children.add(input);if(mode.equals("duplicate"))f.root.children.add(input);if(mode.equals("limit")){for(int i=0;i<800;i++)f.root.children.add(node("",false));f.root.children.add(input);}if(mode.equals("depth")){child=f.root;for(int i=0;i<41;i++){AccessibilityNodeInfo next=node("",false);child.children.add(next);child=next;}child.children.add(input);}if(mode.equals("null-child"))f.root.children.add(null);if((f.findEditableNode("fixed")!=null)!=mode.equals("one"))throw new AssertionError(mode);}
 }
}`;
 const uniqueDir=mkdtempSync(resolve(tmpdir(),'listen2-fixed-input-unique-'));try{writeFileSync(resolve(uniqueDir,'FixedInputUniquenessFixture.java'),uniqueJava);const bin=n=>resolve(process.env.JAVA_HOME||'/opt/homebrew/opt/openjdk@17','bin',n);execFileSync(bin('javac'),[resolve(uniqueDir,'FixedInputUniquenessFixture.java')]);execFileSync(bin('java'),['-cp',uniqueDir,'FixedInputUniquenessFixture']);}finally{rmSync(uniqueDir,{recursive:true,force:true});}

console.log('Actual fixed-input methods passed: idempotent focus/text with fresh retention, complete unique visible editable traversal, limits/depth/duplicates rejected; credential does not read input.');
