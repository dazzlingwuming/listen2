import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { generateSignal } from './performance-evidence.mjs';

// Independent bit-at-a-time CRC and verbatim decoder; do not reuse encoder helpers.
function crc(bytes, width, polynomial) {
  let value = 0; const top = 2 ** (width - 1), mask = 2 ** width - 1;
  for (const byte of bytes) {
    value ^= byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) value = ((value << 1) ^ (value & top ? polynomial : 0)) & mask;
  }
  return value;
}
assert.equal(crc(Buffer.from('123456789'), 8, 7), 0xf4);
assert.equal(crc(Buffer.from('123456789'), 16, 0x8005), 0xfee8);
function inspect(bytes) {
  assert.equal(bytes.subarray(0, 4).toString(), 'fLaC');
  let offset = 4, info, comment;
  const types = [];
  while (true) {
    const kind = bytes[offset], length = bytes.readUIntBE(offset + 1, 3);
    const block = bytes.subarray(offset + 4, offset + 4 + length); types.push(kind & 127);
    if ((kind & 127) === 0) info = block;
    if ((kind & 127) === 4) comment = block;
    offset += 4 + length; if (kind & 128) break;
  }
  assert.deepEqual(types, [0, 4]); assert.equal(info.length, 34);
  assert.equal(info.readUInt16BE(0), 1000); assert.equal(info.readUInt16BE(2), 1000);
  const packed = info.readBigUInt64BE(10), rate = Number(packed >> 44n);
  assert.equal(rate, 8000); assert.equal(Number((packed >> 41n) & 7n) + 1, 1);
  assert.equal(Number((packed >> 36n) & 31n) + 1, 16);
  const total = Number(packed & 0xfffffffffn); assert.equal(total / rate, 720);
  let p = 4 + comment.readUInt32LE(0); assert.equal(comment.readUInt32LE(p), 1); p += 4;
  const titleLength = comment.readUInt32LE(p); p += 4;
  assert.equal(comment.subarray(p, p + titleLength).toString(), 'TITLE=Listen2AcceptanceSignal');
  assert.equal(p + titleLength, comment.length);
  const pcm = Buffer.alloc(total * 2), lengths = [];
  let number = 0, samples = 0;
  while (offset < bytes.length) {
    const start = offset;
    assert.deepEqual([...bytes.subarray(offset, offset + 4)], [0xff, 0xf8, 0x74, 0x08]); offset += 4;
    const leading = bytes[offset]; let count = leading < 128 ? 1 : leading < 224 ? 2 : 3;
    let actualNumber = leading & (count === 1 ? 127 : count === 2 ? 31 : 15);
    for (let part = 1; part < count; part++) { assert.equal(bytes[offset + part] & 192, 128); actualNumber = actualNumber * 64 + (bytes[offset + part] & 63); }
    assert.equal(actualNumber, number++); offset += count;
    const blockSize = bytes.readUInt16BE(offset) + 1; offset += 2;
    assert.equal(blockSize, 1000); assert.equal(crc(bytes.subarray(start, offset), 8, 7), bytes[offset++]);
    assert.equal(bytes[offset++], 2); // mono verbatim subframe, no wasted bits
    for (let sample = 0; sample < blockSize; sample++) {
      const value = bytes.readInt16BE(offset); offset += 2;
      assert.equal(value, Math.round(Math.sin(2 * Math.PI * 11 * (samples % 400) / 400) * 1200));
      pcm.writeInt16LE(value, samples++ * 2);
    }
    assert.equal(crc(bytes.subarray(start, offset), 16, 0x8005), bytes.readUInt16BE(offset)); offset += 2;
    lengths.push(offset - start);
  }
  assert.equal(samples, total); assert.equal(number, 5760); assert.equal(offset, bytes.length);
  assert.equal(info.readUIntBE(4, 3), Math.min(...lengths)); assert.equal(info.readUIntBE(7, 3), Math.max(...lengths));
  assert.deepEqual(createHash('md5').update(pcm).digest(), info.subarray(18));
}
const directory = mkdtempSync(resolve(tmpdir(), 'listen2-controlled-flac-'));
try {
  const file = resolve(directory, 'signal.flac'), repeat = resolve(directory, 'repeat.flac');
  const generated = generateSignal(file); const bytes = readFileSync(file); inspect(bytes);
  assert.deepEqual(generateSignal(repeat), generated); assert.deepEqual(readFileSync(repeat), bytes);
  assert.throws(() => generateSignal(file), /EEXIST/);
  const corrupted = Buffer.from(bytes); corrupted[corrupted.length - 10] ^= 1;
  assert.throws(() => inspect(corrupted));
  console.log('Controlled FLAC passed: fixed TITLE, 720s mono 8kHz/16bit tone, all frame numbering/CRC8/CRC16, PCM MD5, deterministic bytes, corruption and overwrite rejected.');
} finally { rmSync(directory, { recursive: true, force: true }); }
