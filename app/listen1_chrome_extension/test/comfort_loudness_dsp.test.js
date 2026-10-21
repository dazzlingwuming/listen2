/* eslint-env node */
/* eslint-disable no-console */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  ComfortProcessor,
  KFilter,
  kCoefficients,
} = require('../js/comfort_loudness_core');

const rate = 48000;
function render({
  amplitude = 0.07,
  volume = 1,
  enabled = true,
  effect = 'original',
  fxScale = 1,
  knownLufs = null,
  seconds = 16,
}) {
  const engine = new ComfortProcessor(rate);
  engine.configure({ enabled, volume, effect, knownLufs, reset: true });
  const length = seconds * rate;
  const output = [new Float32Array(length), new Float32Array(length)];
  for (let offset = 0; offset < length; offset += 128) {
    const count = Math.min(128, length - offset);
    const reference = new Float32Array(count);
    const processed = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      reference[index] =
        amplitude *
        volume *
        Math.sin((2 * Math.PI * 997 * (offset + index)) / rate);
      processed[index] = reference[index] * fxScale;
    }
    engine.process(
      [processed, processed],
      [reference, reference],
      output.map((channel) => channel.subarray(offset, offset + count))
    );
  }
  return { engine, output };
}

function rms(samples, start = 12 * rate) {
  let sum = 0;
  for (let index = start; index < samples.length; index += 1)
    sum += samples[index] ** 2;
  return Math.sqrt(sum / (samples.length - start));
}

const coefficients = kCoefficients(rate);
assert.ok(Math.abs(coefficients[0][0] - 1.53512485958697) < 1e-12);
assert.ok(Math.abs(coefficients[1][3] - -1.99004745483398) < 1e-12);
// Published mono 997 Hz 0.1-amplitude reference: approximately -23.01 LUFS.
const filter = new KFilter(rate);
let referenceEnergy = 0;
for (let frame = 0; frame < 3 * rate; frame += 1) {
  const weighted = filter.process(
    0.1 * Math.sin((2 * Math.PI * 997 * frame) / rate)
  );
  if (frame >= rate) referenceEnergy += weighted * weighted;
}
assert.ok(
  Math.abs(-0.691 + 10 * Math.log10(referenceEnergy / (2 * rate)) - -23.01) <
    0.05
);

const quiet = render({});
const loud = render({ amplitude: 0.5 });
assert.ok(quiet.engine.state().gainDb > 6);
assert.ok(quiet.engine.state().gainDb <= 9);
assert.ok(
  Math.abs(20 * Math.log10(rms(quiet.output[0]) / rms(loud.output[0]))) < 1
);
const volumeQuarter = render({ volume: 0.25 });
assert.ok(
  Math.abs(quiet.engine.state().gainDb - volumeQuarter.engine.state().gainDb) <
    0.01
);
assert.ok(
  Math.abs(rms(volumeQuarter.output[0]) / rms(quiet.output[0]) - 0.25) < 0.001
);

const silent = render({ amplitude: 0 });
assert.equal(silent.engine.state().gainDb, 0);
assert.equal(silent.engine.state().status, 'estimating');
assert.equal(rms(silent.output[0]), 0);
const loudFirstSecond = render({ amplitude: 0.5, seconds: 1 });
assert.ok(
  loudFirstSecond.engine.state().gainDb < -3,
  'loud unknown audio must attenuate before the three-second boost gate'
);
const muted = render({ seconds: 5 });
const heldGain = muted.engine.state().gainDb;
muted.engine.configure({ enabled: true, volume: 0 });
const mutedOutput = [new Float32Array(rate), new Float32Array(rate)];
muted.engine.process([], [], mutedOutput);
assert.equal(
  muted.engine.state().gainDb,
  heldGain,
  'muting must freeze gain adaptation'
);
assert.ok(
  mutedOutput[0].every((value) => value === 0),
  'mute must suppress the lookahead tail immediately'
);
muted.engine.configure({ enabled: false, volume: 1 });
muted.engine.process([], [], mutedOutput);
assert.ok(
  Math.abs(muted.engine.state().gainDb) < 1e-9,
  'comfort off must smoothly return to unity within 80 ms'
);
const bypass = render({ enabled: false });
assert.equal(bypass.engine.state().status, 'bypass');
assert.ok(Math.abs(rms(bypass.output[0]) - 0.07 / Math.sqrt(2)) < 0.0001);
const originalPeaks = render({ enabled: false, amplitude: 1.1 });
assert.equal(originalPeaks.engine.state().limiterActive, false);
for (let index = 12 * rate; index < 13 * rate; index += 1) {
  const expected = Math.fround(
    1.1 *
      Math.sin(
        (2 * Math.PI * 997 * (index - originalPeaks.engine.delayFrames)) / rate
      )
  );
  assert.equal(
    originalPeaks.output[0][index],
    expected,
    'original/off must preserve even peaks above the protective ceiling'
  );
}
const toggle = new ComfortProcessor(rate);
toggle.configure({ enabled: true, volume: 1, knownLufs: -25, reset: true });
const fullScale = new Float32Array(rate).fill(1);
const toggleOutput = [new Float32Array(rate), new Float32Array(rate)];
toggle.process([fullScale, fullScale], [fullScale, fullScale], toggleOutput);
toggle.configure({ enabled: false, volume: 1 });
toggle.process([fullScale, fullScale], [fullScale, fullScale], toggleOutput);
assert.equal(
  toggleOutput[0][rate - 1],
  1,
  'off must recover original peaks after the ramp and buffer drain'
);
assert.ok(
  toggleOutput[0][0] < 0.85,
  'former boosted samples must remain protected during the off transition'
);
assert.equal(toggle.state().limiterActive, false);
const fx = render({ enabled: false, effect: 'night', fxScale: 0.5 });
assert.ok(Math.abs(fx.engine.state().fxMakeupDb - 20 * Math.log10(2)) < 0.05);
assert.ok(
  Math.abs(20 * Math.log10(rms(fx.output[0]) / rms(bypass.output[0]))) < 0.1
);

const transient = new ComfortProcessor(rate);
transient.configure({ enabled: true, volume: 1, knownLufs: -25, reset: true });
const input = Float32Array.from({ length: rate }, (_, index) =>
  index === 1000 ? 1 : 0
);
const output = [new Float32Array(rate), new Float32Array(rate)];
transient.process([input, input], [input, input], output);
assert.ok(Math.max(...output[0].subarray(0, 3000)) < 0.85);
transient.configure({ enabled: true, volume: 1, knownLufs: null, reset: true });
const resetOutput = [new Float32Array(128), new Float32Array(128)];
transient.process([], [], resetOutput);
assert.ok(
  resetOutput[0].every((value) => value === 0),
  'reset must flush the delayed old track'
);
assert.equal(
  transient.state().gainDb,
  0,
  'a new unknown track must not inherit known boost'
);
// A same-media seek flushes audio/meter state without returning a calibrated
// quietened stream to unity; a new media reset still gets a clean initial gain.
const seek = render({ amplitude: 0.5 });
const seekGain = seek.engine.state().gainDb;
assert.ok(seekGain < -9);
seek.engine.configure({
  enabled: true,
  volume: 1,
  reset: true,
  preserveGainOnReset: true,
});
seek.engine.process(
  [new Float32Array(128)],
  [new Float32Array(128)],
  resetOutput
);
assert.ok(Math.abs(seek.engine.state().gainDb - seekGain) < 0.001);
seek.engine.configure({ enabled: true, volume: 1, reset: true });
assert.equal(
  seek.engine.state().gainDb,
  0,
  'a fresh unknown media must not inherit seek gain'
);

const parked = new ComfortProcessor(rate);
parked.configure({ enabled: false, volume: 1, paused: true });
parked.effectFilters[0].process = () => {
  throw new Error('paused meter executed');
};
parked.process([], [], resetOutput);
assert.ok(resetOutput[0].every((value) => value === 0));
parked.configure({ enabled: false, volume: 1, paused: false });
parked.process([], [], [new Float32Array(rate), new Float32Array(rate)]);
const idleFrame = parked.frame;
const processFilter = parked.effectFilters[0].process;
parked.effectFilters[0].process = () => {
  throw new Error('idle FIR/meter executed');
};
parked.process([], [], resetOutput);
assert.equal(
  parked.frame,
  idleFrame,
  'drained empty input must take the cheap idle path'
);
parked.effectFilters[0].process = processFilter;
const resumedInput = new Float32Array(1024).fill(0.07);
const resumedOutput = [new Float32Array(1024), new Float32Array(1024)];
parked.process(
  [resumedInput, resumedInput],
  [resumedInput, resumedInput],
  resumedOutput
);
assert.ok(
  resumedOutput[0].some((value) => value !== 0),
  'new audio must resume after the cheap idle path'
);

let Worklet;
class MockProcessor {
  constructor() {
    this.port = { postMessage() {} };
  }
}
vm.runInNewContext(
  fs.readFileSync(
    path.join(__dirname, '../js/comfort_loudness_worklet.js'),
    'utf8'
  ),
  {
    AudioWorkletProcessor: MockProcessor,
    sampleRate: rate,
    Listen2Comfort: { ComfortProcessor },
    registerProcessor(_name, Constructor) {
      Worklet = Constructor;
    },
  }
);
const disposed = new Worklet();
disposed.port.onmessage({ data: { type: 'dispose' } });
assert.equal(disposed.engine, null, 'dispose must release DSP buffers');
assert.equal(
  disposed.process([], [resetOutput]),
  false,
  'disposed processor must release its active-source lifetime'
);
console.log(
  'comfort_loudness_dsp.test.js: passed',
  JSON.stringify({
    quiet: quiet.engine.state(),
    loud: loud.engine.state(),
    fx: fx.engine.state(),
  })
);
