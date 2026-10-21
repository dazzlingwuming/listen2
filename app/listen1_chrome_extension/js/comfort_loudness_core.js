/* eslint-disable no-param-reassign, no-underscore-dangle, max-classes-per-file */
/* global module globalThis */
/* Pure DSP shared by AudioWorklet and synthetic/offline reference tests. */
(function initializeComfort(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Listen2Comfort = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const TARGET_LUFS = -16;
  const MIN_GAIN_DB = -18;
  const MAX_GAIN_DB = 9;
  // The detector is ITU Annex 2 4x FIR, not a soft clipper. Half a dB of
  // engineering margin covers gain-envelope modulation; final -1 dBTP must
  // also be checked by an independent oversampled meter on rendered output.
  const LIMIT_DBTP = -1.5;
  const LOOKAHEAD_SECONDS = 0.012;
  const FIR = [
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
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const toLinear = (db) => 10 ** (db / 20);
  const toLufs = (energy) =>
    energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity;

  function kCoefficients(rate) {
    // BS.1770 K-weighting bilinear transform (De Man parameters), including
    // the high-pass numerator normalization used by the 48 kHz reference.
    const k = Math.tan((Math.PI * 1681.974450955533) / rate);
    const vh = 10 ** (3.999843853973347 / 20);
    const vb = vh ** 0.4996667741545416;
    const denominator = 1 + k / 0.7071752369554196 + k * k;
    const highK = Math.tan((Math.PI * 38.13547087602444) / rate);
    const highDenominator = 1 + highK / 0.5003270373238773 + highK * highK;
    return [
      [
        (vh + (vb * k) / 0.7071752369554196 + k * k) / denominator,
        (2 * (k * k - vh)) / denominator,
        (vh - (vb * k) / 0.7071752369554196 + k * k) / denominator,
        (2 * (k * k - 1)) / denominator,
        (1 - k / 0.7071752369554196 + k * k) / denominator,
      ],
      [
        1,
        -2,
        1,
        (2 * (highK * highK - 1)) / highDenominator,
        (1 - highK / 0.5003270373238773 + highK * highK) / highDenominator,
      ],
    ];
  }

  class KFilter {
    constructor(rate) {
      this.coefficients = kCoefficients(rate);
      this.states = [new Float64Array(4), new Float64Array(4)];
    }

    process(input) {
      let value = input;
      for (let stage = 0; stage < 2; stage += 1) {
        const c = this.coefficients[stage];
        const s = this.states[stage];
        const output =
          c[0] * value + c[1] * s[0] + c[2] * s[1] - c[3] * s[2] - c[4] * s[3];
        s[1] = s[0];
        s[0] = value;
        s[3] = s[2];
        s[2] = output;
        value = output;
      }
      return value;
    }
  }

  class ComfortProcessor {
    constructor(rate = 48000) {
      if (!Number.isFinite(rate) || rate < 32000 || rate > 192000) {
        throw new Error('unsupported-processing-rate');
      }
      this.rate = rate;
      this.delayFrames = Math.ceil(rate * LOOKAHEAD_SECONDS);
      this.ringSize = this.delayFrames + 32;
      this.delay = [
        new Float64Array(this.ringSize),
        new Float64Array(this.ringSize),
      ];
      this.history = [new Float64Array(12), new Float64Array(12)];
      this.peakValues = new Float64Array(this.ringSize);
      this.peakIndices = new Float64Array(this.ringSize);
      this.ceiling = toLinear(LIMIT_DBTP);
      this.release = Math.exp(-1 / (rate * 0.2));
      this.attack = Math.exp(-1 / (rate * 0.001));
      this.enabled = false;
      this.effect = 'original';
      this.volume = 1;
      this.paused = false;
      this.gainDb = 0;
      this.fxMakeupDb = 0;
      this.targetGainDb = 0;
      this.targetFxDb = 0;
      this.fxSettleFrames = 0;
      this.transparentFrames = 0;
      this.reset();
    }

    reset() {
      this.delay.forEach((channel) => channel.fill(0));
      this.history.forEach((channel) => channel.fill(0));
      this.frame = 0;
      this.head = 0;
      this.tail = 0;
      this.limiterGain = 1;
      this.emptyFrames = 0;
      this.idle = false;
      this.clearMeter();
    }

    clearMeter() {
      this.referenceFilters = [new KFilter(this.rate), new KFilter(this.rate)];
      this.effectFilters = [new KFilter(this.rate), new KFilter(this.rate)];
      this.outputFilters = [new KFilter(this.rate), new KFilter(this.rate)];
      this.outputHistory = [new Float64Array(12), new Float64Array(12)];
      this.outputHistoryFrame = 0;
      this.outputPeak = 0;
      this.segmentOutput = 0;
      this.outputSegments = [];
      this.outputLufs = null;
      this.segmentFrames = 0;
      this.segmentReference = 0;
      this.segmentEffect = 0;
      this.referenceSegments = [];
      this.effectSegments = [];
      this.blocks = [];
      this.activeFrames = 0;
      this.inputLufs = null;
    }

    configure(options = {}) {
      const previousEnabled = this.enabled;
      const previousPaused = this.paused;
      const previousVolume = this.volume;
      this.enabled = options.enabled === true;
      this.volume = clamp(Number(options.volume) || 0, 0, 1);
      this.paused = options.paused === true;
      const nextEffect = String(options.effect || 'original');
      if (nextEffect !== this.effect) this.fxSettleFrames = this.rate;
      if (options.reset || previousPaused !== this.paused) {
        this.reset();
      } else if (nextEffect !== this.effect || previousVolume !== this.volume) {
        this.clearMeter();
      }
      this.effect = nextEffect;
      this.knownLufs = Number.isFinite(options.knownLufs)
        ? options.knownLufs
        : null;
      if (!this.enabled) this.targetGainDb = 0;
      else if (this.knownLufs !== null) {
        this.targetGainDb = clamp(
          TARGET_LUFS - this.knownLufs,
          MIN_GAIN_DB,
          MAX_GAIN_DB
        );
      }
      if (options.reset && !options.preserveGainOnReset) {
        if (this.enabled && this.knownLufs === null) this.targetGainDb = 0;
        this.gainDb = this.enabled ? this.targetGainDb : 0;
        this.fxMakeupDb = 0;
        this.targetFxDb = 0;
      } else if (
        previousEnabled !== this.enabled &&
        this.enabled &&
        this.knownLufs === null
      ) {
        this.targetGainDb = 0;
      }
      if (previousEnabled !== this.enabled)
        this.toggleFrames = Math.round(this.rate * 0.08);
      if (this.effect === 'original') {
        this.targetFxDb = 0;
        this.fxReturnFrames = Math.round(this.rate * 0.08);
      }
    }

    updateMeasurement(referenceEnergy, effectEnergy) {
      const segmentLength = Math.round(this.rate * 0.1);
      const correction =
        this.volume > 0.0001 ? 1 / (this.volume * this.volume) : 0;
      this.referenceSegments.push(
        (referenceEnergy / segmentLength) * correction
      );
      this.effectSegments.push((effectEnergy / segmentLength) * correction);
      if (this.referenceSegments.length > 30) {
        this.referenceSegments.shift();
        this.effectSegments.shift();
      }
      if (!correction || this.paused) return;
      const newestReference =
        this.referenceSegments[this.referenceSegments.length - 1];
      const newestEffect = this.effectSegments[this.effectSegments.length - 1];
      // FX compares the same material and may react in 100 ms; it does not
      // need the three-second unknown-program boost gate.
      if (
        this.effect !== 'original' &&
        toLufs(newestReference) > -60 &&
        toLufs(newestEffect) > -60
      ) {
        this.targetFxDb = clamp(
          10 * Math.log10(newestReference / newestEffect),
          -6,
          9
        );
      }
      if (this.referenceSegments.length < 4) return;
      const recentReference =
        this.referenceSegments
          .slice(-4)
          .reduce((sum, value) => sum + value, 0) / 4;
      const recentEffect =
        this.effectSegments.slice(-4).reduce((sum, value) => sum + value, 0) /
        4;
      // Silence gates both controllers; neither a silent intro nor a muted
      // element can keep ratcheting gain up. Always keep the hard boost bound.
      if (toLufs(recentReference) <= -60 || toLufs(recentEffect) <= -60) return;
      this.activeFrames += segmentLength;
      this.blocks.push(recentReference);
      if (this.blocks.length > 30) this.blocks.shift();
      const absolute = this.blocks.filter((energy) => toLufs(energy) > -60);
      const mean =
        absolute.reduce((sum, value) => sum + value, 0) / absolute.length;
      const threshold = Math.max(-60, toLufs(mean) - 10);
      const gated = absolute.filter((energy) => toLufs(energy) > threshold);
      const energy =
        gated.reduce((sum, value) => sum + value, 0) / gated.length;
      this.inputLufs = toLufs(energy);
      if (this.enabled && this.knownLufs === null) {
        const desiredGain = clamp(
          TARGET_LUFS - this.inputLufs,
          MIN_GAIN_DB,
          MAX_GAIN_DB
        );
        // Reduce a loud unknown source after the first 400 ms window. Boosts
        // wait for three seconds of gated material, avoiding a silent-intro AGC.
        if (desiredGain < this.gainDb || this.activeFrames >= this.rate * 3) {
          this.targetGainDb = desiredGain;
        }
      }
    }

    process(effectChannels, referenceChannels, outputChannels) {
      const frames = outputChannels[0].length;
      if (this.paused) {
        outputChannels.forEach((channel) => channel.fill(0));
        return;
      }
      // Scan at most two small render quanta, not FIR/meter work per sample.
      // Drain existing lookahead before parking a genuinely silent input.
      let silent = true;
      for (let channel = 0; channel < 2 && silent; channel += 1) {
        const effect = effectChannels[channel] || effectChannels[0];
        const reference = referenceChannels[channel] || referenceChannels[0];
        for (let index = 0; index < frames; index += 1) {
          if ((effect && effect[index]) || (reference && reference[index])) {
            silent = false;
            break;
          }
        }
      }
      if (
        silent &&
        this.emptyFrames >= this.delayFrames + 12 &&
        (this.volume === 0 ||
          (!(this.toggleFrames > 0) && !(this.fxReturnFrames > 0)))
      ) {
        if (!this.idle) {
          this.clearMeter();
          this.idle = true;
        }
        outputChannels.forEach((channel) => channel.fill(0));
        return;
      }
      this.emptyFrames = silent ? this.emptyFrames + frames : 0;
      this.idle = false;
      for (let index = 0; index < frames; index += 1) {
        const controlsActive = !this.paused && this.volume > 0.0001;
        const gainStep = !controlsActive
          ? 0
          : this.toggleFrames > 0
          ? Math.abs(this.targetGainDb - this.gainDb) / this.toggleFrames
          : (this.targetGainDb < this.gainDb ? 6 : 0.75) / this.rate;
        this.gainDb += clamp(
          this.targetGainDb - this.gainDb,
          -gainStep,
          gainStep
        );
        if (controlsActive && this.toggleFrames > 0) this.toggleFrames -= 1;
        const fxStep = !controlsActive
          ? 0
          : this.fxReturnFrames > 0
          ? Math.abs(this.targetFxDb - this.fxMakeupDb) / this.fxReturnFrames
          : (this.fxSettleFrames > 0
              ? this.targetFxDb < this.fxMakeupDb
                ? 24
                : 6
              : 3) / this.rate;
        this.fxMakeupDb += clamp(
          this.targetFxDb - this.fxMakeupDb,
          -fxStep,
          fxStep
        );
        if (controlsActive && this.fxSettleFrames > 0) this.fxSettleFrames -= 1;
        if (controlsActive && this.fxReturnFrames > 0) this.fxReturnFrames -= 1;
        if (
          !this.enabled &&
          this.effect === 'original' &&
          Math.abs(this.gainDb) < 1e-9 &&
          Math.abs(this.fxMakeupDb) < 1e-9
        ) {
          this.transparentFrames += 1;
        } else this.transparentFrames = 0;
        // Retain protection until former boosted samples leave lookahead.
        // Original + comfort off then restores the original waveform peaks.
        const transparent = this.transparentFrames > this.delayFrames + 12;
        const gain = toLinear(this.gainDb + this.fxMakeupDb);
        const slot = this.frame % this.ringSize;
        const historySlot = this.frame % 12;
        let detectedPeak = 0;
        for (let channel = 0; channel < 2; channel += 1) {
          const input = effectChannels[channel] || effectChannels[0];
          const reference = referenceChannels[channel] || referenceChannels[0];
          const raw =
            input && Number.isFinite(input[index]) && !this.paused
              ? input[index]
              : 0;
          const ref =
            reference && Number.isFinite(reference[index]) && !this.paused
              ? reference[index]
              : 0;
          const weightedReference = this.referenceFilters[channel].process(ref);
          const weightedEffect = this.effectFilters[channel].process(raw);
          this.segmentReference += weightedReference * weightedReference;
          this.segmentEffect += weightedEffect * weightedEffect;
          const value = raw * gain;
          this.delay[channel][slot] = value;
          this.history[channel][historySlot] = value;
          detectedPeak = Math.max(detectedPeak, Math.abs(value));
          for (let phase = 0; phase < 4; phase += 1) {
            let interpolated = 0;
            for (let tap = 0; tap < 12; tap += 1) {
              interpolated +=
                this.history[channel][(historySlot - tap + 12) % 12] *
                FIR[phase][tap];
            }
            detectedPeak = Math.max(detectedPeak, Math.abs(interpolated));
          }
        }
        // Monotonic deque: linked stereo peak envelope over the whole lookahead.
        while (
          this.tail > this.head &&
          this.peakValues[(this.tail - 1) % this.ringSize] <= detectedPeak
        )
          this.tail -= 1;
        this.peakValues[this.tail % this.ringSize] = detectedPeak;
        this.peakIndices[this.tail % this.ringSize] = this.frame;
        this.tail += 1;
        while (
          this.tail > this.head &&
          this.peakIndices[this.head % this.ringSize] <
            this.frame - this.delayFrames - 12
        )
          this.head += 1;
        const peak = this.peakValues[this.head % this.ringSize];
        const wanted = peak > this.ceiling ? this.ceiling / peak : 1;
        const coefficient =
          wanted < this.limiterGain ? this.attack : this.release;
        this.limiterGain = wanted + coefficient * (this.limiterGain - wanted);
        if (transparent) this.limiterGain = 1;
        const read =
          (this.frame - this.delayFrames + this.ringSize) % this.ringSize;
        for (let channel = 0; channel < outputChannels.length; channel += 1) {
          const delayed =
            this.frame >= this.delayFrames
              ? this.delay[Math.min(channel, 1)][read]
              : 0;
          // A hard sample bound is a last-resort numerical safeguard, not the
          // normal limiter or a claim of true-peak compliance.
          outputChannels[channel][index] =
            this.volume === 0
              ? 0
              : transparent
              ? delayed
              : clamp(delayed * this.limiterGain, -this.ceiling, this.ceiling);
          if (channel < 2) {
            const value = outputChannels[channel][index];
            const weighted = this.outputFilters[channel].process(value);
            this.segmentOutput += weighted * weighted;
            const outputSlot = this.outputHistoryFrame % 12;
            this.outputHistory[channel][outputSlot] = value;
            this.outputPeak = Math.max(this.outputPeak, Math.abs(value));
            for (let phase = 0; phase < 4; phase += 1) {
              let interpolated = 0;
              for (let tap = 0; tap < 12; tap += 1) {
                interpolated +=
                  this.outputHistory[channel][(outputSlot - tap + 12) % 12] *
                  FIR[phase][tap];
              }
              this.outputPeak = Math.max(
                this.outputPeak,
                Math.abs(interpolated)
              );
            }
          }
        }
        this.outputHistoryFrame += 1;
        this.segmentFrames += 1;
        if (this.segmentFrames >= Math.round(this.rate * 0.1)) {
          this.updateMeasurement(this.segmentReference, this.segmentEffect);
          this.outputSegments.push(this.segmentOutput / this.segmentFrames);
          if (this.outputSegments.length > 4) this.outputSegments.shift();
          const outputEnergy =
            this.outputSegments.reduce((sum, value) => sum + value, 0) /
            this.outputSegments.length;
          this.outputLufs = outputEnergy > 0 ? toLufs(outputEnergy) : null;
          this.segmentReference = 0;
          this.segmentEffect = 0;
          this.segmentOutput = 0;
          this.segmentFrames = 0;
        }
        this.frame += 1;
      }
    }

    state() {
      return {
        enabled: this.enabled,
        status: !this.enabled
          ? 'bypass'
          : this.knownLufs !== null || this.activeFrames >= this.rate * 3
          ? 'calibrated'
          : 'estimating',
        source: this.knownLufs !== null ? 'measured' : 'live',
        gainDb: this.gainDb,
        fxMakeupDb: this.fxMakeupDb,
        inputLufs: this.inputLufs,
        // Actual final node metering includes the user's media element scalar.
        // These runtime indicators do not replace independent output QA.
        outputLufs: this.outputLufs,
        outputTruePeakDbtp:
          this.outputPeak > 0 ? 20 * Math.log10(this.outputPeak) : null,
        limiterReductionDb: -20 * Math.log10(Math.max(this.limiterGain, 1e-9)),
        limiterActive: !(this.transparentFrames > this.delayFrames + 12),
        targetLufs: TARGET_LUFS,
        latencySeconds: this.delayFrames / this.rate,
        limiterCeilingDbtp: LIMIT_DBTP,
      };
    }
  }

  return {
    ComfortProcessor,
    KFilter,
    FIR,
    kCoefficients,
    TARGET_LUFS,
    MIN_GAIN_DB,
    MAX_GAIN_DB,
    LIMIT_DBTP,
    LOOKAHEAD_SECONDS,
  };
});
