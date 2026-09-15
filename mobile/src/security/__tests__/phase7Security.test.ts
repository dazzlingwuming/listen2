// @ts-nocheck -- this Jest subprocess fixture is deliberately Node-only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const mobileRoot = resolve(__dirname, '../../..');
const scanner = resolve(mobileRoot, 'scripts/verify-phase7-security.mjs');

function runScanner(...argumentsList: string[]) {
  return execFileSync(process.execPath, [scanner, ...argumentsList], {
    cwd: mobileRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

test('Phase 7 scanner accepts the source tree and retains Phase 8 evidence boundary', () => {
  expect(runScanner()).toContain('Phase 8 evidence');
});

test('Phase 7 scanner redacts a secret canary while retaining category and path', () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'listen2-phase7-security-'));
  const marker = ['PHASE7', 'CANARY', 'SECRET'].join('_');
  writeFileSync(resolve(fixture, 'snapshot.txt'), marker, 'utf8');
  try {
    expect(() => runScanner(fixture)).toThrow();
  } catch (error) {
    const output = String((error as { stderr?: unknown }).stderr);
    expect(output).toContain('[secret]');
    expect(output).toContain('snapshot.txt');
    expect(output).not.toContain(marker);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test('backup and native playback contracts keep sensitive data private', () => {
  const manifest = readFileSync(
    resolve(mobileRoot, 'android/app/src/main/AndroidManifest.xml'),
    'utf8',
  );
  const backup = readFileSync(
    resolve(mobileRoot, 'android/app/src/main/res/xml/backup_rules.xml'),
    'utf8',
  );
  const extraction = readFileSync(
    resolve(
      mobileRoot,
      'android/app/src/main/res/xml/data_extraction_rules.xml',
    ),
    'utf8',
  );
  const bridge = readFileSync(
    resolve(mobileRoot, 'src/api/nativePlayback.ts'),
    'utf8',
  );
  const offline = readFileSync(
    resolve(
      mobileRoot,
      'android/app/src/main/java/com/listen2mobile/offline/OfflineCore.kt',
    ),
    'utf8',
  );

  expect(manifest).toContain('android:allowBackup="false"');
  expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
  expect(manifest).toContain(
    'android:dataExtractionRules="@xml/data_extraction_rules"',
  );
  expect(backup).toContain('<exclude domain="database" path="."');
  expect(extraction).toContain('<device-transfer>');
  expect(bridge).not.toContain('headers');
  expect(bridge).not.toContain('BootstrapTrack');
  expect(offline).toContain(
    'fun resolve(source: String, trackId: String): OfflineEntry? = readyLookup(source, trackId)?.first',
  );
});
