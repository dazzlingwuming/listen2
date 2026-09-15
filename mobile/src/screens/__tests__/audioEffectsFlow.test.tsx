import {
  audioEffectsLabel,
  parseAudioAnalysisFrame,
  parseAudioEffectsSnapshot,
} from '../../audioFx/client';

describe('audio effects presentation', () => {
  it('labels an unavailable session honestly instead of inventing visualizer data', () => {
    expect(audioEffectsLabel(parseAudioEffectsSnapshot({}))).toContain('不可用');
  });

  it('bounds native gain and keeps neutral as the safe fallback', () => {
    expect(parseAudioEffectsSnapshot({ status: 'enabled', preset: 'bass', fixedGain: 4 })).toEqual({
      status: 'enabled', preset: 'bass', fixedGain: 4,
    });
  });

  it('accepts only bounded current-generation analyzer frames', () => {
    expect(parseAudioAnalysisFrame({ bins: [0, 0.5, 1], timestampMs: 2, generation: 4 })).toEqual({
      bins: [0, 0.5, 1], timestampMs: 2, generation: 4,
    });
    expect(parseAudioAnalysisFrame({ bins: Array(33).fill(0), timestampMs: 2, generation: 4 })).toBeNull();
  });
});
