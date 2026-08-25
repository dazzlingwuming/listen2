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
  let nextTimerId = 1;
  let audioContext = null;

  class MockSource {
    constructor() {
      this.connections = [];
    }

    connect(target) {
      if (target && target.failConnect) {
        throw target.failConnect;
      }
      this.connections.push(target);
    }

    disconnect() {}
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
      if (options.disableGain) {
        this.createGain = undefined;
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
    crossOrigin: 'anonymous',
    currentSrc: 'https://cdn.example/audio.m4s?token=secret',
    pause() {},
    play() {},
  };
  const howl = {
    _sounds: [{ _node: node, _paused: false }],
    _webAudio: false,
  };

  return {
    context: () => audioContext,
    contexts: () => audioContexts.slice(),
    debug() {
      return window.Listen1AudioAnalysis.debug();
    },
    ensureOutput() {
      return window.Listen1AudioAnalysis.ensureOutput(howl);
    },
    setTrackGain(value) {
      howl._listen1TrackGain = value;
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
    const harness = createHarness();
    assert.strictEqual(harness.ensureOutput(), true);
    await flushPromises();
    assert.strictEqual(harness.context().state, 'running');
    assert.strictEqual(harness.debug().output.status, 'running');
    assert.strictEqual(harness.debug().output.attempts, 0);
    assert.strictEqual(harness.debug().source, 'https://cdn.example/audio.m4s');
    assert.strictEqual(harness.context().sources.length, 1);
    assert.strictEqual(harness.context().gains.length, 1);
    assert.strictEqual(
      harness.context().sources[0].connections[0],
      harness.context().gains[0],
      'the media source must feed the per-track gain node'
    );
    assert.strictEqual(
      harness
        .context()
        .gains[0].connections.filter(
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
        .gains[0].connections.filter(
          (target) => target !== harness.context().destination
        ).length,
      1,
      'repeated output preparation must not duplicate the analyser branch'
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
