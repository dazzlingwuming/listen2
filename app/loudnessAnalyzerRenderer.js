(function initializeLoudnessCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Listen2LoudnessCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createCore() {
  "use strict";

  const ANALYZER_VERSION = "bs1770-5-r128-itu-fir48-v1";
  const TARGET_LUFS = -14;
  const TRUE_PEAK_CEILING_DBTP = -1;
  const MIN_GAIN_DB = -24;
  const MAX_GAIN_DB = 12;
  const ABSOLUTE_GATE_LUFS = -70;
  const RELATIVE_GATE_LU = -10;
  const MAX_CHANNELS = 6;
  const TRUE_PEAK_SAMPLE_RATE = 48000;
  const MAX_DURATION_SECONDS = 15 * 60;
  const MAX_DECODED_SAMPLE_VALUES = 60 * 1000 * 1000;

  // ITU-R BS.1770-5 Annex 2: order-48, 4-phase FIR interpolator.
  const TRUE_PEAK_FIR = [
    [
      0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125,
      -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875,
      0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125,
    ],
    [
      -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125,
      -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125,
      0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
    ],
    [
      -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625,
      -0.2003173828125, 0.77978515625, 0.465087890625, -0.16650390625,
      0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
    ],
    [
      -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875,
      -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875,
      0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375,
    ],
  ];
  const TRUE_PEAK_PHASE_BOUNDS = TRUE_PEAK_FIR.map((phase) =>
    phase.reduce((sum, coefficient) => sum + Math.abs(coefficient), 0)
  );

  function analysisError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  function assertDeadline(deadlineMs) {
    if (Number.isFinite(deadlineMs) && Date.now() > deadlineMs) {
      throw analysisError("analysis-timeout", "Loudness analysis timed out.");
    }
  }

  function createKWeightingCoefficients(sampleRate) {
    if (sampleRate !== TRUE_PEAK_SAMPLE_RATE) {
      throw analysisError(
        "unsupported-sample-rate",
        "This analyzer version supports 48 kHz decoded audio only."
      );
    }
    return {
      shelf: {
        b0: 1.53512485958697,
        b1: -2.69169618940638,
        b2: 1.19839281085285,
        a1: -1.69065929318241,
        a2: 0.73248077421585,
      },
      highPass: {
        b0: 1,
        b1: -2,
        b2: 1,
        a1: -1.99004745483398,
        a2: 0.99007225036621,
      },
    };
  }

  function channelWeights(channelCount) {
    switch (channelCount) {
      case 1:
        return [1];
      case 2:
        return [1, 1];
      case 3:
        return [1, 1, 1];
      case 4:
        return [1, 1, 1.41, 1.41];
      case 5:
        return [1, 1, 1, 1.41, 1.41];
      case 6:
        // Web Audio's 5.1 order is L, R, C, LFE, SL, SR. LFE is excluded.
        return [1, 1, 1, 0, 1.41, 1.41];
      default:
        throw analysisError(
          "unsupported-channel-layout",
          "Unsupported channel layout."
        );
    }
  }

  function integratedLufsFromBlockEnergies(blockEnergies) {
    const absoluteGated = blockEnergies.filter((energy) => {
      if (!(energy > 0) || !Number.isFinite(energy)) return false;
      return -0.691 + 10 * Math.log10(energy) > ABSOLUTE_GATE_LUFS;
    });
    if (!absoluteGated.length) return -Infinity;
    const absoluteMean =
      absoluteGated.reduce((sum, energy) => sum + energy, 0) /
      absoluteGated.length;
    const relativeThreshold =
      -0.691 + 10 * Math.log10(absoluteMean) + RELATIVE_GATE_LU;
    const finalGate = Math.max(ABSOLUTE_GATE_LUFS, relativeThreshold);
    const relativeGated = absoluteGated.filter(
      (energy) => -0.691 + 10 * Math.log10(energy) > finalGate
    );
    if (!relativeGated.length) return -Infinity;
    const integratedEnergy =
      relativeGated.reduce((sum, energy) => sum + energy, 0) /
      relativeGated.length;
    return -0.691 + 10 * Math.log10(integratedEnergy);
  }

  function measureIntegratedLufs(channels, sampleRate, deadlineMs) {
    const frames = channels[0].length;
    const stepFrames = Math.round(sampleRate * 0.1);
    const blockFrames = stepFrames * 4;
    if (frames < blockFrames) {
      throw analysisError("audio-too-short", "Audio is shorter than 400 ms.");
    }
    const segmentCount = Math.ceil(frames / stepFrames);
    const segmentEnergies = new Float64Array(segmentCount);
    const weights = channelWeights(channels.length);
    const coefficients = createKWeightingCoefficients(sampleRate);

    for (
      let channelIndex = 0;
      channelIndex < channels.length;
      channelIndex += 1
    ) {
      const weight = weights[channelIndex];
      if (!weight) continue;
      const samples = channels[channelIndex];
      let shelfX1 = 0;
      let shelfX2 = 0;
      let shelfY1 = 0;
      let shelfY2 = 0;
      let highX1 = 0;
      let highX2 = 0;
      let highY1 = 0;
      let highY2 = 0;
      let segment = 0;
      let segmentEnd = stepFrames;
      let sumSquares = 0;
      for (let index = 0; index < frames; index += 1) {
        const input = samples[index];
        const shelfOutput =
          coefficients.shelf.b0 * input +
          coefficients.shelf.b1 * shelfX1 +
          coefficients.shelf.b2 * shelfX2 -
          coefficients.shelf.a1 * shelfY1 -
          coefficients.shelf.a2 * shelfY2;
        shelfX2 = shelfX1;
        shelfX1 = input;
        shelfY2 = shelfY1;
        shelfY1 = shelfOutput;
        const output =
          coefficients.highPass.b0 * shelfOutput +
          coefficients.highPass.b1 * highX1 +
          coefficients.highPass.b2 * highX2 -
          coefficients.highPass.a1 * highY1 -
          coefficients.highPass.a2 * highY2;
        highX2 = highX1;
        highX1 = shelfOutput;
        highY2 = highY1;
        highY1 = output;
        sumSquares += output * output;
        if (index + 1 === segmentEnd || index + 1 === frames) {
          segmentEnergies[segment] += weight * sumSquares;
          segment += 1;
          segmentEnd += stepFrames;
          sumSquares = 0;
          if ((segment & 31) === 0) assertDeadline(deadlineMs);
        }
      }
    }

    const blockEnergies = [];
    const completeSegments = Math.floor(frames / stepFrames);
    for (let segment = 0; segment + 4 <= completeSegments; segment += 1) {
      blockEnergies.push(
        (segmentEnergies[segment] +
          segmentEnergies[segment + 1] +
          segmentEnergies[segment + 2] +
          segmentEnergies[segment + 3]) /
          blockFrames
      );
    }
    return integratedLufsFromBlockEnergies(blockEnergies);
  }

  function measureTruePeak(channels, deadlineMs) {
    let peak = 0;
    for (const samples of channels) {
      for (let index = 0; index < samples.length; index += 1) {
        const absolute = Math.abs(samples[index]);
        if (absolute > peak) peak = absolute;
      }
    }

    const chunkFrames = 1024;
    for (const samples of channels) {
      for (
        let chunkStart = 0;
        chunkStart < samples.length + 11;
        chunkStart += chunkFrames
      ) {
        const chunkEnd = Math.min(
          samples.length + 11,
          chunkStart + chunkFrames
        );
        const sourceStart = Math.max(0, chunkStart - 11);
        const sourceEnd = Math.min(samples.length, chunkEnd);
        let localPeak = 0;
        for (let index = sourceStart; index < sourceEnd; index += 1) {
          const absolute = Math.abs(samples[index]);
          if (absolute > localPeak) localPeak = absolute;
        }
        for (
          let phaseIndex = 0;
          phaseIndex < TRUE_PEAK_FIR.length;
          phaseIndex += 1
        ) {
          if (localPeak * TRUE_PEAK_PHASE_BOUNDS[phaseIndex] <= peak) continue;
          const phase = TRUE_PEAK_FIR[phaseIndex];
          for (
            let outputIndex = chunkStart;
            outputIndex < chunkEnd;
            outputIndex += 1
          ) {
            let value = 0;
            for (let tap = 0; tap < phase.length; tap += 1) {
              const inputIndex = outputIndex - tap;
              if (inputIndex >= 0 && inputIndex < samples.length) {
                value += samples[inputIndex] * phase[tap];
              }
            }
            const absolute = Math.abs(value);
            if (absolute > peak) peak = absolute;
          }
        }
        assertDeadline(deadlineMs);
      }
    }
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  }

  function calculateGainDb(
    integratedLufs,
    truePeakDbtp,
    targetLufs = TARGET_LUFS,
    truePeakCeilingDbtp = TRUE_PEAK_CEILING_DBTP
  ) {
    if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbtp)) {
      throw analysisError("silence", "No measurable programme loudness.");
    }
    const loudnessGain = targetLufs - integratedLufs;
    const peakLimitedGain = truePeakCeilingDbtp - truePeakDbtp;
    const gainDb = Math.max(
      MIN_GAIN_DB,
      Math.min(MAX_GAIN_DB, loudnessGain, peakLimitedGain)
    );
    return Math.round(gainDb * 100) / 100;
  }

  function validateChannels(channels, sampleRate) {
    if (sampleRate !== TRUE_PEAK_SAMPLE_RATE) {
      throw analysisError(
        "unsupported-sample-rate",
        "This analyzer version supports 48 kHz decoded audio only."
      );
    }
    if (
      !Array.isArray(channels) ||
      !channels.length ||
      channels.length > MAX_CHANNELS
    ) {
      throw analysisError(
        "unsupported-channel-layout",
        "Unsupported channel layout."
      );
    }
    const frames = channels[0] && channels[0].length;
    if (!Number.isSafeInteger(frames) || frames <= 0) {
      throw analysisError("decode-empty", "Decoded audio is empty.");
    }
    if (
      frames / sampleRate > MAX_DURATION_SECONDS ||
      frames * channels.length > MAX_DECODED_SAMPLE_VALUES
    ) {
      throw analysisError(
        "decoded-audio-too-large",
        "Decoded audio exceeds analysis limits."
      );
    }
    for (const channel of channels) {
      if (!channel || channel.length !== frames) {
        throw analysisError(
          "invalid-channel-data",
          "Decoded channels have different lengths."
        );
      }
    }
  }

  function analyzeChannels(channels, sampleRate, options = {}) {
    validateChannels(channels, sampleRate);
    const deadlineMs = Number(options.deadlineMs);
    const integratedLufs = measureIntegratedLufs(
      channels,
      sampleRate,
      deadlineMs
    );
    const truePeakDbtp = measureTruePeak(channels, deadlineMs);
    const gainDb = calculateGainDb(integratedLufs, truePeakDbtp);
    return {
      analyzerVersion: ANALYZER_VERSION,
      integratedLufs: Math.round(integratedLufs * 100) / 100,
      truePeakDbtp: Math.round(truePeakDbtp * 100) / 100,
      targetLufs: TARGET_LUFS,
      truePeakCeilingDbtp: TRUE_PEAK_CEILING_DBTP,
      gainDb,
      sampleRate,
      channelCount: channels.length,
      durationSeconds:
        Math.round((channels[0].length / sampleRate) * 1000) / 1000,
    };
  }

  async function runBrowserAnalysis() {
    if (
      typeof window === "undefined" ||
      !window.loudnessAnalyzerBridge ||
      !window.location
    ) {
      return;
    }
    const token =
      new URLSearchParams(window.location.search).get("token") || "";
    if (!token) return;
    let context;
    try {
      const input = await window.loudnessAnalyzerBridge.readInput(token);
      if (!input || input.ok !== true) {
        throw analysisError(
          input && /^[a-z0-9-]{1,80}$/.test(String(input.errorCode || ""))
            ? input.errorCode
            : "invalid-analyzer-response",
          "Cached audio input is unavailable."
        );
      }
      if (input.sourceSampleRate !== TRUE_PEAK_SAMPLE_RATE) {
        throw analysisError(
          "unsupported-sample-rate",
          "This analyzer version supports 48 kHz source audio only."
        );
      }
      const bytes = input.bytes;
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const encoded = view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength
      );
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw analysisError(
          "decoder-unavailable",
          "Web Audio decoding is unavailable."
        );
      }
      context = new AudioContextClass({ sampleRate: TRUE_PEAK_SAMPLE_RATE });
      const decoded = await context.decodeAudioData(encoded);
      const channels = [];
      for (let index = 0; index < decoded.numberOfChannels; index += 1) {
        channels.push(decoded.getChannelData(index));
      }
      const result = analyzeChannels(channels, decoded.sampleRate, {
        deadlineMs: Date.now() + 90 * 1000,
      });
      window.loudnessAnalyzerBridge.finish(token, { ok: true, result });
    } catch (error) {
      window.loudnessAnalyzerBridge.finish(token, {
        ok: false,
        errorCode: String(
          (error && error.code) || "decode-or-analysis-failed"
        ).slice(0, 80),
      });
    } finally {
      if (context && typeof context.close === "function") {
        await context.close().catch(() => {});
      }
    }
  }

  if (typeof window !== "undefined" && window.document) {
    window.addEventListener("DOMContentLoaded", () => {
      runBrowserAnalysis();
    });
  }

  return {
    ABSOLUTE_GATE_LUFS,
    ANALYZER_VERSION,
    MAX_CHANNELS,
    MAX_DECODED_SAMPLE_VALUES,
    MAX_DURATION_SECONDS,
    MAX_GAIN_DB,
    MIN_GAIN_DB,
    RELATIVE_GATE_LU,
    TARGET_LUFS,
    TRUE_PEAK_CEILING_DBTP,
    TRUE_PEAK_FIR,
    TRUE_PEAK_SAMPLE_RATE,
    analyzeChannels,
    calculateGainDb,
    createKWeightingCoefficients,
    integratedLufsFromBlockEnergies,
    measureIntegratedLufs,
    measureTruePeak,
  };
});
