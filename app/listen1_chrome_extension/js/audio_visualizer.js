/* eslint-disable no-bitwise, no-underscore-dangle, no-param-reassign, prefer-destructuring */
/* global angular process */

/*
 * Real-time audio analysis for the Now Playing stage.
 *
 * Listen 1 streams long tracks with an HTMLMediaElement-backed Howl. The
 * desktop app makes media responses CORS-readable and this module routes that
 * exact element through one persistent AudioContext. Both canvases consume the
 * same frame, so the orbit, waveform and ambient CSS variables stay in phase.
 * There is deliberately no synthetic animation fallback.
 */
(function registerAudioReactiveStage() {
  const BAR_COUNT = 64;
  const FFT_SIZE = 2048;
  const MIN_ACTIVE_LEVEL = 0.004;
  const EFFECT_PRESETS = {
    original: { preampDb: 0, filters: [] },
    'clear-vocals': {
      preampDb: -2,
      filters: [
        ['highpass', 90, 0, 0.7],
        ['peaking', 2600, 2.4, 1],
      ],
    },
    'deep-bass': {
      preampDb: -5,
      filters: [
        ['lowshelf', 85, 3.5, 0.7],
        ['peaking', 180, 1.4, 1],
      ],
    },
    airy: { preampDb: -3, filters: [['highshelf', 9000, 2.2, 0.7]] },
    warm: { preampDb: -3, filters: [['lowshelf', 180, 1.7, 0.7]] },
    'hifi-live': {
      preampDb: -4,
      filters: [
        ['lowshelf', 90, 1.4, 0.7],
        ['peaking', 3200, 1.3, 1],
        ['highshelf', 10000, 1.2, 0.7],
      ],
    },
    'immersive-3d': {
      preampDb: -6,
      filters: [['peaking', 2400, 1.2, 0.8]],
      requiresSpatialization: true,
    },
    night: {
      preampDb: -5,
      filters: [['highshelf', 8000, -1.2, 0.7]],
      compressor: true,
    },
  };
  const SOFT_LIMITER_CURVE = Float32Array.from({ length: 2049 }, (_, index) => {
    const input = (index / 2048) * 2 - 1;
    const magnitude = Math.abs(input);
    const threshold = 0.9;
    if (magnitude <= threshold) return input;
    const excess = magnitude - threshold;
    const limited = magnitude - 2 * excess * excess;
    return Math.sign(input) * limited;
  });

  const clamp = (value, min = 0, max = 1) =>
    Math.max(min, Math.min(max, value));

  const createAnalysisHub = ($window) => {
    const AudioContextClass =
      $window.AudioContext || $window.webkitAudioContext;
    const bars = new Float32Array(BAR_COUNT);
    const rawBars = new Float32Array(BAR_COUNT);
    const mediaSourceRecords = new WeakMap();
    const captureSourceRecords = new WeakMap();
    const bassHistory = [];

    let ownedContext = null;
    let ownedContextStateListener = null;
    let analyserContext = null;
    let analyser = null;
    let frequencyData = null;
    let waveformData = null;
    let currentHowl = null;
    let currentNode = null;
    let currentTap = null;
    let currentMode = 'idle';
    let connectionStartedAt = 0;
    let lastSignalAt = 0;
    let lastSampleAt = 0;
    let lastBeatAt = -Infinity;
    let peakEnvelope = 0.32;
    let status = 'idle';
    // `createMediaElementSource()` takes over an HTMLMediaElement's audible
    // route. Keep that output lifecycle separate from visualizer sampling: a
    // hidden now-playing page must never disable recovery for active audio.
    let outputStatus = 'native';
    let outputRecoveryAttempts = 0;
    let outputRecoveryTimer = null;
    let outputResumeInFlight = false;
    let outputRecoveryNode = null;
    let outputFailure = null;
    let outputRecoveryHint = '';
    let effectPreset = 'original';
    let effectState = {
      ok: true,
      preset: 'original',
      requestedPreset: 'original',
      supported: false,
      degraded: false,
      error: null,
    };
    let beatCount = 0;
    let publishedRoot = null;
    let publishedSignal = '';
    const publishedCssMetrics = {};
    let metrics = {
      bass: 0,
      mid: 0,
      high: 0,
      level: 0,
      beat: 0,
      rms: 0,
    };

    const isElectronRuntime = () =>
      typeof process !== 'undefined' &&
      process.versions &&
      Boolean(process.versions.electron);

    const getMediaNode = (howl) => {
      if (!howl || !Array.isArray(howl._sounds)) {
        return null;
      }
      const soundsWithNodes = howl._sounds.filter(
        (sound) =>
          sound &&
          sound._node &&
          typeof sound._node.play === 'function' &&
          typeof sound._node.pause === 'function'
      );
      const activeSound = soundsWithNodes.find(
        (sound) => sound._paused === false
      );
      return (activeSound || soundsWithNodes[0] || {})._node || null;
    };

    const timerSet = (callback, delay) => {
      const schedule = $window.setTimeout || setTimeout;
      return schedule(callback, delay);
    };

    const timerClear = (timer) => {
      const cancel = $window.clearTimeout || clearTimeout;
      cancel(timer);
    };

    const safeError = (error) => ({
      name: (error && error.name) || 'AudioContextError',
      message: String((error && error.message) || 'Audio output unavailable')
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/\?[^\s]*/g, '?[redacted]')
        .slice(0, 180),
    });

    const recordOutputFailure = (stage, error, hint = '') => {
      outputStatus = 'unavailable';
      outputFailure = {
        stage,
        ...safeError(error),
      };
      outputRecoveryHint = hint;
    };

    const clearOutputRecoveryTimer = () => {
      if (outputRecoveryTimer !== null) {
        timerClear(outputRecoveryTimer);
        outputRecoveryTimer = null;
      }
    };

    const markOutputRunning = () => {
      clearOutputRecoveryTimer();
      outputResumeInFlight = false;
      outputRecoveryAttempts = 0;
      outputFailure = null;
      outputRecoveryHint = '';
      outputStatus = 'running';
    };

    let requestOwnedContextResume = () => false;

    const observeOwnedContext = (context) => {
      if (!context || context === ownedContext) {
        return;
      }
      if (ownedContext && ownedContextStateListener) {
        if (typeof ownedContext.removeEventListener === 'function') {
          ownedContext.removeEventListener(
            'statechange',
            ownedContextStateListener
          );
        } else if (ownedContext.onstatechange === ownedContextStateListener) {
          ownedContext.onstatechange = null;
        }
      }
      ownedContext = context;
      ownedContextStateListener = () => {
        if (context.state === 'running') {
          markOutputRunning();
          return;
        }
        if (context.state === 'closed') {
          clearOutputRecoveryTimer();
          outputResumeInFlight = false;
          recordOutputFailure(
            'context-closed',
            new Error('The audio output context was closed'),
            'recreate-media-element'
          );
          return;
        }
        if (!outputRecoveryNode) {
          return;
        }
        // Chromium normally reports `suspended`; WebKit may report
        // `interrupted`. Treat both as recoverable, but never spin forever.
        requestOwnedContextResume('statechange');
      };
      if (typeof context.addEventListener === 'function') {
        context.addEventListener('statechange', ownedContextStateListener);
      } else {
        context.onstatechange = ownedContextStateListener;
      }
    };

    const ensureOwnedContext = () => {
      if (!AudioContextClass) {
        return null;
      }
      if (!ownedContext || ownedContext.state === 'closed') {
        try {
          observeOwnedContext(
            new AudioContextClass({
              latencyHint: 'interactive',
            })
          );
        } catch (error) {
          try {
            observeOwnedContext(new AudioContextClass());
          } catch (fallbackError) {
            recordOutputFailure('create-context', fallbackError);
            return null;
          }
        }
      }
      return ownedContext;
    };

    const resumeExternalContext = (context) => {
      if (
        context &&
        context.state !== 'running' &&
        context.state !== 'closed' &&
        typeof context.resume === 'function'
      ) {
        Promise.resolve(context.resume()).catch(() => {});
      }
    };

    const scheduleOwnedContextResume = (trigger) => {
      const context = ownedContext;
      if (
        !context ||
        context.state === 'running' ||
        context.state === 'closed' ||
        outputResumeInFlight ||
        outputRecoveryTimer !== null
      ) {
        return false;
      }
      if (outputRecoveryAttempts >= 3) {
        recordOutputFailure(
          'resume-exhausted',
          new Error('Audio output did not resume after bounded retries'),
          'recreate-media-element'
        );
        return false;
      }
      const retryDelays = [0, 350, 1400];
      const delay = retryDelays[outputRecoveryAttempts] || 1400;
      outputStatus = 'recovering';
      outputRecoveryTimer = timerSet(() => {
        outputRecoveryTimer = null;
        requestOwnedContextResume(trigger);
      }, delay);
      return true;
    };

    requestOwnedContextResume = (trigger = 'ensure-output') => {
      const context = ownedContext;
      if (!context) {
        return false;
      }
      if (context.state === 'running') {
        markOutputRunning();
        return true;
      }
      if (context.state === 'closed') {
        recordOutputFailure(
          'context-closed',
          new Error('The audio output context was closed'),
          'recreate-media-element'
        );
        return false;
      }
      if (outputResumeInFlight) {
        return true;
      }
      if (typeof context.resume !== 'function') {
        recordOutputFailure(
          'resume-unsupported',
          new Error('AudioContext.resume is unavailable'),
          'recreate-media-element'
        );
        return false;
      }

      outputResumeInFlight = true;
      outputRecoveryAttempts += 1;
      outputStatus = 'recovering';
      Promise.resolve(context.resume())
        .then(() => {
          outputResumeInFlight = false;
          if (context.state === 'running') {
            markOutputRunning();
          } else {
            recordOutputFailure(
              'resume-incomplete',
              new Error(`AudioContext remained ${context.state} after resume`)
            );
            scheduleOwnedContextResume(trigger);
          }
        })
        .catch((error) => {
          outputResumeInFlight = false;
          recordOutputFailure('resume', error);
          scheduleOwnedContextResume(trigger);
        });
      return true;
    };

    const disconnectAnalyserTap = () => {
      if (currentTap && analyser) {
        try {
          currentTap.disconnect(analyser);
        } catch (error) {
          // A recycled Howler node may already have dropped this branch.
        }
      }
      currentTap = null;
    };

    const ensureAnalyser = (context) => {
      if (!context || typeof context.createAnalyser !== 'function') {
        return null;
      }
      if (
        analyser &&
        analyserContext === context &&
        context.state !== 'closed'
      ) {
        return analyser;
      }

      disconnectAnalyserTap();
      if (analyser) {
        try {
          analyser.disconnect();
        } catch (error) {
          // Closed contexts can reject explicit disconnection.
        }
      }

      analyserContext = context;
      analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.minDecibels = -92;
      analyser.maxDecibels = -14;
      analyser.smoothingTimeConstant = 0.24;
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      waveformData = new Uint8Array(analyser.fftSize);
      return analyser;
    };

    const markConnected = (howl, node, tap, mode) => {
      currentHowl = howl;
      currentNode = node;
      currentTap = tap;
      currentMode = mode;
      connectionStartedAt =
        $window.performance && $window.performance.now
          ? $window.performance.now()
          : Date.now();
      status = 'connecting';
      return true;
    };

    const requestedTrackGain = (howl) => {
      const gain = Number(howl && howl._listen1TrackGain);
      return Number.isFinite(gain) && gain > 0 ? gain : 1;
    };

    const applyTrackGain = (record, howl) => {
      if (!record || !record.gain || !record.gain.gain) {
        return false;
      }
      const gainParam = record.gain.gain;
      const target = requestedTrackGain(howl);
      const contextTime = Number.isFinite(record.context.currentTime)
        ? record.context.currentTime
        : 0;
      try {
        if (typeof gainParam.cancelScheduledValues === 'function') {
          gainParam.cancelScheduledValues(contextTime);
        }
        if (typeof gainParam.setValueAtTime === 'function') {
          gainParam.setValueAtTime(
            Number.isFinite(gainParam.value) ? gainParam.value : 1,
            contextTime
          );
        }
        if (typeof gainParam.linearRampToValueAtTime === 'function') {
          gainParam.linearRampToValueAtTime(target, contextTime + 0.018);
        } else {
          gainParam.value = target;
        }
        return true;
      } catch (error) {
        // A failed optional normalization must never leave the track muted.
        try {
          gainParam.value = 1;
        } catch (fallbackError) {
          // The existing output recovery path will recreate an unusable node.
        }
        return false;
      }
    };

    const effectParam = (param, value, context) => {
      if (!param) return;
      const time = Number.isFinite(context.currentTime)
        ? context.currentTime
        : 0;
      if (typeof param.cancelScheduledValues === 'function') {
        param.cancelScheduledValues(time);
      }
      if (typeof param.setValueAtTime === 'function') {
        // These nodes are built off-line and connected only after the graph is
        // complete. Starting from Web Audio defaults (for example Gain=+1)
        // and ramping to a negative crossfeed would create a loud transient.
        param.setValueAtTime(value, time);
      } else {
        param.value = value;
      }
    };

    const disconnectEffectNodes = (record) => {
      [record.effectOutput, ...(record.effectNodes || [])].forEach((node) => {
        if (node && typeof node.disconnect === 'function') {
          try {
            node.disconnect();
          } catch (error) {
            // Recycling a media node can make explicit cleanup reject.
          }
        }
      });
      record.effectOutput = null;
      record.effectNodes = [];
    };

    const buildEffectChain = (record, requestedPreset) => {
      const context = record.context;
      const preset = EFFECT_PRESETS[requestedPreset];
      if (!preset || !record.effectInput || !context) {
        return { ok: false, error: 'invalid-preset' };
      }
      if (typeof record.effectInput.disconnect === 'function') {
        try {
          record.effectInput.disconnect();
        } catch (error) {
          // A closed/recycled node may already be disconnected.
        }
      }
      disconnectEffectNodes(record);
      try {
        let cursor = record.effectInput;
        const nodes = [];
        const useProcessing = requestedPreset !== 'original';
        if (useProcessing && typeof context.createBiquadFilter !== 'function') {
          throw new Error('BiquadFilterNode is unavailable');
        }
        if (useProcessing) {
          const preamp = context.createGain();
          effectParam(preamp.gain, 10 ** (preset.preampDb / 20), context);
          cursor.connect(preamp);
          cursor = preamp;
          nodes.push(preamp);
        }
        preset.filters.forEach(([type, frequency, gain, q]) => {
          const filter = context.createBiquadFilter();
          filter.type = type;
          effectParam(filter.frequency, frequency, context);
          effectParam(filter.gain, gain, context);
          effectParam(filter.Q, q, context);
          cursor.connect(filter);
          cursor = filter;
          nodes.push(filter);
        });
        if (preset.requiresSpatialization) {
          const requiredSpatialNodes = [
            'createChannelSplitter',
            'createChannelMerger',
            'createDelay',
            'createBiquadFilter',
          ];
          if (
            !requiredSpatialNodes.every(
              (method) => typeof context[method] === 'function'
            )
          ) {
            throw new Error('Symmetric spatialization is unavailable');
          }
          const stereoInput = context.createGain();
          stereoInput.channelCount = 2;
          stereoInput.channelCountMode = 'explicit';
          stereoInput.channelInterpretation = 'speakers';
          const splitter = context.createChannelSplitter(2);
          const merger = context.createChannelMerger(2);
          const leftDirect = context.createGain();
          const rightDirect = context.createGain();
          const leftDelay = context.createDelay(0.05);
          const rightDelay = context.createDelay(0.05);
          const leftFilter = context.createBiquadFilter();
          const rightFilter = context.createBiquadFilter();
          const leftCrossfeed = context.createGain();
          const rightCrossfeed = context.createGain();
          effectParam(leftDelay.delayTime, 0.01, context);
          effectParam(rightDelay.delayTime, 0.01, context);
          [leftFilter, rightFilter].forEach((filter) => {
            filter.type = 'lowpass';
            effectParam(filter.frequency, 6500, context);
            effectParam(filter.Q, 0.7, context);
          });
          // Equal, low-amplitude inverted crossfeed adds a headphone room cue
          // without pushing the image toward either speaker.
          effectParam(leftCrossfeed.gain, -0.08, context);
          effectParam(rightCrossfeed.gain, -0.08, context);
          // ChannelSplitter uses discrete channel interpretation, so feeding a
          // mono source directly would leave its second output silent. Force a
          // standards-defined mono-to-stereo speaker up-mix before splitting.
          cursor.connect(stereoInput);
          stereoInput.connect(splitter);
          splitter.connect(leftDirect, 0);
          splitter.connect(rightDirect, 1);
          leftDirect.connect(merger, 0, 0);
          rightDirect.connect(merger, 0, 1);
          splitter.connect(leftDelay, 0);
          splitter.connect(rightDelay, 1);
          leftDelay.connect(leftFilter);
          rightDelay.connect(rightFilter);
          leftFilter.connect(leftCrossfeed);
          rightFilter.connect(rightCrossfeed);
          leftCrossfeed.connect(merger, 0, 1);
          rightCrossfeed.connect(merger, 0, 0);
          cursor = merger;
          nodes.push(
            stereoInput,
            splitter,
            merger,
            leftDirect,
            rightDirect,
            leftDelay,
            rightDelay,
            leftFilter,
            rightFilter,
            leftCrossfeed,
            rightCrossfeed
          );
        }
        if (preset.compressor) {
          if (typeof context.createDynamicsCompressor !== 'function') {
            throw new Error('DynamicsCompressorNode is unavailable');
          }
          const compressor = context.createDynamicsCompressor();
          effectParam(compressor.threshold, -20, context);
          effectParam(compressor.knee, 12, context);
          effectParam(compressor.ratio, 2, context);
          effectParam(compressor.attack, 0.02, context);
          effectParam(compressor.release, 0.25, context);
          cursor.connect(compressor);
          cursor = compressor;
          nodes.push(compressor);
        }
        if (useProcessing && typeof context.createWaveShaper === 'function') {
          const limiter = context.createWaveShaper();
          limiter.oversample = '2x';
          limiter.curve = SOFT_LIMITER_CURVE;
          cursor.connect(limiter);
          cursor = limiter;
          nodes.push(limiter);
        }
        cursor.connect(context.destination);
        record.effectNodes = nodes;
        record.effectOutput = cursor;
        return { ok: true, preset: requestedPreset };
      } catch (error) {
        disconnectEffectNodes(record);
        try {
          record.effectInput.connect(context.destination);
          record.effectOutput = record.effectInput;
        } catch (fallbackError) {
          return { ok: false, error: 'effect-unavailable' };
        }
        return { ok: false, error: 'effect-unavailable', fallback: 'original' };
      }
    };

    const setEffectPreset = (requestedPreset) => {
      const requested = String(requestedPreset || 'original');
      if (!Object.prototype.hasOwnProperty.call(EFFECT_PRESETS, requested)) {
        return {
          ok: false,
          preset: effectPreset,
          requestedPreset: requested,
          supported: isElectronRuntime(),
          degraded: false,
          error: 'invalid-preset',
        };
      }
      effectPreset = requested;
      if (!isElectronRuntime()) {
        effectState = {
          ok: false,
          preset: 'original',
          requestedPreset: requested,
          supported: false,
          degraded: true,
          error: 'unsupported',
        };
        return { ...effectState };
      }
      const record = currentNode && mediaSourceRecords.get(currentNode);
      const built = record ? buildEffectChain(record, requested) : { ok: true };
      effectState = {
        ok: built.ok,
        preset: built.ok ? requested : 'original',
        requestedPreset: requested,
        supported: true,
        degraded: built.ok !== true,
        error: built.error || null,
      };
      if (record && record.effectOutput) {
        disconnectAnalyserTap();
        record.effectOutput.connect(analyser);
        markConnected(
          currentHowl,
          currentNode,
          record.effectOutput,
          'html5-media'
        );
      }
      return { ...effectState };
    };

    const connectHtml5Element = (howl, node) => {
      const context = ensureOwnedContext();
      const nextAnalyser = ensureAnalyser(context);
      if (!context || !nextAnalyser) {
        return false;
      }
      if (
        currentHowl === howl &&
        currentNode === node &&
        currentTap &&
        analyserContext === context
      ) {
        applyTrackGain(mediaSourceRecords.get(node), howl);
        requestOwnedContextResume('existing-html5-output');
        return true;
      }

      disconnectAnalyserTap();
      try {
        let record = mediaSourceRecords.get(node);
        if (!record) {
          if (typeof context.createGain !== 'function') {
            recordOutputFailure(
              'create-track-gain',
              new Error('AudioContext.createGain is unavailable'),
              'recreate-media-element'
            );
            return false;
          }
          const source = context.createMediaElementSource(node);
          let gain;
          // MediaElementAudioSourceNode replaces the element's native output,
          // so preserve normal playback with a per-track gain before adding a
          // passive analysis branch. Do not connect this source twice.
          try {
            gain = context.createGain();
            gain.gain.value = 1;
            source.connect(gain);
            const effectInput = context.createGain();
            gain.connect(effectInput);
            record = {
              context,
              source,
              gain,
              effectInput,
              effectNodes: [],
              effectOutput: null,
              outputConnected: true,
            };
            const built = buildEffectChain(record, effectPreset);
            effectState = {
              ok: built.ok,
              preset: built.ok ? effectPreset : 'original',
              requestedPreset: effectPreset,
              supported: true,
              degraded: built.ok !== true,
              error: built.error || null,
            };
            if (!record.effectOutput) {
              throw new Error('Effect output is unavailable');
            }
          } catch (error) {
            // At this point the element has already been claimed by this
            // AudioContext, so native output cannot be restored in place.
            // Keep the record for diagnostics and let Player recreate the
            // media element when it receives this recovery hint.
            record = { context, source, outputConnected: false };
            mediaSourceRecords.set(node, record);
            recordOutputFailure(
              'connect-destination',
              error,
              'recreate-media-element'
            );
            return false;
          }
          mediaSourceRecords.set(node, record);
        }
        if (record.context !== context || !record.outputConnected) {
          recordOutputFailure(
            'reuse-media-source',
            new Error('Audio output source is attached to an unusable context'),
            'recreate-media-element'
          );
          return false;
        }
        applyTrackGain(record, howl);
        record.effectOutput.connect(nextAnalyser);
        const connected = markConnected(
          howl,
          node,
          record.effectOutput,
          'html5-media'
        );
        if (outputRecoveryNode !== node) {
          outputRecoveryNode = node;
          outputRecoveryAttempts = 0;
          outputFailure = null;
          outputRecoveryHint = '';
        }
        requestOwnedContextResume('connect-html5-output');
        return connected;
      } catch (error) {
        recordOutputFailure('connect-html5-source', error);
        status = 'unavailable';
        return false;
      }
    };

    const connectCapturedElement = (howl, node) => {
      // Browser capture is analysis-only: HTMLMediaElement keeps its native
      // output path, so any capture failure must never look like an audible
      // output outage in diagnostics.
      if (!outputRecoveryNode) {
        outputStatus = 'native';
        outputFailure = null;
        outputRecoveryHint = '';
      }
      const capture =
        node.captureStream || node.mozCaptureStream || node.webkitCaptureStream;
      if (typeof capture !== 'function') {
        return false;
      }
      const context = ensureOwnedContext();
      const nextAnalyser = ensureAnalyser(context);
      if (!context || !nextAnalyser) {
        return false;
      }
      if (
        currentHowl === howl &&
        currentNode === node &&
        currentTap &&
        analyserContext === context
      ) {
        resumeExternalContext(context);
        return true;
      }

      disconnectAnalyserTap();
      try {
        let record = captureSourceRecords.get(node);
        if (!record) {
          const stream = capture.call(node);
          const source = context.createMediaStreamSource(stream);
          record = { context, source, stream };
          captureSourceRecords.set(node, record);
        }
        if (record.context !== context) {
          return false;
        }
        record.source.connect(nextAnalyser);
        const connected = markConnected(
          howl,
          node,
          record.source,
          'captured-media'
        );
        // This observer never replaces browser-native audio output. Resume is
        // best effort for analysis only, so it must not report an audio outage.
        resumeExternalContext(context);
        return connected;
      } catch (error) {
        status = 'unavailable';
        return false;
      }
    };

    const connectWebAudioHowl = (howl) => {
      const howler = $window.Howler;
      if (
        !howl ||
        howl._webAudio !== true ||
        !howler ||
        !howler.ctx ||
        !howler.masterGain
      ) {
        return false;
      }
      const nextAnalyser = ensureAnalyser(howler.ctx);
      if (!nextAnalyser) {
        return false;
      }
      if (
        currentHowl === howl &&
        currentTap === howler.masterGain &&
        analyserContext === howler.ctx
      ) {
        resumeExternalContext(howler.ctx);
        return true;
      }

      disconnectAnalyserTap();
      try {
        howler.masterGain.connect(nextAnalyser);
        resumeExternalContext(howler.ctx);
        return markConnected(howl, null, howler.masterGain, 'howler-web-audio');
      } catch (error) {
        status = 'unavailable';
        return false;
      }
    };

    const connectHowl = (howl) => {
      if (!howl) {
        status = 'waiting';
        return false;
      }
      if (connectWebAudioHowl(howl)) {
        return true;
      }

      const node = getMediaNode(howl);
      if (!node) {
        status = 'waiting';
        return false;
      }
      if (isElectronRuntime()) {
        return connectHtml5Element(howl, node);
      }
      // Browser extensions keep native playback untouched. captureStream is a
      // best-effort observer and becomes silent when the source is not
      // origin-clean, which is safer than rerouting and muting playback.
      return connectCapturedElement(howl, node);
    };

    const normalizedBin = (value) => clamp((value / 255 - 0.045) / 0.955);

    const frequencyRangeEnergy = (minHz, maxHz) => {
      if (!analyser || !frequencyData || !analyserContext) {
        return 0;
      }
      const nyquist = analyserContext.sampleRate / 2;
      const firstBin = clamp(
        Math.floor((minHz / nyquist) * frequencyData.length),
        1,
        frequencyData.length - 1
      );
      const lastBin = clamp(
        Math.ceil((maxHz / nyquist) * frequencyData.length),
        firstBin,
        frequencyData.length - 1
      );
      let sumSquares = 0;
      let peak = 0;
      let samples = 0;
      for (let index = firstBin; index <= lastBin; index += 1) {
        const level = normalizedBin(frequencyData[index]);
        sumSquares += level * level;
        peak = Math.max(peak, level);
        samples += 1;
      }
      const average = samples ? Math.sqrt(sumSquares / samples) : 0;
      return average * 0.72 + peak * 0.28;
    };

    const fillRawBars = () => {
      if (!analyser || !frequencyData || !analyserContext) {
        rawBars.fill(0);
        return 0;
      }
      const nyquist = analyserContext.sampleRate / 2;
      const minimumFrequency = 42;
      const maximumFrequency = Math.min(16000, nyquist * 0.9);
      const frequencyRatio = maximumFrequency / minimumFrequency;
      let framePeak = 0;

      for (let barIndex = 0; barIndex < BAR_COUNT; barIndex += 1) {
        const startRatio = barIndex / BAR_COUNT;
        const endRatio = (barIndex + 1) / BAR_COUNT;
        const startFrequency = minimumFrequency * frequencyRatio ** startRatio;
        const endFrequency = minimumFrequency * frequencyRatio ** endRatio;
        const firstBin = clamp(
          Math.floor((startFrequency / nyquist) * frequencyData.length),
          1,
          frequencyData.length - 1
        );
        const lastBin = clamp(
          Math.max(
            firstBin,
            Math.ceil((endFrequency / nyquist) * frequencyData.length)
          ),
          firstBin,
          frequencyData.length - 1
        );
        let sumSquares = 0;
        let peak = 0;
        let samples = 0;
        for (let bin = firstBin; bin <= lastBin; bin += 1) {
          const level = normalizedBin(frequencyData[bin]);
          sumSquares += level * level;
          peak = Math.max(peak, level);
          samples += 1;
        }
        const average = samples ? Math.sqrt(sumSquares / samples) : 0;
        const frequencyCompensation = 0.96 + (barIndex / BAR_COUNT) * 0.2;
        const level = clamp(
          (average * 0.68 + peak * 0.32) * frequencyCompensation
        );
        rawBars[barIndex] = level;
        framePeak = Math.max(framePeak, level);
      }
      return framePeak;
    };

    const waveformRms = () => {
      if (!waveformData || !waveformData.length) {
        return 0;
      }
      let sumSquares = 0;
      for (let index = 0; index < waveformData.length; index += 1) {
        const sample = (waveformData[index] - 128) / 128;
        sumSquares += sample * sample;
      }
      return Math.sqrt(sumSquares / waveformData.length);
    };

    const smoothValue = (current, target, delta, attackMs, releaseMs) => {
      const timeConstant = target > current ? attackMs : releaseMs;
      const amount = 1 - Math.exp(-delta / timeConstant);
      return current + (target - current) * amount;
    };

    const publishCssState = () => {
      const root =
        publishedRoot && publishedRoot.isConnected
          ? publishedRoot
          : $window.document.querySelector('.modern-player-state');
      if (!root) {
        return;
      }
      if (root !== publishedRoot) {
        publishedRoot = root;
        publishedSignal = '';
        Object.keys(publishedCssMetrics).forEach((key) => {
          delete publishedCssMetrics[key];
        });
      }

      // Canvas geometry remains full-resolution. CSS effects are quantized so
      // Chromium can reuse compositing states instead of compiling a unique
      // Metal pipeline for tiny, imperceptible value changes every frame.
      const cssMetrics = {
        '--audio-bass': metrics.bass,
        '--audio-mid': metrics.mid,
        '--audio-high': metrics.high,
        '--audio-level': metrics.level,
        '--audio-beat': metrics.beat,
      };
      Object.entries(cssMetrics).forEach(([property, value]) => {
        const quantized = (Math.round(clamp(value) * 24) / 24).toFixed(3);
        if (publishedCssMetrics[property] !== quantized) {
          root.style.setProperty(property, quantized);
          publishedCssMetrics[property] = quantized;
        }
      });
      if (publishedSignal !== status) {
        root.dataset.audioSignal = status;
        publishedSignal = status;
      }
    };

    const updateBeat = (bass, timestamp, delta) => {
      bassHistory.push({ timestamp, value: bass });
      while (
        bassHistory.length &&
        timestamp - bassHistory[0].timestamp > 1200
      ) {
        bassHistory.shift();
      }
      const average =
        bassHistory.reduce((sum, item) => sum + item.value, 0) /
        Math.max(1, bassHistory.length);
      const variance =
        bassHistory.reduce(
          (sum, item) => sum + (item.value - average) ** 2,
          0
        ) / Math.max(1, bassHistory.length);
      const deviation = Math.sqrt(variance);
      const threshold = Math.max(0.14, average + deviation * 1.18);
      const isBeat =
        bassHistory.length > 8 &&
        bass > threshold &&
        bass > average * 1.12 &&
        timestamp - lastBeatAt > 170;

      if (isBeat) {
        metrics.beat = 1;
        lastBeatAt = timestamp;
        beatCount += 1;
      } else {
        metrics.beat *= Math.exp(-delta / 155);
      }
    };

    const readAnalysisFrame = (timestamp, delta) => {
      analyser.getByteFrequencyData(frequencyData);
      analyser.getByteTimeDomainData(waveformData);

      const framePeak = fillRawBars();
      const rms = waveformRms();
      peakEnvelope = Math.max(
        framePeak,
        peakEnvelope * Math.exp(-delta / 2600)
      );
      const adaptiveGain = clamp(0.78 / Math.max(0.2, peakEnvelope), 0.82, 2.8);

      for (let index = 0; index < BAR_COUNT; index += 1) {
        const target = clamp(rawBars[index] * adaptiveGain);
        bars[index] = smoothValue(bars[index], target, delta, 34, 138);
      }

      const bassTarget = clamp(
        frequencyRangeEnergy(42, 190) * adaptiveGain * 1.08
      );
      const midTarget = clamp(frequencyRangeEnergy(190, 2800) * adaptiveGain);
      const highTarget = clamp(
        frequencyRangeEnergy(2800, 15000) * adaptiveGain * 1.08
      );
      const levelTarget = clamp(
        framePeak * adaptiveGain * 0.62 + rms * 2.3 * 0.38
      );

      metrics.bass = smoothValue(metrics.bass, bassTarget, delta, 38, 165);
      metrics.mid = smoothValue(metrics.mid, midTarget, delta, 48, 190);
      metrics.high = smoothValue(metrics.high, highTarget, delta, 28, 125);
      metrics.level = smoothValue(metrics.level, levelTarget, delta, 42, 180);
      metrics.rms = rms;
      updateBeat(bassTarget, timestamp, delta);

      if (framePeak > 0.035 || rms > 0.008) {
        lastSignalAt = timestamp;
      }
      if (timestamp - lastSignalAt < 900) {
        status = 'live';
      } else if (timestamp - connectionStartedAt < 1800) {
        status = 'connecting';
      } else {
        status = 'silent';
      }
    };

    const releaseAnalysisFrame = (delta, nextStatus) => {
      for (let index = 0; index < BAR_COUNT; index += 1) {
        bars[index] = smoothValue(bars[index], 0, delta, 40, 145);
      }
      metrics = {
        ...metrics,
        bass: smoothValue(metrics.bass, 0, delta, 40, 150),
        mid: smoothValue(metrics.mid, 0, delta, 40, 170),
        high: smoothValue(metrics.high, 0, delta, 40, 120),
        level: smoothValue(metrics.level, 0, delta, 40, 160),
        beat: metrics.beat * Math.exp(-delta / 130),
        rms: 0,
      };
      status = nextStatus;
    };

    const sample = (timestamp, howl, active) => {
      if (timestamp === lastSampleAt) {
        return {
          bars,
          ...metrics,
          status,
          mode: currentMode,
        };
      }
      const delta = clamp(timestamp - lastSampleAt || 16, 1, 80);
      lastSampleAt = timestamp;

      if (!active) {
        releaseAnalysisFrame(delta, 'paused');
      } else if (connectHowl(howl) && analyser) {
        try {
          readAnalysisFrame(timestamp, delta);
        } catch (error) {
          releaseAnalysisFrame(delta, 'unavailable');
        }
      } else {
        releaseAnalysisFrame(delta, status || 'unavailable');
      }

      publishCssState();
      return {
        bars,
        ...metrics,
        status,
        mode: currentMode,
      };
    };

    const ensureOutput = (howl) => {
      const connected = connectHowl(howl);
      if (connected && currentMode === 'html5-media') {
        requestOwnedContextResume('ensure-output');
      } else if (connected && analyserContext) {
        resumeExternalContext(analyserContext);
      }
      return connected;
    };

    // Existing callers expect this synchronous boolean API. `ensureOutput`
    // additionally gives Player/recovery code a name that describes the
    // audible-output contract rather than the visualizer implementation.
    const prepareHowl = (howl) => ensureOutput(howl);

    const sanitizedSource = () => {
      if (!currentNode || !currentNode.currentSrc) {
        return '';
      }
      try {
        const url = new URL(currentNode.currentSrc);
        return `${url.origin}${url.pathname}`;
      } catch (error) {
        return currentNode.currentSrc.split('?')[0];
      }
    };

    const debug = () => ({
      mode: currentMode,
      status,
      contextState: analyserContext ? analyserContext.state : 'none',
      fftSize: analyser ? analyser.fftSize : 0,
      frequencyBins: frequencyData ? frequencyData.length : 0,
      source: sanitizedSource(),
      crossOrigin: currentNode ? currentNode.crossOrigin || '' : '',
      output: {
        status: outputStatus,
        attempts: outputRecoveryAttempts,
        hint: outputRecoveryHint,
        failure: outputFailure,
        ownsMediaElementOutput: Boolean(outputRecoveryNode),
      },
      effects: { ...effectState },
      peak: Math.max(...bars),
      beatCount,
      ...metrics,
    });

    return {
      barCount: BAR_COUNT,
      debug,
      ensureOutput,
      getEffectState: () => ({ ...effectState }),
      prepareHowl,
      sample,
      setEffectPreset,
    };
  };

  const analysisHub = createAnalysisHub(window);
  window.Listen1AudioAnalysis = analysisHub;

  angular.module('listenone').directive('audioVisualizer', [
    '$window',
    ($window) => ({
      restrict: 'A',
      link: (scope, element, attrs) => {
        const host = element[0];
        const canvas = $window.document.createElement('canvas');
        const context = canvas.getContext('2d');
        const layout = attrs.audioVisualizerLayout || 'linear';
        const requestFrame =
          $window.requestAnimationFrame ||
          ((callback) => $window.setTimeout(() => callback(Date.now()), 16));
        const cancelFrame =
          $window.cancelAnimationFrame ||
          ((frame) => $window.clearTimeout(frame));
        const now = () =>
          $window.performance && $window.performance.now
            ? $window.performance.now()
            : Date.now();

        let animationFrame = null;
        let resizeObserver = null;
        let cssWidth = 0;
        let cssHeight = 0;
        let isDisposed = false;
        let isPlaying = false;
        let hasTrack = false;
        let stageIsOpen = false;
        let reducedMotion = false;
        let lastFrameAt = now();
        let progress = 0;
        let latestFrame = {
          bars: new Float32Array(BAR_COUNT),
          bass: 0,
          mid: 0,
          high: 0,
          level: 0,
          beat: 0,
          status: 'idle',
        };
        let palette = {
          accent: '139, 124, 246',
          mint: '#5dd6c7',
        };
        const gradientCache = new Map();

        canvas.className = 'audio-visualizer-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.pointerEvents = 'none';
        host.appendChild(canvas);

        if (!context) {
          return;
        }

        const expressionValue = (expression) =>
          expression ? Boolean(scope.$eval(expression)) : false;
        const numericExpressionValue = (expression) => {
          const value = expression ? Number(scope.$eval(expression)) : 0;
          return Number.isFinite(value) ? value : 0;
        };
        const isActiveStage = () => stageIsOpen && hasTrack;
        const shouldAnimate = () =>
          isActiveStage() && isPlaying && !reducedMotion;
        const maxLevel = () => Math.max(...latestFrame.bars);

        const resolveCurrentHowl = () => {
          try {
            if (
              typeof $window.getPlayer !== 'function' ||
              typeof $window.getPlayerMode !== 'function'
            ) {
              return null;
            }
            const player = $window.getPlayer($window.getPlayerMode());
            return player && player.currentHowl ? player.currentHowl : null;
          } catch (error) {
            return null;
          }
        };

        const rgbaFromHex = (hex, alpha) => {
          const normalized = String(hex || '')
            .trim()
            .replace('#', '');
          const expanded =
            normalized.length === 3
              ? normalized
                  .split('')
                  .map((part) => `${part}${part}`)
                  .join('')
              : normalized;
          if (!/^[0-9a-f]{6}$/i.test(expanded)) {
            return `rgba(93, 214, 199, ${alpha})`;
          }
          const color = Number.parseInt(expanded, 16);
          return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${
            color & 255
          }, ${alpha})`;
        };

        const refreshPalette = () => {
          const root = host.closest('.modern-body') || host;
          const styles = $window.getComputedStyle(root);
          palette = {
            accent:
              styles.getPropertyValue('--ui-accent-rgb').trim() ||
              '139, 124, 246',
            mint: styles.getPropertyValue('--ui-mint').trim() || '#5dd6c7',
          };
          gradientCache.clear();
        };

        const visualizerGradient = (alpha) => {
          const cacheKey = String(alpha);
          const cached = gradientCache.get(cacheKey);
          if (cached) {
            return cached;
          }
          const gradient = context.createLinearGradient(
            0,
            0,
            cssWidth,
            cssHeight
          );
          gradient.addColorStop(
            0,
            `rgba(${palette.accent}, ${clamp(alpha, 0, 1)})`
          );
          gradient.addColorStop(
            0.52,
            rgbaFromHex(palette.mint, clamp(alpha + 0.14, 0, 1))
          );
          gradient.addColorStop(
            1,
            `rgba(${palette.accent}, ${clamp(alpha + 0.08, 0, 1)})`
          );
          gradientCache.set(cacheKey, gradient);
          return gradient;
        };

        const roundedRect = (x, y, width, height, radius) => {
          const safeRadius = Math.min(radius, width / 2, height / 2);
          context.beginPath();
          if (context.roundRect) {
            context.roundRect(x, y, width, height, safeRadius);
          } else {
            context.moveTo(x + safeRadius, y);
            context.lineTo(x + width - safeRadius, y);
            context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
            context.lineTo(x + width, y + height - safeRadius);
            context.quadraticCurveTo(
              x + width,
              y + height,
              x + width - safeRadius,
              y + height
            );
            context.lineTo(x + safeRadius, y + height);
            context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
            context.lineTo(x, y + safeRadius);
            context.quadraticCurveTo(x, y, x + safeRadius, y);
          }
          context.closePath();
          context.fill();
        };

        const drawLinearFrame = () => {
          const activity = latestFrame.level;
          const baseline = cssHeight * 0.75;
          const barWidth = Math.max(
            2,
            Math.min(6, cssWidth / (BAR_COUNT * 1.72))
          );
          const gap = Math.max(
            1.2,
            (cssWidth - barWidth * BAR_COUNT) / (BAR_COUNT - 1)
          );
          const visualWidth = barWidth * BAR_COUNT + gap * (BAR_COUNT - 1);
          const startX = Math.max(0, (cssWidth - visualWidth) / 2);
          const topPoints = [];

          context.save();
          context.globalAlpha = 0.78 + activity * 0.22;
          context.fillStyle = visualizerGradient(0.66);
          context.shadowColor = `rgba(${palette.accent}, 0.48)`;
          context.shadowBlur = 13;

          for (let index = 0; index < BAR_COUNT; index += 1) {
            const level = latestFrame.bars[index];
            const height = Math.max(3, level * cssHeight * 0.82);
            const x = startX + index * (barWidth + gap);
            const y = baseline - height;
            roundedRect(x, y, barWidth, height, barWidth / 2);
            topPoints.push([x + barWidth / 2, y]);
          }
          context.restore();

          context.save();
          context.globalAlpha = 0.11 + activity * 0.15;
          context.fillStyle = visualizerGradient(0.36);
          for (let index = 0; index < BAR_COUNT; index += 1) {
            const reflection = Math.max(
              1.5,
              latestFrame.bars[index] * cssHeight * 0.14
            );
            const x = startX + index * (barWidth + gap);
            roundedRect(x, baseline + 4, barWidth, reflection, barWidth / 2);
          }
          context.restore();

          if (activity > MIN_ACTIVE_LEVEL && topPoints.length > 1) {
            context.save();
            context.beginPath();
            topPoints.forEach(([x, y], index) => {
              if (index === 0) {
                context.moveTo(x, y);
              } else {
                context.lineTo(x, y);
              }
            });
            context.strokeStyle = rgbaFromHex(palette.mint, 0.5);
            context.lineWidth = 1.15;
            context.shadowColor = rgbaFromHex(palette.mint, 0.42);
            context.shadowBlur = 9;
            context.stroke();
            context.restore();
          }

          context.fillStyle = `rgba(${palette.accent}, 0.2)`;
          context.fillRect(0, baseline, cssWidth, 1.25);
        };

        const drawRadialFrame = () => {
          const activity = latestFrame.level;
          const centerX = cssWidth / 2;
          const centerY = cssHeight / 2;
          const minimumDimension = Math.min(cssWidth, cssHeight);
          const radius = minimumDimension * 0.399;
          const progressAngle =
            -Math.PI / 2 + Math.PI * 2 * clamp(progress / 100);

          context.save();
          context.translate(centerX, centerY);

          context.strokeStyle = `rgba(${palette.accent}, 0.34)`;
          context.lineWidth = Math.max(1.8, minimumDimension / 155);
          context.beginPath();
          context.arc(0, 0, radius - 4, 0, Math.PI * 2);
          context.stroke();

          context.strokeStyle = `rgba(${palette.accent}, 0.22)`;
          context.lineWidth = Math.max(6, minimumDimension / 39);
          context.lineCap = 'round';
          context.shadowColor = `rgba(${palette.accent}, 0.58)`;
          context.shadowBlur = 14;
          context.beginPath();
          context.arc(0, 0, radius - 2, -Math.PI / 2, progressAngle);
          context.stroke();

          context.strokeStyle = visualizerGradient(0.66);
          context.lineWidth = Math.max(3.4, minimumDimension / 68);
          context.lineCap = 'round';
          context.shadowColor = `rgba(${palette.accent}, 0.72)`;
          context.shadowBlur = 15;
          context.beginPath();
          context.arc(0, 0, radius - 2, -Math.PI / 2, progressAngle);
          context.stroke();

          const dotX = Math.cos(progressAngle) * (radius - 2);
          const dotY = Math.sin(progressAngle) * (radius - 2);
          context.fillStyle = '#f6fbff';
          context.shadowColor = rgbaFromHex(palette.mint, 0.9);
          context.shadowBlur = 13;
          context.beginPath();
          context.arc(dotX, dotY, 3.8 + latestFrame.beat * 2.2, 0, Math.PI * 2);
          context.fill();

          context.globalAlpha = 0.74 + activity * 0.26;
          context.strokeStyle = visualizerGradient(0.64);
          context.lineWidth = Math.max(1.2, minimumDimension / 210);
          context.shadowColor = rgbaFromHex(palette.mint, 0.42);
          context.shadowBlur = 7;
          for (let index = 0; index < BAR_COUNT; index += 1) {
            const mirroredIndex =
              index < BAR_COUNT / 2 ? index * 2 : (BAR_COUNT - 1 - index) * 2;
            const level = latestFrame.bars[mirroredIndex];
            const angle = (index / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
            const innerRadius = radius + 7;
            const length =
              3 + level * minimumDimension * 0.14 + latestFrame.beat * 1.8;
            context.beginPath();
            context.moveTo(
              Math.cos(angle) * innerRadius,
              Math.sin(angle) * innerRadius
            );
            context.lineTo(
              Math.cos(angle) * (innerRadius + length),
              Math.sin(angle) * (innerRadius + length)
            );
            context.stroke();
          }
          context.restore();
        };

        const drawFrame = () => {
          if (cssWidth <= 0 || cssHeight <= 0) {
            return;
          }
          context.clearRect(0, 0, cssWidth, cssHeight);
          if (!isActiveStage()) {
            return;
          }
          if (layout === 'radial') {
            drawRadialFrame();
          } else {
            drawLinearFrame();
          }
        };

        const resizeCanvas = () => {
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.min($window.devicePixelRatio || 1, 2);
          cssWidth = Math.max(1, rect.width);
          cssHeight = Math.max(1, rect.height);
          const pixelWidth = Math.round(cssWidth * dpr);
          const pixelHeight = Math.round(cssHeight * dpr);
          if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
            gradientCache.clear();
          }
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          refreshPalette();
          drawFrame();
        };

        const stopAnimation = () => {
          if (animationFrame !== null) {
            cancelFrame(animationFrame);
            animationFrame = null;
          }
        };

        const needsAnotherFrame = () =>
          isActiveStage() &&
          !reducedMotion &&
          (isPlaying || maxLevel() > MIN_ACTIVE_LEVEL);

        const scheduleFrame = () => {
          if (
            !isDisposed &&
            !$window.document.hidden &&
            animationFrame === null &&
            needsAnotherFrame()
          ) {
            // The scheduler and callback intentionally reference each other
            // while keeping exactly one animation frame in flight.
            // eslint-disable-next-line no-use-before-define
            animationFrame = requestFrame(drawNextFrame);
          }
        };

        const drawNextFrame = (timestamp) => {
          animationFrame = null;
          if (isDisposed || $window.document.hidden) {
            return;
          }
          lastFrameAt = timestamp;
          progress = numericExpressionValue(attrs.audioVisualizerProgress);
          latestFrame = analysisHub.sample(
            timestamp,
            resolveCurrentHowl(),
            shouldAnimate()
          );
          drawFrame();
          scheduleFrame();
        };

        const refreshState = () => {
          isPlaying = expressionValue(attrs.audioVisualizerPlaying);
          hasTrack = expressionValue(attrs.audioVisualizerHasTrack);
          stageIsOpen = expressionValue(attrs.audioVisualizerActive);
          progress = numericExpressionValue(attrs.audioVisualizerProgress);

          if (!isActiveStage()) {
            stopAnimation();
            context.clearRect(0, 0, cssWidth, cssHeight);
            return;
          }
          if (isPlaying) {
            analysisHub.prepareHowl(resolveCurrentHowl());
          }
          lastFrameAt = now();
          if (needsAnotherFrame()) {
            scheduleFrame();
          } else {
            latestFrame = analysisHub.sample(
              lastFrameAt,
              resolveCurrentHowl(),
              false
            );
            drawFrame();
          }
        };

        const onVisibilityChange = () => {
          if ($window.document.hidden) {
            stopAnimation();
            return;
          }
          lastFrameAt = now();
          refreshState();
        };

        const motionQuery = $window.matchMedia
          ? $window.matchMedia('(prefers-reduced-motion: reduce)')
          : null;
        const onMotionChange = (event) => {
          reducedMotion = event.matches;
          refreshState();
        };

        if ($window.ResizeObserver) {
          resizeObserver = new $window.ResizeObserver(resizeCanvas);
          resizeObserver.observe(host);
        } else {
          $window.addEventListener('resize', resizeCanvas);
        }
        if (motionQuery) {
          reducedMotion = motionQuery.matches;
          if (motionQuery.addEventListener) {
            motionQuery.addEventListener('change', onMotionChange);
          } else if (motionQuery.addListener) {
            motionQuery.addListener(onMotionChange);
          }
        }

        const removePlayingWatch = scope.$watch(
          attrs.audioVisualizerPlaying,
          refreshState
        );
        const removeTrackWatch = scope.$watch(
          attrs.audioVisualizerHasTrack,
          refreshState
        );
        const removeStageWatch = scope.$watch(
          attrs.audioVisualizerActive,
          refreshState
        );
        const removeProgressWatch = attrs.audioVisualizerProgress
          ? scope.$watch(attrs.audioVisualizerProgress, refreshState)
          : () => {};
        $window.document.addEventListener(
          'visibilitychange',
          onVisibilityChange
        );

        resizeCanvas();
        refreshState();

        scope.$on('$destroy', () => {
          isDisposed = true;
          stopAnimation();
          if (resizeObserver) {
            resizeObserver.disconnect();
          } else {
            $window.removeEventListener('resize', resizeCanvas);
          }
          if (motionQuery) {
            if (motionQuery.removeEventListener) {
              motionQuery.removeEventListener('change', onMotionChange);
            } else if (motionQuery.removeListener) {
              motionQuery.removeListener(onMotionChange);
            }
          }
          $window.document.removeEventListener(
            'visibilitychange',
            onVisibilityChange
          );
          removePlayingWatch();
          removeTrackWatch();
          removeStageWatch();
          removeProgressWatch();
          if (canvas.parentNode === host) {
            host.removeChild(canvas);
          }
        });
      },
    }),
  ]);
})();

(function registerAlbumArtParallax() {
  const clampPointer = (value) => Math.max(0, Math.min(1, value));

  angular.module('listenone').directive('albumArtParallax', [
    '$window',
    ($window) => ({
      restrict: 'A',
      link: (scope, element) => {
        const host = element[0];
        const motionQuery = $window.matchMedia
          ? $window.matchMedia('(prefers-reduced-motion: reduce)')
          : null;
        let frame = null;

        const resetTilt = () => {
          host.classList.remove('is-tilting');
          host.style.setProperty('--cover-tilt-x', '0deg');
          host.style.setProperty('--cover-tilt-y', '0deg');
          host.style.setProperty('--cover-shine-x', '50%');
          host.style.setProperty('--cover-shine-y', '50%');
        };

        const applyPointerPosition = (event) => {
          if (motionQuery && motionQuery.matches) {
            return;
          }
          const rect = host.getBoundingClientRect();
          if (!rect.width || !rect.height) {
            return;
          }
          const x = clampPointer((event.clientX - rect.left) / rect.width);
          const y = clampPointer((event.clientY - rect.top) / rect.height);
          if (frame !== null) {
            $window.cancelAnimationFrame(frame);
          }
          frame = $window.requestAnimationFrame(() => {
            frame = null;
            host.classList.add('is-tilting');
            host.style.setProperty(
              '--cover-tilt-x',
              `${((0.5 - y) * 5).toFixed(2)}deg`
            );
            host.style.setProperty(
              '--cover-tilt-y',
              `${((x - 0.5) * 5).toFixed(2)}deg`
            );
            host.style.setProperty(
              '--cover-shine-x',
              `${(x * 100).toFixed(1)}%`
            );
            host.style.setProperty(
              '--cover-shine-y',
              `${(y * 100).toFixed(1)}%`
            );
          });
        };

        const onMotionChange = (event) => {
          if (event.matches) {
            resetTilt();
          }
        };

        host.addEventListener('pointermove', applyPointerPosition);
        host.addEventListener('pointerleave', resetTilt);
        if (motionQuery) {
          if (motionQuery.addEventListener) {
            motionQuery.addEventListener('change', onMotionChange);
          } else if (motionQuery.addListener) {
            motionQuery.addListener(onMotionChange);
          }
        }
        resetTilt();

        scope.$on('$destroy', () => {
          if (frame !== null) {
            $window.cancelAnimationFrame(frame);
          }
          host.removeEventListener('pointermove', applyPointerPosition);
          host.removeEventListener('pointerleave', resetTilt);
          if (motionQuery) {
            if (motionQuery.removeEventListener) {
              motionQuery.removeEventListener('change', onMotionChange);
            } else if (motionQuery.removeListener) {
              motionQuery.removeListener(onMotionChange);
            }
          }
        });
      },
    }),
  ]);
})();
