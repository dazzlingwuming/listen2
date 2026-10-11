import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';

// Contract fixtures exercise the actual helper's unavailable/linkage/cleanup paths.
// They do not establish Android service availability or real audio playback.
const temporary = mkdtempSync(resolve(tmpdir(), 'listen2-native-observation-'));
const sources = {
  'android/os/IBinder.java': 'package android.os; public interface IBinder {}',
  'android/os/Looper.java': `package android.os; public class Looper {
    public static final java.util.concurrent.ExecutorService MAIN = java.util.concurrent.Executors.newSingleThreadExecutor(r -> new Thread(r, "fixture-main"));
    public static Looper getMainLooper() { return new Looper(); }
  }`,
  'android/os/Handler.java': 'package android.os; public class Handler { public Handler(Looper l) {} public boolean post(Runnable r) { Looper.MAIN.execute(r); return true; } }',
  'android/os/SystemClock.java': 'package android.os; public class SystemClock { public static long elapsedRealtime() { return System.nanoTime()/1000000; } }',
  'android/content/ComponentName.java': 'package android.content; public class ComponentName {}',
  'android/content/Intent.java': 'package android.content; public class Intent { public Intent(Context c, Class<?> type) { if (!type.getName().endsWith("MusicService")) throw new AssertionError(); } }',
  'android/content/ServiceConnection.java': `package android.content; public interface ServiceConnection {
    void onServiceConnected(ComponentName n, android.os.IBinder b); void onServiceDisconnected(ComponentName n);
    default void onBindingDied(ComponentName n) {} default void onNullBinding(ComponentName n) {}
  }`,
  'android/content/Context.java': `package android.content; public class Context {
    public String mode = "pass"; public int bindings=0, unbinds=0;
    public boolean bindService(Intent i, ServiceConnection c, int flags) {
      if (flags != 0 || !Thread.currentThread().getName().equals("fixture-main")) throw new AssertionError();
      if (mode.equals("absent")) return false;
      bindings++;
      if (mode.equals("timeout")) return true;
      android.os.Looper.MAIN.execute(() -> {
        if (mode.equals("disconnected")) c.onServiceDisconnected(new ComponentName());
        else if (mode.equals("null")) c.onNullBinding(new ComponentName());
        else if (mode.equals("wrong-binder")) c.onServiceConnected(new ComponentName(), new android.os.IBinder() {});
        else c.onServiceConnected(new ComponentName(), new com.doublesymmetry.trackplayer.service.MusicService.MusicBinder(mode));
      }); return true;
    }
    public void unbindService(ServiceConnection c) { bindings--; unbinds++; }
  }`,
  'android/app/Instrumentation.java': 'package android.app; public class Instrumentation { public final android.content.Context context = new android.content.Context(); public android.content.Context getTargetContext() { return context; } }',
  'com/doublesymmetry/trackplayer/service/MusicService.java': `package com.doublesymmetry.trackplayer.service; public class MusicService {
    String mode; MusicService(String m) { mode=m; }
    public double getPositionInSeconds() {
      if (!Thread.currentThread().getName().equals("fixture-main")) throw new AssertionError();
      if (mode.equals("uninitialized")) throw new IllegalStateException("private-sentinel");
      if (mode.equals("invalid-position")) return Double.NaN;
      return 1.234;
    }
    public static class MusicBinder implements android.os.IBinder {
      String mode; public MusicBinder(String m) { mode=m; }
      public MusicService getService() { if (mode.equals("linkage")) throw new NoSuchMethodError("private-sentinel"); return new MusicService(mode); }
    }
  }`,
  'com/listen2mobile/acceptance/NativePlaybackObservationTest.java': `package com.listen2mobile.acceptance; public class NativePlaybackObservationTest {
    public static void main(String[] args) throws Exception {
      try {
        for (String mode : new String[] {"pass", "absent", "disconnected", "null", "wrong-binder", "uninitialized", "invalid-position", "linkage", "timeout"}) {
          android.app.Instrumentation instrumentation = new android.app.Instrumentation(); instrumentation.context.mode=mode;
          NativePlaybackObservation.Sample sample = NativePlaybackObservation.read(instrumentation);
          Thread.sleep(50);
          if (sample.observed() != mode.equals("pass") || instrumentation.context.bindings != 0) throw new AssertionError(mode);
          if (mode.equals("pass") && sample.positionMs != 1234) throw new AssertionError(mode);
          if (instrumentation.context.unbinds != (mode.equals("absent") ? 0 : 1)) throw new AssertionError(mode);
          if (sample.safeLine().contains("private")) throw new AssertionError(mode);
        }
        System.out.println("Native helper contracts passed: main-thread public getter, flags=0, bounded unavailable/linkage paths, per-sample unbind, fixed output.");
      } finally { android.os.Looper.MAIN.shutdownNow(); }
    }
  }`,
};
try {
  for (const [relative, source] of Object.entries(sources)) { const path = resolve(temporary, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source); }
  const binary = name => process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin', name) : name;
  execFileSync(binary('javac'), ['-encoding', 'UTF-8', '-d', temporary, ...Object.keys(sources).map(path => resolve(temporary, path)), resolve(import.meta.dirname, '../../android/app/src/androidTest/java/com/listen2mobile/acceptance/NativePlaybackObservation.java')], { stdio: 'pipe' });
  process.stdout.write(execFileSync(binary('java'), ['-cp', temporary, 'com.listen2mobile.acceptance.NativePlaybackObservationTest'], { encoding: 'utf8' }));
  const rules = readFileSync(resolve(import.meta.dirname, '../../android/app/proguard-release-like-acceptance.pro'), 'utf8');
  assert.equal((rules.match(/-keepclassmembers,allowobfuscation class /gu) ?? []).length, 2);
  assert.equal(rules.includes('getState('), false);
  assert.equal(rules.includes('*;'), false);
} finally { rmSync(temporary, { recursive: true, force: true }); }
