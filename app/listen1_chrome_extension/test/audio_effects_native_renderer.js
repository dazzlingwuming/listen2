(async () => {
  const fs = require('fs');
  const load = (p) =>
    new Function('module', 'exports', fs.readFileSync(p, 'utf8'))(
      undefined,
      undefined
    );
  window.angular = { module: () => ({ directive() {} }) };
  load(EXT + '/js/comfort_loudness_core.js');
  load(EXT + '/js/audio_visualizer.js');
  const meter = require(APP + '/loudnessAnalyzerRenderer.js'),
    rate = 48000;
  const assert = (v, m) => {
    if (!v) throw new Error(m);
  };
  const frequencies = [40, 180, 500, 1000, 2600, 3200, 7500, 12000];
  function material(kind, seconds = 12) {
    const channels = Array.from(
      { length: kind === 'mono' ? 1 : 2 },
      () => new Float32Array(seconds * rate)
    );
    for (let i = 0; i < channels[0].length; i++) {
      const t = i / rate;
      for (let ch = 0; ch < channels.length; ch++) {
        if (kind === 'stress') {
          const p = t % 0.37;
          channels[ch][i] =
            0.055 * Math.sin(2 * Math.PI * 997 * t) +
            0.025 * Math.sin(2 * Math.PI * 63 * t) +
            0.85 *
              Math.exp(-p / 0.002) *
              Math.sin(2 * Math.PI * 11000 * t + ch * 0.4);
        } else if (kind === 'dynamic') {
          const position = t % 2,
            amp = position < 1.7 ? 0.025 : 0.24;
          channels[ch][i] =
            amp *
            (0.7 * Math.sin(2 * Math.PI * 997 * t) +
              0.3 * Math.sin(2 * Math.PI * 1511 * t + ch * 0.4));
        } else {
          let sum = 0;
          for (let f = 0; f < frequencies.length; f++)
            sum +=
              0.035 *
              Math.sin(2 * Math.PI * frequencies[f] * t + (ch ? f * 0.37 : 0));
          channels[ch][i] = sum;
        }
      }
    }
    return channels;
  }
  function rms(x, start = 0, end = x.length) {
    let s = 0;
    for (let i = start; i < end; i++) s += x[i] * x[i];
    return Math.sqrt(s / (end - start));
  }
  function spectral(x) {
    const out = {};
    const start = 6 * rate,
      end = x.length;
    for (const f of frequencies) {
      let a = 0,
        b = 0;
      for (let i = start; i < end; i++) {
        const phase = (2 * Math.PI * f * i) / rate;
        a += x[i] * Math.cos(phase);
        b += x[i] * Math.sin(phase);
      }
      out[f] = (2 * Math.hypot(a, b)) / (end - start);
    }
    return out;
  }
  function spatial(cs) {
    let mid = 0,
      side = 0,
      cross = 0,
      l = 0,
      r = 0;
    for (let i = 6 * rate; i < cs[0].length; i++) {
      const a = cs[0][i],
        b = cs[1][i];
      mid += (a + b) ** 2;
      side += (a - b) ** 2;
      cross += a * b;
      l += a * a;
      r += b * b;
    }
    return {
      widthDb: 10 * Math.log10(side / mid),
      correlation: cross / Math.sqrt(l * r),
      balanceDb: 10 * Math.log10(l / r),
    };
  }
  async function render(input, preset, options = {}) {
    const length = input[0].length,
      context = new OfflineAudioContext(2, length, rate),
      buffer = context.createBuffer(input.length, length, rate);
    input.forEach((x, ch) => buffer.copyToChannel(x, ch));
    const src = context.createBufferSource();
    src.buffer = buffer;
    const fx = Listen1AudioAnalysis.createOfflineEffectChain(
      context,
      src,
      preset
    );
    await context.audioWorklet.addModule(
      new URL('js/comfort_loudness_core.js', BASE).href
    );
    await context.audioWorklet.addModule(
      new URL('js/comfort_loudness_worklet.js', BASE).href
    );
    const worklet = new AudioWorkletNode(context, 'listen2-comfort', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    const known =
      meter.measureIntegratedLufs(input, rate) +
      (input.length === 1 ? 10 * Math.log10(2) : 0);
    worklet.port.postMessage({
      type: 'configure',
      options: {
        enabled: true,
        volume: 1,
        paused: false,
        effect: preset,
        knownLufs: known,
      },
    });
    fx.output.connect(worklet, 0, 0);
    const ref = context.createDelay(0.05);
    ref.delayTime.value = 0.006;
    src.connect(ref);
    ref.connect(worklet, 0, 1);
    worklet.connect(context.destination);
    let transition;
    if (options.transition)
      transition = context.suspend(6).then(() => {
        fx.setPreset(options.transition);
        worklet.port.postMessage({
          type: 'configure',
          options: {
            enabled: true,
            volume: 1,
            paused: false,
            effect: options.transition,
            knownLufs: known,
          },
        });
        return context.resume();
      });
    src.start();
    const output = await context.startRendering();
    if (transition) await transition;
    const channels = [output.getChannelData(0), output.getChannelData(1)];
    const steady = channels.map((c) => c.slice(6 * rate));
    const lufs = meter.measureIntegratedLufs(steady, rate),
      tp = meter.measureTruePeak(channels);
    let samplePeak = 0;
    for (const c of channels)
      for (const x of c) samplePeak = Math.max(samplePeak, Math.abs(x));
    const interleaved = new Float32Array(length * 2);
    for (let i = 0; i < length; i++) {
      interleaved[2 * i] = channels[0][i];
      interleaved[2 * i + 1] = channels[1][i];
    }
    fs.writeFileSync(
      OUT + '/' + options.name + '.f32',
      Buffer.from(interleaved.buffer)
    );
    const result = {
      preset,
      inputLufs: known,
      steadyLufs: lufs,
      truePeakDbtp: tp,
      samplePeakDbfs: 20 * Math.log10(samplePeak),
      spectral: spectral(channels[0]),
      spatial: spatial(channels),
      frames: length,
    };
    if (options.transition) {
      const bytes = fs.readFileSync(OUT + '/original.f32');
      const interleavedDry = new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.length / 4
      );
      const dry = Float32Array.from(
        { length },
        (_, i) => interleavedDry[2 * i]
      );
      const bias = (seconds) =>
        20 *
        Math.log10(
          rms(channels[0], 6 * rate, Math.round((6 + seconds) * rate)) /
            rms(dry, 6 * rate, Math.round((6 + seconds) * rate))
        );
      const trace = [];
      for (let offset = 0; offset < rate; offset += rate * 0.01) {
        const start = Math.round(6 * rate + offset),
          end = Math.round(start + rate * 0.01);
        trace.push(
          20 * Math.log10(rms(channels[0], start, end) / rms(dry, start, end))
        );
      }
      result.transition = {
        to: options.transition,
        first100msBiasDb: bias(0.1),
        first400msBiasDb: bias(0.4),
        firstSecondBiasDb: bias(1),
        over1DbSeconds: trace.filter((v) => Math.abs(v) > 1).length * 0.01,
        over2DbSeconds: trace.filter((v) => Math.abs(v) > 2).length * 0.01,
        minimum10msBiasDb: Math.min(...trace),
        maximum10msBiasDb: Math.max(...trace),
      };
      // Same input/window/native baseline at HEAD a5822128: 400ms +1.346dB,
      // 100ms +.259dB, >2dB duration120ms. Allow .25dB/25ms drift.
      assert(
        Math.abs(bias(0.4)) <= 1.346006133 + 0.25 &&
          Math.abs(bias(0.1)) <= 0.258570524 + 0.25 &&
          result.transition.over2DbSeconds <= 0.12 + 0.025,
        'night transition must stay within the comparable previous-preset baseline tolerance'
      );
    }
    if (options.dynamic) {
      const windows = [];
      for (let s = 6; s < 12; s += 2) {
        const quiet = rms(
          channels[0],
          Math.round((s + 1.4 + 0.018) * rate),
          Math.round((s + 1.6 + 0.018) * rate)
        );
        const loud = rms(
          channels[0],
          Math.round((s + 1.78 + 0.018) * rate),
          Math.round((s + 1.88 + 0.018) * rate)
        );
        windows.push(20 * Math.log10(loud / quiet));
      }
      result.dynamicRangeDb =
        windows.reduce((a, b) => a + b, 0) / windows.length;
    }
    assert(
      result.truePeakDbtp <= -1 + 0.02,
      'true-peak ceiling ' + options.name + ' ' + result.truePeakDbtp
    );
    assert(
      result.samplePeakDbfs <= -1 + 0.02,
      'sample ceiling ' + options.name
    );
    return result;
  }
  async function fallbackHeadroom(input, preset) {
    const length = input[0].length,
      context = new OfflineAudioContext(4, length, rate);
    const buffer = context.createBuffer(input.length, length, rate);
    let inputPeak = 0;
    for (const channel of input)
      for (const value of channel)
        inputPeak = Math.max(inputPeak, Math.abs(value));
    input.forEach((channel, index) =>
      buffer.copyToChannel(
        Float32Array.from(channel, (value) => (value * 0.98) / inputPeak),
        index
      )
    );
    const source = context.createBufferSource();
    source.buffer = buffer;
    let shaper, beforeShaper;
    const createShaper = context.createWaveShaper.bind(context),
      connect = AudioNode.prototype.connect;
    context.createWaveShaper = () => {
      shaper = createShaper();
      return shaper;
    };
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination === shaper && shaper) beforeShaper = this;
      return connect.call(this, destination, ...args);
    };
    let fx;
    try {
      fx = Listen1AudioAnalysis.createOfflineEffectChain(
        context,
        source,
        preset,
        { fallback: true }
      );
    } finally {
      AudioNode.prototype.connect = connect;
    }
    assert(beforeShaper, 'Fallback must include its safety shaper');
    const merge = context.createChannelMerger(4),
      post = context.createChannelSplitter(2),
      pre = context.createChannelSplitter(2);
    fx.output.connect(post);
    beforeShaper.connect(pre);
    post.connect(merge, 0, 0);
    post.connect(merge, 1, 1);
    pre.connect(merge, 0, 2);
    pre.connect(merge, 1, 3);
    merge.connect(context.destination);
    source.start();
    const output = await context.startRendering();
    let prePeak = 0,
      postPeak = 0;
    for (let channel = 0; channel < 4; channel++)
      for (const value of output.getChannelData(channel)) {
        if (channel < 2) postPeak = Math.max(postPeak, Math.abs(value));
        else prePeak = Math.max(prePeak, Math.abs(value));
      }
    assert(
      prePeak <= 1,
      'Fallback must not hard-clamp at WaveShaper input: ' +
        preset +
        ' ' +
        prePeak
    );
    assert(postPeak < 1, 'Fallback output must stay sample-bounded');
    return {
      preset,
      fullScaleInputPeak: 0.98,
      preShaperPeakDbfs: 20 * Math.log10(prePeak),
      postShaperPeakDbfs: 20 * Math.log10(postPeak),
    };
  }
  const input = material('stereo'),
    presets = NIGHT_ONLY
      ? ['original', 'night']
      : [
          'original',
          'deep-bass',
          'clear-vocals',
          'airy',
          'warm',
          'hifi-live',
          'immersive-3d',
          'night',
        ],
    results = [];
  for (const preset of presets) {
    const r = await render(input, preset, { name: preset });
    results.push(r);
    console.log('DONE', preset, r.steadyLufs, r.truePeakDbtp);
  }
  const original = results[0];
  for (const r of results) {
    r.relativeResponseDb = {};
    for (const f of frequencies)
      r.relativeResponseDb[f] =
        20 *
        Math.log10(
          r.spectral[f] /
            r.spectral[1000] /
            (original.spectral[f] / original.spectral[1000])
        );
    assert(
      Math.abs(r.steadyLufs - original.steadyLufs) <= 0.7,
      'steady loudness mismatch ' + r.preset
    );
  }
  const get = (p) => results.find((r) => r.preset === p),
    delta = (p, f) => get(p).relativeResponseDb[f];
  let mono = null;
  if (!NIGHT_ONLY) {
    assert(
      delta('deep-bass', 40) > 5 && delta('deep-bass', 180) > 2,
      'bass must alter bass relative to mids'
    );
    assert(
      delta('clear-vocals', 40) < -10 && delta('clear-vocals', 2600) > 2.5,
      'vocal presence/rumble behavior'
    );
    assert(delta('airy', 12000) > 3, 'airy must brighten highs');
    assert(
      delta('warm', 40) > 2.5 && delta('warm', 12000) < -1,
      'warm must separate bass and treble'
    );
    assert(
      delta('hifi-live', 40) > 1.5 &&
        delta('hifi-live', 3200) > 1.5 &&
        delta('hifi-live', 12000) > 1.5,
      'HiFi small V behavior'
    );
    assert(
      get('immersive-3d').spatial.widthDb - original.spatial.widthDb > 0.5,
      '3D must alter stereo width'
    );
    mono = await render(material('mono'), 'immersive-3d', {
      name: 'mono-3d',
    });
    assert(
      Math.abs(mono.spatial.balanceDb) < 0.01 &&
        mono.spatial.correlation > 0.9999,
      '3D mono must stay centered'
    );
  }
  assert(
    delta('night', 12000) < -2,
    'night must darken treble independently of level'
  );
  const dynamics = material('dynamic'),
    dry = await render(dynamics, 'original', {
      name: 'dynamic-original',
      dynamic: true,
    }),
    night = await render(dynamics, 'night', {
      name: 'dynamic-night',
      dynamic: true,
    });
  assert(
    dry.dynamicRangeDb - night.dynamicRangeDb > 0.8473524 - 0.15,
    'night must preserve the previous changing-level compression behavior'
  );
  const stress = NIGHT_ONLY
    ? null
    : await render(material('stress'), 'deep-bass', {
        name: 'stress-bass',
      });
  assert(
    NIGHT_ONLY || stress.truePeakDbtp > -3,
    'stress must actually exercise peak protection'
  );
  const transitionNight = await render(input, 'original', {
    name: 'transition-night',
    transition: 'night',
  });
  const fallback = [];
  for (const preset of presets.slice(1))
    fallback.push(await fallbackHeadroom(input, preset));
  fallback.push(await fallbackHeadroom(dynamics, 'night'));
  return {
    rate,
    fallback,
    transitionNight,
    results,
    mono,
    stress,
    dynamic: {
      original: dry,
      night,
      reductionDb: dry.dynamicRangeDb - night.dynamicRangeDb,
    },
    measurementNote:
      'Product offline analyzer; previously calibrated against libebur128, no new independent libebur128 run. TP shares standard FIR family with limiter.',
  };
})();
