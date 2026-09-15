import {
  audioEffectsLabel,
  parseAudioEffectsSnapshot,
} from '../../audioFx/client';

describe('audio effects presentation', () => {
  it('labels an unavailable session honestly instead of inventing visualizer data', () => {
    expect(audioEffectsLabel(parseAudioEffectsSnapshot({}))).toContain('不可用');
  });

  it('bounds native gain and keeps neutral as the safe fallback', () => {
    expect(parseAudioEffectsSnapshot({ status: 'enabled', preset: 'bass', fixedGain: 4 })).toEqual({
      status: 'enabled', preset: 'bass', fixedGain: 1,
    });
  });
});
