const assert = require("assert");
const { createHash } = require("crypto");
const os = require("os");
const path = require("path");
const { mkdtemp, rm, writeFile } = require("fs/promises");
const test = require("node:test");
const {
  LoudnessAnalyzer,
  parseTopLevelSidxDuration,
} = require("../loudnessAnalyzer");
const {
  ANALYZER_VERSION,
  MAX_GAIN_DB,
  analyzeChannels,
  calculateGainDb,
  createKWeightingCoefficients,
  integratedLufsFromBlockEnergies,
  measureTruePeak,
} = require("../loudnessAnalyzerRenderer");

function electronHarness() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    BrowserWindow: class {
      constructor() {
        throw new Error("BrowserWindow should not be created in this test");
      }
    },
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
      on(channel, handler) {
        listeners.set(channel, handler);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
      removeListener(channel) {
        listeners.delete(channel);
      },
    },
  };
}

function makeSidx({
  version = 0,
  timescale = 1000,
  durations = [60000],
  hierarchical = false,
  declaredSize,
} = {}) {
  const timingBytes = version === 0 ? 8 : 16;
  const size = 8 + 4 + 4 + 4 + timingBytes + 2 + 2 + durations.length * 12;
  const box = Buffer.alloc(size);
  box.writeUInt32BE(typeof declaredSize === "number" ? declaredSize : size, 0);
  box.write("sidx", 4, "ascii");
  box[8] = version;
  box.writeUInt32BE(1, 12);
  box.writeUInt32BE(timescale, 16);
  let cursor = 20 + timingBytes;
  cursor += 2;
  box.writeUInt16BE(durations.length, cursor);
  cursor += 2;
  for (const duration of durations) {
    const reference = hierarchical ? 0x80000400 : 0x00000400;
    box.writeUInt32BE(reference, cursor);
    box.writeUInt32BE(duration, cursor + 4);
    box.writeUInt32BE(0, cursor + 8);
    cursor += 12;
  }
  return box;
}

function sine({
  frequency,
  amplitude,
  durationSeconds = 3,
  sampleRate = 48000,
  phase = 0,
}) {
  const samples = new Float32Array(durationSeconds * sampleRate);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] =
      amplitude *
      Math.sin((2 * Math.PI * frequency * index) / sampleRate + phase);
  }
  return samples;
}

test("BS.1770 K-weighting coefficients match the 48 kHz reference", () => {
  const { shelf, highPass } = createKWeightingCoefficients(48000);
  assert.ok(Math.abs(shelf.b0 - 1.53512485958697) < 1e-12);
  assert.ok(Math.abs(shelf.b1 - -2.69169618940638) < 1e-12);
  assert.ok(Math.abs(shelf.b2 - 1.19839281085285) < 1e-12);
  assert.ok(Math.abs(shelf.a1 - -1.69065929318241) < 1e-12);
  assert.ok(Math.abs(shelf.a2 - 0.73248077421585) < 1e-12);
  assert.strictEqual(highPass.b0, 1);
  assert.strictEqual(highPass.b1, -2);
  assert.strictEqual(highPass.b2, 1);
  assert.ok(Math.abs(highPass.a1 - -1.99004745483398) < 1e-12);
  assert.ok(Math.abs(highPass.a2 - 0.99007225036621) < 1e-12);
});

test("integrated LUFS measures the ITU 997 Hz reference-level sine", () => {
  const result = analyzeChannels(
    [sine({ frequency: 997, amplitude: 0.1 })],
    48000
  );
  assert.strictEqual(result.analyzerVersion, ANALYZER_VERSION);
  assert.ok(Math.abs(result.integratedLufs - -23.01) <= 0.05);
  assert.ok(Math.abs(result.truePeakDbtp - -20) <= 0.05);
  assert.strictEqual(result.gainDb, 9.01);
});

test("absolute and relative gates exclude silence and low programme blocks", () => {
  assert.strictEqual(integratedLufsFromBlockEnergies([1e-8, 1e-8]), -Infinity);
  const gated = integratedLufsFromBlockEnergies([0.01, 0.01, 0.0001, 0.0001]);
  assert.ok(Math.abs(gated - -20.691) < 0.001);
});

test("ITU 4x FIR finds an inter-sample peak above the sample peak", () => {
  const samples = sine({
    frequency: 20000,
    amplitude: 0.9,
    durationSeconds: 1,
    phase: Math.PI / 4,
  });
  let samplePeak = 0;
  for (const value of samples)
    samplePeak = Math.max(samplePeak, Math.abs(value));
  const samplePeakDbfs = 20 * Math.log10(samplePeak);
  const truePeakDbtp = measureTruePeak([samples]);
  assert.ok(Math.abs(samplePeakDbfs - -1.2163) < 0.01);
  assert.ok(Math.abs(truePeakDbtp - -0.3382) < 0.01);
  assert.ok(truePeakDbtp > samplePeakDbfs + 0.8);
});

test("ITU FIR has an independent two-sample true-peak expectation", () => {
  const truePeakDbtp = measureTruePeak([Float32Array.from([0.5, -0.5])]);
  const truePeakAmplitude = Math.pow(10, truePeakDbtp / 20);
  // Direct Annex 2 phase calculation: 0.5 * (0.97216796875 + 0.102294921875).
  assert.ok(Math.abs(truePeakAmplitude - 0.5372314453125) < 1e-12);
});

test("gain is static, bounded, and limited by the true-peak ceiling", () => {
  assert.strictEqual(calculateGainDb(-20, -0.2), -0.8);
  assert.strictEqual(calculateGainDb(-40, -30), MAX_GAIN_DB);
  assert.strictEqual(calculateGainDb(10, 3), -24);
});

test("the verified analysis core accepts only its normalized 48 kHz domain", () => {
  assert.throws(
    () =>
      analyzeChannels(
        [sine({ frequency: 1000, amplitude: 0.1, sampleRate: 44100 })],
        44100
      ),
    (error) => error && error.code === "unsupported-sample-rate"
  );
  assert.throws(
    () =>
      analyzeChannels(
        [sine({ frequency: 1000, amplitude: 0.1, sampleRate: 96000 })],
        96000
      ),
    (error) => error && error.code === "unsupported-sample-rate"
  );
});

test("background analyzer enforces one active job", async () => {
  const analyzer = new LoudnessAnalyzer({
    ...electronHarness(),
    idleDelayMs: 0,
    parseAudioMetadata: async () => ({ format: { sampleRate: 48000 } }),
  });
  const started = [];
  analyzer.startJob = async (job) => {
    started.push(job.cacheKey);
  };
  const input = (character) => ({
    cacheKey: character.repeat(64),
    contentSha256: character.repeat(64),
    filePath: `/tmp/${character}.m4s`,
  });
  let first;
  let second;
  try {
    first = analyzer.analyze(input("a"));
    second = analyzer.analyze(input("b"));
    first.catch(() => {});
    second.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepStrictEqual(started, ["a".repeat(64)]);
    analyzer.finishCurrent(analyzer.current, null, successfulAnalyzerResult());
    await first;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepStrictEqual(started, ["a".repeat(64), "b".repeat(64)]);
    analyzer.finishCurrent(analyzer.current, null, successfulAnalyzerResult());
    await second;
  } finally {
    analyzer.shutdown();
    await Promise.allSettled([first, second].filter(Boolean));
  }
});

test("analyzer reads only the approved bytes and verifies their content hash", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "listen2-analyzer-read-")
  );
  const filePath = path.join(rootDir, "audio.m4s");
  const original = Buffer.from("approved");
  await writeFile(filePath, original);
  let metadataOptions;
  const analyzer = new LoudnessAnalyzer({
    ...electronHarness(),
    idleDelayMs: 0,
    parseAudioMetadata: async (bytes, fileInfo, options) => {
      metadataOptions = options;
      return {
        format: {
          sampleRate: 48000,
          duration: 60,
          numberOfChannels: 2,
        },
      };
    },
  });
  const webContents = {};
  const job = {
    token: "token",
    filePath,
    byteLength: original.length,
    contentSha256: createHash("sha256").update(original).digest("hex"),
    window: { isDestroyed: () => false, webContents },
  };
  try {
    analyzer.current = job;
    const approved = await analyzer.handleReadInput(
      { sender: webContents },
      "token"
    );
    assert.strictEqual(approved.ok, true);
    assert.deepStrictEqual(approved.bytes, original);
    assert.strictEqual(approved.sourceSampleRate, 48000);
    assert.strictEqual(metadataOptions.duration, true);
    await writeFile(filePath, Buffer.from("tampered"));
    assert.deepStrictEqual(
      await analyzer.handleReadInput({ sender: webContents }, "token"),
      { ok: false, errorCode: "analysis-content-mismatch" }
    );
    await writeFile(filePath, original);
    for (const sourceSampleRate of [
      8000, 22050, 32000, 44100, 48000, 88200, 96000, 192000,
    ]) {
      analyzer.parseAudioMetadata = async () => ({
        format: {
          sampleRate: sourceSampleRate,
          duration: 60,
          numberOfChannels: 2,
        },
      });
      const resampledInput = await analyzer.handleReadInput(
        { sender: webContents },
        "token"
      );
      assert.strictEqual(resampledInput.ok, true);
      assert.strictEqual(resampledInput.sourceSampleRate, sourceSampleRate);
    }
    for (const invalidSampleRate of [undefined, NaN, 0, -1, 44100.5]) {
      analyzer.parseAudioMetadata = async () => ({
        format: {
          sampleRate: invalidSampleRate,
          duration: 60,
          numberOfChannels: 2,
        },
      });
      assert.deepStrictEqual(
        await analyzer.handleReadInput({ sender: webContents }, "token"),
        { ok: false, errorCode: "invalid-source-sample-rate" }
      );
    }
  } finally {
    analyzer.current = null;
    analyzer.shutdown();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("metadata resource limits reject bytes before Web Audio decoding", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "listen2-analyzer-limits-")
  );
  const filePath = path.join(rootDir, "audio.m4s");
  const bytes = Buffer.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
  await writeFile(filePath, bytes);
  let format = {};
  const analyzer = new LoudnessAnalyzer({
    ...electronHarness(),
    idleDelayMs: 0,
    parseAudioMetadata: async () => ({ format }),
  });
  const webContents = {};
  const job = {
    token: "token",
    filePath,
    byteLength: bytes.length,
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    window: { isDestroyed: () => false, webContents },
  };
  const read = () => analyzer.handleReadInput({ sender: webContents }, "token");
  try {
    analyzer.current = job;
    for (const invalidDuration of [undefined, NaN, 0, -1]) {
      format = {
        sampleRate: 48000,
        duration: invalidDuration,
        numberOfChannels: 2,
      };
      assert.deepStrictEqual(await read(), {
        ok: false,
        errorCode: "invalid-audio-duration",
      });
    }
    format = { sampleRate: 48000, duration: 900.01, numberOfChannels: 2 };
    assert.deepStrictEqual(await read(), {
      ok: false,
      errorCode: "audio-too-long",
    });
    for (const invalidChannels of [undefined, 0, -1, 1.5, 7]) {
      format = {
        sampleRate: 48000,
        duration: 60,
        numberOfChannels: invalidChannels,
      };
      assert.deepStrictEqual(await read(), {
        ok: false,
        errorCode: "unsupported-channel-layout",
      });
    }
    format = { sampleRate: 48000, duration: 900, numberOfChannels: 6 };
    assert.deepStrictEqual(await read(), {
      ok: false,
      errorCode: "decoded-audio-too-large",
    });
  } finally {
    analyzer.current = null;
    analyzer.shutdown();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("bounded reader detects growth on the same file descriptor", async () => {
  const original = Buffer.from("approved");
  let openCount = 0;
  let statCount = 0;
  let readCount = 0;
  let closeCount = 0;
  let allocatedLength = 0;
  const handle = {
    async stat() {
      statCount += 1;
      return {
        isFile: () => true,
        size: statCount === 1 ? original.length : original.length + 1,
      };
    },
    async read(target, offset, length) {
      readCount += 1;
      allocatedLength = target.length;
      original.copy(target, offset, 0, length);
      return { bytesRead: length };
    },
    async close() {
      closeCount += 1;
    },
  };
  const analyzer = new LoudnessAnalyzer({
    ...electronHarness(),
    idleDelayMs: 0,
    openFile: async () => {
      openCount += 1;
      return handle;
    },
    parseAudioMetadata: async () => {
      throw new Error("metadata must not be reached after growth");
    },
  });
  const webContents = {};
  analyzer.current = {
    token: "token",
    filePath: "/tmp/growing-audio.m4s",
    byteLength: original.length,
    contentSha256: createHash("sha256").update(original).digest("hex"),
    window: { isDestroyed: () => false, webContents },
  };
  try {
    assert.deepStrictEqual(
      await analyzer.handleReadInput({ sender: webContents }, "token"),
      { ok: false, errorCode: "analysis-file-changed" }
    );
    assert.strictEqual(openCount, 1);
    assert.strictEqual(statCount, 2);
    assert.strictEqual(readCount, 1);
    assert.strictEqual(allocatedLength, original.length);
    assert.strictEqual(closeCount, 1);
  } finally {
    analyzer.current = null;
    analyzer.shutdown();
  }
});

test("top-level sidx v0/v1 gates fragmented media before decode", async () => {
  const v0 = makeSidx({ version: 0, durations: [45000, 46000] });
  const v1 = makeSidx({ version: 1, durations: [456000] });
  assert.strictEqual(parseTopLevelSidxDuration(v0), 91);
  assert.strictEqual(parseTopLevelSidxDuration(v1), 456);

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "listen2-sidx-limits-"));
  const filePath = path.join(rootDir, "audio.m4s");
  const analyzer = new LoudnessAnalyzer({
    ...electronHarness(),
    idleDelayMs: 0,
    parseAudioMetadata: async () => ({
      format: { sampleRate: 48000, duration: 0, numberOfChannels: 2 },
    }),
  });
  const webContents = {};
  const job = {
    token: "token",
    filePath,
    window: { isDestroyed: () => false, webContents },
  };
  const setBytes = async (bytes) => {
    await writeFile(filePath, bytes);
    job.byteLength = bytes.length;
    job.contentSha256 = createHash("sha256").update(bytes).digest("hex");
  };
  const read = () => analyzer.handleReadInput({ sender: webContents }, "token");
  try {
    analyzer.current = job;
    await setBytes(v0);
    assert.strictEqual((await read()).ok, true);
    await setBytes(v1);
    assert.strictEqual((await read()).ok, true);

    await setBytes(makeSidx({ durations: [900001] }));
    assert.deepStrictEqual(await read(), {
      ok: false,
      errorCode: "audio-too-long",
    });

    await setBytes(makeSidx({ hierarchical: true }));
    assert.deepStrictEqual(await read(), {
      ok: false,
      errorCode: "unsupported-sidx-reference",
    });

    const malformed = makeSidx({ declaredSize: v0.length + 12 });
    await setBytes(malformed);
    assert.deepStrictEqual(await read(), {
      ok: false,
      errorCode: "invalid-isobmff",
    });
  } finally {
    analyzer.current = null;
    analyzer.shutdown();
    await rm(rootDir, { recursive: true, force: true });
  }
});

function successfulAnalyzerResult() {
  return {
    integratedLufs: -18,
    truePeakDbtp: -2,
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    gainDb: 1,
    sampleRate: 48000,
    channelCount: 2,
    durationSeconds: 60,
  };
}
