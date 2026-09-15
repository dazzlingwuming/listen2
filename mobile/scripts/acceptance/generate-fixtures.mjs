#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const scriptDir = resolve(import.meta.dirname);
const fixture = JSON.parse(readFileSync(resolve(scriptDir, 'fixtures/phase08.json'), 'utf8'));
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const output = outIndex >= 0 ? resolve(args[outIndex + 1] || '') : null;

function sha(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
function wavHeader(bytes, sampleRate, frames) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + bytes, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(bytes, 40); return header;
}
function generate(directory) {
  const rate = 8000, frames = fixture.localFixture.durationSeconds * rate;
  const pcm = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 220 * frame) / rate) * 1200);
    pcm.writeInt16LE(value, frame * 2);
  }
  const wav = resolve(directory, fixture.localFixture.file);
  const lrc = resolve(directory, fixture.localFixture.lyrics);
  writeFileSync(wav, Buffer.concat([wavHeader(pcm.length, rate, frames), pcm]), { mode: 0o600 });
  writeFileSync(lrc, '[00:00.00]Listen2 generated acceptance signal\n[09:59.00]No copyrighted lyrics\n', { mode: 0o600 });
  return { wav, lrc, bytes: statSync(wav).size, sha256: sha(wav), lrcSha256: sha(lrc), durationSeconds: fixture.localFixture.durationSeconds };
}
if (args.includes('--self-test')) {
  const dir = mkdtempSync(resolve(tmpdir(), 'listen2-phase08-fixture-'));
  try {
    const result = generate(dir);
    if (result.bytes <= 44 || result.durationSeconds !== 600) throw new Error('fixture self-test failed');
    const driver = readFileSync(resolve(scriptDir, '../../android/app/src/androidTest/java/com/listen2mobile/acceptance/AccessibilityDriver.java'), 'utf8');
    if (driver.includes('uiautomator dump')) throw new Error('instrumentation must not start a nested uiautomator service');
    if (!driver.includes('getRootInActiveWindow') || !driver.includes('getExternalFilesDir')) {
      throw new Error('accessibility evidence must use runner-owned UI automation and target external files');
    }
    console.log('Phase 8 fixture self-test passed.');
  }
  finally { rmSync(dir, { recursive: true, force: true }); }
} else {
  if (!output || !existsSync(output)) throw new Error('use --out with an existing contained run directory');
  console.log(JSON.stringify(generate(output)));
}
