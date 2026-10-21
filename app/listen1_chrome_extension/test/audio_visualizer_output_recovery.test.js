/* eslint-env node */
/* eslint-disable class-methods-use-this, max-classes-per-file, no-console, no-underscore-dangle */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness(options = {}) {
  const filename = path.join(__dirname, '..', 'js', 'audio_visualizer.js');
  const source = fs.readFileSync(filename, 'utf8');
  const timers = new Map();
  const audioContexts = [];
  const worklets = [];
  const moduleUrls = [];
  let nextTimerId = 1;
  let audioContext = null;

  class MockSource {
    constructor() {
      this.connections = [];
      this.connectionRecords = [];
    }

    connect(target, output, input) {
      if (target && target.failConnect) {
        throw target.failConnect;
      }
      this.connections.push(target);
      this.connectionRecords.push({ target, output, input });
    }

    disconnect(target) {
      this.connections = target
        ? this.connections.filter((node) => node !== target)
        : [];
      this.connectionRecords = target
        ? this.connectionRecords.filter(
            (connection) => connection.target !== target
          )
        : [];
    }
  }

  class MockAnalyser extends MockSource {
    constructor() {
      super();
      this.frequencyBinCount = 1024;
      this.fftSize = 0;
    }

    getByteFrequencyData() {}

    getByteTimeDomainData() {}
  }

  class MockGain extends MockSource {
    constructor() {
      super();
      this.gain = {
        value: 1,
        calls: [],
        cancelScheduledValues(time) {
          this.calls.push(['cancel', time]);
        },
        setValueAtTime(value, time) {
          this.value = value;
          this.calls.push(['set', value, time]);
        },
        linearRampToValueAtTime(value, time) {
          this.value = value;
          this.calls.push(['ramp', value, time]);
        },
      };
    }
  }

  class MockEffectNode extends MockSource {
    constructor() {
      super();
      const parameter = () => ({
        value: 0,
        calls: [],
        cancelScheduledValues() {},
        setValueAtTime(value) {
          this.value = value;
          this.calls.push(value);
        },
        linearRampToValueAtTime(value) {
          this.value = value;
          this.calls.push(value);
        },
      });
      this.delayTime = parameter();
      this.frequency = parameter();
      this.gain = parameter();
      this.Q = parameter();
      this.threshold = parameter();
      this.knee = parameter();
      this.ratio = parameter();
      this.attack = parameter();
      this.release = parameter();
    }
  }

  class MockAudioContext {
    constructor() {
      this.state = options.initialState || 'suspended';
      this.destination = {
        failConnect: options.destinationConnectError || null,
      };
      this.sampleRate = 48000;
      this.resumeCalls = 0;
      this.listeners = new Map();
      this.sources = [];
      this.gains = [];
      this.delays = [];
      this.shapers = [];
      this.splitters = [];
      this.mergers = [];
      if (options.worklet) {
        this.audioWorklet = {
          addModule(url) {
            moduleUrls.push(url);
            return options.workletLoadError
              ? Promise.reject(new Error('blocked'))
              : Promise.resolve();
          },
        };
      }
      if (options.disableGain) {
        this.createGain = undefined;
      }
      if (!options.spatialNodes) {
        this.createWaveShaper = undefined;
      }
      audioContext = this;
      audioContexts.push(this);
    }

    addEventListener(event, callback) {
      this.listeners.set(event, callback);
    }

    removeEventListener(event, callback) {
      if (this.listeners.get(event) === callback) {
        this.listeners.delete(event);
      }
    }

    createAnalyser() {
      return new MockAnalyser();
    }

    createMediaElementSource() {
      const mediaSource = new MockSource();
      this.sources.push(mediaSource);
      return mediaSource;
    }

    createGain() {
      const gain = new MockGain();
      this.gains.push(gain);
      return gain;
    }

    createBiquadFilter() {
      return new MockEffectNode();
    }

    createWaveShaper() {
      const shaper = new MockEffectNode();
      this.shapers.push(shaper);
      return shaper;
    }

    createDynamicsCompressor() {
      return new MockEffectNode();
    }

    createChannelSplitter() {
      if (!options.spatialNodes) throw new Error('spatial nodes disabled');
      const splitter = new MockEffectNode();
      this.splitters.push(splitter);
      return splitter;
    }

    createChannelMerger() {
      if (!options.spatialNodes) throw new Error('spatial nodes disabled');
      const merger = new MockEffectNode();
      this.mergers.push(merger);
      return merger;
    }

    createDelay() {
      if (!options.spatialNodes) throw new Error('spatial nodes disabled');
      const delay = new MockEffectNode();
      this.delays.push(delay);
      return delay;
    }

    resume() {
      this.resumeCalls += 1;
      if (options.resume) {
        return options.resume(this);
      }
      this.setState('running');
      return Promise.resolve();
    }

    setState(nextState) {
      this.state = nextState;
      const listener = this.listeners.get('statechange');
      if (listener) {
        listener();
      }
    }
  }

  const angularModule = {
    directive() {
      return angularModule;
    },
  };
  const window = {
    AudioContext: MockAudioContext,
    document: { baseURI: 'file:///synthetic/listen1.html' },
    angular: undefined,
    clearTimeout(id) {
      timers.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
  };
  if (options.worklet) {
    window.AudioWorkletNode = class extends MockSource {
      constructor() {
        super();
        this.messages = [];
        this.port = { postMessage: (message) => this.messages.push(message) };
        worklets.push(this);
      }
    };
  }
  const context = {
    Float32Array,
    Promise,
    URL,
    Uint8Array,
    angular: {
      module() {
        return angularModule;
      },
    },
    console,
    process: {
      versions: options.electron === false ? {} : { electron: 'test' },
    },
    window,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });

  const node = {
    volume: options.volume || 1,
    muted: false,
    crossOrigin: 'anonymous',
    currentSrc: 'https://cdn.example/audio.m4s?token=secret',
    pause() {},
    play() {},
  };
  const howl = {
    _sounds: [{ _node: node, _paused: false }],
    _webAudio: false,
    playing: () => true,
  };

  return {
    howl,
    node,
    worklets,
    moduleUrls,
    context: () => audioContext,
    contexts: () => audioContexts.slice(),
    debug() {
      return window.Listen1AudioAnalysis.debug();
    },
    ensureOutput(nextHowl = howl) {
      return window.Listen1AudioAnalysis.ensureOutput(nextHowl);
    },
    getEffectState() {
      return window.Listen1AudioAnalysis.getEffectState();
    },
    setTrackGain(value) {
      howl._listen1TrackGain = value;
    },
    setEffectPreset(preset) {
      return window.Listen1AudioAnalysis.setEffectPreset(preset);
    },
    runTimer(delay) {
      const entry = [...timers.entries()].find(
        ([, timer]) => timer.delay === delay
      );
      if (!entry) return false;
      timers.delete(entry[0]);
      entry[1].callback();
      return true;
    },
    runNextTimer() {
      const entry = timers.entries().next().value;
      if (!entry) {
        return false;
      }
      const [id, timer] = entry;
      timers.delete(id);
      timer.callback();
      return true;
    },
    timerCount() {
      return timers.size;
    },
  };
}

async function run() {
  {
    const harness = createHarness({ worklet: true, spatialNodes: true });
    harness.howl._listen1ComfortEnabled = true;
    const secondHowl = {
      _sounds: [{ _node: { ...harness.node }, _paused: false }],
      _webAudio: false,
      _listen1ComfortEnabled: true,
      playing: () => true,
    };
    harness.ensureOutput();
    await flushPromises();
    const firstProcessor = harness.worklets[0];
    firstProcessor.port.onmessage({ data: { type: 'ready', state: {} } });
    harness.runTimer(25);
    harness.ensureOutput(secondHowl);
    assert.strictEqual(
      firstProcessor.messages[firstProcessor.messages.length - 1].type,
      'dispose'
    );
    assert.strictEqual(
      firstProcessor.connections.length,
      0,
      'park must disconnect the old processor from every output'
    );
    assert.strictEqual(firstProcessor.port.onmessage, null);
    await flushPromises();
    const secondProcessor = harness.worklets[1];
    secondProcessor.port.onmessage({ data: { type: 'ready', state: {} } });
    harness.runTimer(25);
    harness.ensureOutput(harness.howl);
    await flushPromises();
    assert.strictEqual(
      harness.context().sources.length,
      2,
      'returning to an element must reuse its unique MediaElementSource'
    );
    assert.strictEqual(
      harness.worklets.length,
      3,
      'resuming parked media must create only its replacement processor'
    );
    assert.strictEqual(
      secondProcessor.messages[secondProcessor.messages.length - 1].type,
      'dispose'
    );
    const resumed = harness.worklets[2];
    resumed.port.onmessage({ data: { type: 'ready', state: {} } });
    harness.runTimer(25);
    for (let index = 0; index < 5; index += 1) harness.ensureOutput();
    assert.strictEqual(harness.worklets.length, 3);
    assert.strictEqual(
      harness.context().sources[0].connections.length,
      2,
      'only the gain path and current reference tap may remain connected'
    );
  }

  {
    const harness = createHarness({ worklet: true, spatialNodes: true });
    const other = {
      ...harness.howl,
      _sounds: [{ _node: { ...harness.node }, _paused: false }],
    };
    harness.ensureOutput();
    harness.ensureOutput(other);
    await flushPromises();
    assert.strictEqual(
      harness.worklets.length,
      1,
      'a parked record must not attach a late module-load callback'
    );
    assert.strictEqual(harness.context().sources.length, 2);
  }

  {
    const harness = createHarness({ worklet: true, spatialNodes: true });
    const other = {
      ...harness.howl,
      _sounds: [{ _node: { ...harness.node }, _paused: false }],
    };
    harness.ensureOutput();
    await flushPromises();
    const oldReady = harness.worklets[0].port.onmessage;
    oldReady({ data: { type: 'ready', state: {} } });
    harness.ensureOutput(other);
    assert.strictEqual(
      harness.runTimer(25),
      false,
      'park must cancel a pending warmup'
    );
    oldReady({ data: { type: 'ready', state: {} } });
    assert.strictEqual(
      harness.runTimer(25),
      false,
      'a stale ready callback must not revive parked audio'
    );
  }

  {
    const harness = createHarness({
      worklet: true,
      spatialNodes: true,
      volume: 0.25,
    });
    harness.howl._listen1ComfortEnabled = true;
    harness.setTrackGain(2);
    harness.ensureOutput();
    await flushPromises();
    assert.strictEqual(harness.moduleUrls.length, 2);
    assert.ok(harness.moduleUrls[0].endsWith('comfort_loudness_core.js'));
    assert.ok(harness.moduleUrls[1].endsWith('comfort_loudness_worklet.js'));
    const processor = harness.worklets[0];
    assert.strictEqual(processor.messages[0].options.volume, 0.25);
    assert.strictEqual(processor.messages[0].options.enabled, true);
    processor.port.onmessage({
      data: { type: 'ready', state: { status: 'estimating' } },
    });
    assert.strictEqual(harness.runTimer(25), true);
    assert.strictEqual(harness.debug().loudness.active, true);
    assert.strictEqual(
      harness.context().gains[0].gain.value,
      1,
      'worklet must replace legacy gain rather than multiply it twice'
    );
    harness.setEffectPreset('deep-bass');
    assert.strictEqual(
      harness.context().shapers.length,
      0,
      'ready worklet must replace the former saturating FX shaper'
    );
    const latest = processor.messages[processor.messages.length - 1];
    assert.strictEqual(latest.options.effect, 'deep-bass');
    harness.howl._listen1LoudnessResetToken = 1;
    harness.ensureOutput();
    assert.strictEqual(
      processor.messages[processor.messages.length - 1].options.reset,
      true
    );
    harness.howl._listen1ComfortEnabled = false;
    harness.node.muted = true;
    harness.ensureOutput();
    assert.strictEqual(
      processor.messages[processor.messages.length - 1].options.volume,
      0
    );
    assert.strictEqual(harness.debug().loudness.active, false);
    processor.onprocessorerror();
    assert.strictEqual(
      processor.messages[processor.messages.length - 1].type,
      'dispose'
    );
    assert.strictEqual(processor.connections.length, 0);
    assert.strictEqual(
      harness
        .context()
        .gains.filter((gain) =>
          gain.connections.includes(harness.context().destination)
        ).length,
      1,
      'fallback must leave only one destination path'
    );
    assert.strictEqual(harness.debug().loudness.status, 'fallback');
    assert.strictEqual(harness.debug().loudness.degraded, true);
    assert.strictEqual(
      harness.context().gains[0].gain.value,
      2,
      'processor failure must restore verified legacy fallback gain'
    );
  }

  {
    const harness = createHarness({ worklet: true, workletLoadError: true });
    harness.howl._listen1ComfortEnabled = true;
    harness.ensureOutput();
    await flushPromises();
    assert.strictEqual(harness.debug().loudness.status, 'fallback');
    assert.strictEqual(
      harness.debug().loudness.error,
      'audio-worklet-load-failed'
    );
    assert.strictEqual(
      harness.debug().output.status,
      'running',
      'optional worklet failure must preserve audible output'
    );
  }

  {
    const harness = createHarness({ spatialNodes: true });
    assert.strictEqual(harness.ensureOutput(), true);
    assert.strictEqual(
      harness.context().shapers.length,
      0,
      'original must remain a true pass-through without a limiter'
    );
    const state = harness.setEffectPreset('immersive-3d');
    assert.strictEqual(state.ok, true);
    assert.strictEqual(state.preset, 'immersive-3d');
    assert.strictEqual(harness.context().delays.length, 2);
    assert.strictEqual(
      harness.context().delays[0].delayTime.value,
      harness.context().delays[1].delayTime.value,
      '3D crossfeed delays must remain symmetric'
    );
    assert.strictEqual(
      harness.context().delays[0].delayTime.calls.length,
      1,
      'a newly connected delay must start at its target without ramping from zero'
    );
    const stereoUpmix = harness
      .context()
      .gains.find((gain) => gain.channelCountMode === 'explicit');
    assert.ok(stereoUpmix, '3D must force a safe mono-to-stereo up-mix');
    assert.strictEqual(stereoUpmix.channelCount, 2);
    assert.strictEqual(stereoUpmix.channelInterpretation, 'speakers');
    const crossfeedGains = harness
      .context()
      .gains.filter((gain) => gain.gain.value < 0);
    assert.strictEqual(crossfeedGains.length, 2);
    crossfeedGains.forEach((gain) => {
      assert.ok(
        gain.gain.value >= -0.2 && gain.gain.value <= -0.1,
        'crossfeed must remain subordinate to the direct signal'
      );
      assert.deepStrictEqual(
        gain.gain.calls,
        [
          ['cancel', 0],
          ['set', gain.gain.value, 0],
        ],
        'new crossfeed gains must never ramp from the +1 default'
      );
    });
    const splitter = harness.context().splitters[0];
    const merger = harness.context().mergers[0];
    const routeFromSplitter = (output) =>
      splitter.connectionRecords.filter((record) => record.output === output);
    [0, 1].forEach((output) => {
      const routes = routeFromSplitter(output);
      assert.strictEqual(
        routes.length,
        2,
        'each input channel needs direct and cross routes'
      );
      const direct = routes.find(
        (route) => route.target.gain && !route.target.delayTime
      );
      const delayed = routes.find((route) => route.target.delayTime);
      assert.ok(direct && delayed);
      assert.deepStrictEqual(direct.target.connectionRecords[0], {
        target: merger,
        output: 0,
        input: output,
      });
      const filter = delayed.target.connectionRecords[0].target;
      const crossfeed = filter.connectionRecords[0].target;
      assert.deepStrictEqual(crossfeed.connectionRecords[0], {
        target: merger,
        output: 0,
        input: output === 0 ? 1 : 0,
      });
    });
    assert.strictEqual(harness.context().shapers.length, 1);
    assert.ok(
      Math.abs(harness.context().shapers[0].curve[1536] - 0.5) < 1e-6,
      'the safety limiter must preserve ordinary signal levels'
    );
    assert.ok(
      harness.context().shapers[0].curve[2048] <= 0.981,
      'the safety limiter must reduce full-scale peaks instead of boosting them'
    );
    [0.91, 0.95].forEach((input) => {
      const index = Math.round(((input + 1) / 2) * 2048);
      const sampledInput = (index / 2048) * 2 - 1;
      assert.ok(
        harness.context().shapers[0].curve[index] <= sampledInput,
        'the soft knee must never expand near-peak samples'
      );
      assert.ok(
        Math.abs(
          harness.context().shapers[0].curve[2048 - index] +
            harness.context().shapers[0].curve[index]
        ) < 1e-6,
        'the limiter curve must remain odd-symmetric'
      );
    });
  }

  {
    const harness = createHarness();
    assert.strictEqual(harness.ensureOutput(), true);
    await flushPromises();
    assert.strictEqual(harness.context().state, 'running');
    assert.strictEqual(harness.debug().output.status, 'running');
    assert.strictEqual(harness.debug().output.attempts, 0);
    assert.strictEqual(harness.debug().source, 'https://cdn.example/audio.m4s');
    assert.strictEqual(harness.context().sources.length, 1);
    assert.strictEqual(harness.context().gains.length, 2);
    assert.strictEqual(
      harness.context().sources[0].connections[0],
      harness.context().gains[0],
      'the media source must feed the per-track gain node'
    );
    assert.strictEqual(
      harness.context().gains[0].connections[0],
      harness.context().gains[1],
      'the loudness gain must feed the effect-chain input'
    );
    assert.strictEqual(
      harness
        .context()
        .gains[1].connections.filter(
          (target) => target === harness.context().destination
        ).length,
      1,
      'the audible output must be connected once'
    );
    harness.setTrackGain(10 ** (6 / 20));
    harness.ensureOutput();
    assert.ok(
      harness
        .context()
        .gains[0].gain.calls.some((call) => call[0] === 'ramp' && call[1] > 1),
      'positive per-track gain must use a short AudioParam ramp'
    );
    harness.setTrackGain(10 ** (-6 / 20));
    harness.ensureOutput();
    assert.ok(
      harness
        .context()
        .gains[0].gain.calls.some((call) => call[0] === 'ramp' && call[1] < 1),
      'negative per-track gain must use the same output node'
    );
    assert.strictEqual(
      harness
        .context()
        .gains[1].connections.filter(
          (target) => target !== harness.context().destination
        ).length,
      1,
      'repeated output preparation must not duplicate the analyser branch'
    );
    const degraded3d = harness.setEffectPreset('immersive-3d');
    assert.strictEqual(degraded3d.degraded, true);
    assert.strictEqual(degraded3d.preset, 'original');
    assert.strictEqual(
      harness.getEffectState().error,
      'effect-unavailable',
      'missing symmetric spatial nodes must explicitly fall back to original'
    );
  }

  {
    const harness = createHarness();
    harness.ensureOutput();
    await flushPromises();
    const context = harness.context();
    context.setState('interrupted');
    await flushPromises();
    assert.strictEqual(context.state, 'running');
    assert.ok(context.resumeCalls >= 2);
    assert.strictEqual(harness.debug().output.status, 'running');
  }

  {
    const harness = createHarness({
      resume() {
        return Promise.reject(new Error('temporary output failure'));
      },
    });
    harness.ensureOutput();
    for (let index = 0; index < 8; index += 1) {
      // Let a rejected resume queue its bounded retry, then execute it.
      // More iterations than necessary prove no fourth retry is introduced.
      // eslint-disable-next-line no-await-in-loop
      await flushPromises();
      harness.runNextTimer();
    }
    await flushPromises();
    assert.strictEqual(harness.context().resumeCalls, 3);
    assert.strictEqual(harness.timerCount(), 0);
    assert.strictEqual(
      harness.debug().output.failure.stage,
      'resume-exhausted'
    );
    assert.strictEqual(harness.debug().output.hint, 'recreate-media-element');
  }

  {
    const harness = createHarness({ initialState: 'running' });
    harness.ensureOutput();
    const firstContext = harness.context();
    firstContext.setState('closed');
    assert.strictEqual(firstContext.resumeCalls, 0);
    assert.strictEqual(harness.debug().output.failure.stage, 'context-closed');
    assert.strictEqual(harness.debug().output.hint, 'recreate-media-element');
    assert.strictEqual(harness.ensureOutput(), false);
    assert.strictEqual(harness.contexts().length, 2);
    assert.strictEqual(firstContext.listeners.has('statechange'), false);
  }

  {
    const harness = createHarness({
      destinationConnectError: new Error(
        'https://signed.example/audio?secret=1'
      ),
    });
    assert.strictEqual(harness.ensureOutput(), false);
    assert.strictEqual(
      harness.debug().output.failure.stage,
      'connect-destination'
    );
    assert.strictEqual(
      harness.debug().output.failure.message.includes('signed.example'),
      false
    );
    assert.strictEqual(harness.debug().output.hint, 'recreate-media-element');
  }

  {
    const harness = createHarness({ disableGain: true });
    assert.strictEqual(harness.ensureOutput(), false);
    assert.strictEqual(
      harness.debug().output.hint,
      'recreate-media-element',
      'a missing GainNode implementation must use the existing rebuild path'
    );
    assert.strictEqual(
      harness.context().sources.length,
      0,
      'the native media route must remain untouched when GainNode is unavailable'
    );
  }

  {
    const harness = createHarness({ electron: false });
    assert.strictEqual(harness.ensureOutput(), false);
    assert.strictEqual(harness.debug().output.status, 'native');
    assert.strictEqual(harness.debug().output.failure, null);
  }

  console.log('audio_visualizer_output_recovery.test.js: passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
