jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'ios', Version: 0 },
  PermissionsAndroid: { request: jest.fn(), PERMISSIONS: { POST_NOTIFICATIONS: 'post' } },
}));
jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: { setRepeatMode: jest.fn(), setVolume: jest.fn() },
  Capability: {}, RepeatMode: { Track: 'track', Off: 'off' }, State: { Playing: 'playing' },
}));
jest.mock('../../offline/offlineAudio', () => ({
  isOfflineDownloadEligible: () => false,
  offlineAudio: { resolveVerified: jest.fn() },
}));
jest.mock('../../audioFx/client', () => ({
  audioEffectsClient: { setFixedNormalizationGain: jest.fn().mockResolvedValue(undefined) },
}));

import {
  normalizationOutputGain,
  scheduleFixedNormalizationGain,
} from '../playerController';
import { audioEffectsClient } from '../../audioFx/client';

describe('loudness playback integration', () => {
  it('does not await analysis/effect work before transport and sends unity for missing metrics', () => {
    scheduleFixedNormalizationGain(undefined);
    expect(audioEffectsClient.setFixedNormalizationGain).toHaveBeenCalledWith(1);
  });

  it('clamps a completed matching gain independently of app volume', () => {
    scheduleFixedNormalizationGain(1.5);
    expect(audioEffectsClient.setFixedNormalizationGain).toHaveBeenLastCalledWith(1.5);
  });

  it('routes attenuation through the output stage while preserving native boost support', () => {
    expect(normalizationOutputGain(0.5)).toBe(0.5);
    expect(normalizationOutputGain(1.5)).toBe(1);
    expect(normalizationOutputGain(undefined)).toBe(1);
  });
});
