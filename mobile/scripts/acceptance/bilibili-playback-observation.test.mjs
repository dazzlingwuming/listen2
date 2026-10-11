import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const temporary = mkdtempSync(resolve(tmpdir(), 'listen2-bilibili-observation-'));
try {
  const harness = resolve(temporary, 'BilibiliPlaybackObservationTest.java');
  writeFileSync(harness, `package com.listen2mobile.acceptance;
public final class BilibiliPlaybackObservationTest {
  static void check(boolean value) { if (!value) throw new AssertionError("observation contract"); }
  static String part(int page, String title) {
    return "<node content-desc=\\\"播放" + title + "\\\" clickable=\\\"true\\\" enabled=\\\"true\\\"><node text=\\\"P" + page + " · " + title + "\\\"/><node content-desc=\\\"打开" + title + "MV画面\\\"/></node>";
  }
  static String session(long position, String title, String identity) {
    return "package=com.dazzlingwuming.listen2\\nstate=PlaybackState {state=3, position=" + position + ", buffered position=9000}\\nmetadata: size=3, description=" + title + "\\n" + identity;
  }
  public static void main(String[] args) {
    String one = "<hierarchy>" + part(1, "A &amp; B") + "</hierarchy>";
    check("A & B".equals(BilibiliPlaybackObservation.uniqueP1(one)));
    check(BilibiliPlaybackObservation.uniqueP1("<hierarchy>" + part(1, "A") + part(2, "B") + "</hierarchy>") == null);
    check(BilibiliPlaybackObservation.uniqueP1("<hierarchy>" + part(2, "B") + "</hierarchy>") == null);
    check(BilibiliPlaybackObservation.uniqueP1("<!DOCTYPE hierarchy SYSTEM 'file:///not-readable'><hierarchy>" + part(1, "A") + "</hierarchy>") == null);
    check(BilibiliPlaybackObservation.uniqueP1("<!DOCTYPE hierarchy [<!ENTITY xxe SYSTEM 'https://example.invalid/private'>]><hierarchy/>" ) == null);
    check(BilibiliPlaybackObservation.uniqueP1("<!ENTITY xxe SYSTEM 'file:///not-readable'><hierarchy/>") == null);
    check(BilibiliPlaybackObservation.uniqueP1(" ".repeat(1048577)) == null);
    String title = "video · part";
    BilibiliPlaybackObservation.Snapshot first = BilibiliPlaybackObservation.snapshot(session(1000, title, ""), title);
    BilibiliPlaybackObservation.Snapshot later = BilibiliPlaybackObservation.snapshot(session(3500, title, ""), title);
    check(first.positionMs == 1000 && first.sameObservedAdvancingTrack(later));
    check(!first.sameExactAdvancingTrack(later));
    check(!first.sameObservedAdvancingTrack(BilibiliPlaybackObservation.snapshot(session(1000, title, ""), title)));
    check(BilibiliPlaybackObservation.snapshot(session(1000, "wrong", ""), title) == null);
    check(BilibiliPlaybackObservation.snapshot(session(1000, title, "").replace("com.dazzlingwuming.listen2", "other.app"), title) == null);
    check(BilibiliPlaybackObservation.snapshot(session(1000, title, "") + session(2000, title, ""), title) == null);
    String id = "bitrack_v_BV1xx411c7mD-12345";
    first = BilibiliPlaybackObservation.snapshot(session(1000, title, id), title);
    check(first.sameExactAdvancingTrack(BilibiliPlaybackObservation.snapshot(session(3500, title, id), title)));
    check(!first.sameExactAdvancingTrack(BilibiliPlaybackObservation.snapshot(session(3500, title, id.replace("12345", "54321")), title)));
    System.out.println("Bilibili observation contracts passed: unique P1, decoded labels, ambiguous parts/sessions rejected, target title and actual position required, CID observability separate.");
  }
}`);
  const binary = name => process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin', name) : name;
  execFileSync(binary('javac'), ['-encoding', 'UTF-8', '-d', temporary, resolve(import.meta.dirname, '../../android/app/src/androidTest/java/com/listen2mobile/acceptance/BilibiliPlaybackObservation.java'), harness], { stdio: 'pipe' });
  process.stdout.write(execFileSync(binary('java'), ['-cp', temporary, 'com.listen2mobile.acceptance.BilibiliPlaybackObservationTest'], { encoding: 'utf8' }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
