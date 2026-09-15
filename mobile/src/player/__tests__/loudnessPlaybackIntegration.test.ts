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
jest.mock('../../audiofx/audioEffectsClient', () => ({
  audioEffectsClient: { setFixedNormalizationGain: jest.fn().mockResolvedValue(undefined) },
}));

import { scheduleFixedNormalizationGain } from '../playerController';
import { audioEffectsClient } from '../../audiofx/audioEffectsClient';

describe('loudness playback integration', () => {
  it('does not await analysis/effect work before transport and sends unity for missing metrics', () => {
    scheduleFixedNormalizationGain(undefined);
    expect(audioEffectsClient.setFixedNormalizationGain).toHaveBeenCalledWith(1);
  });

  it('clamps a completed matching gain independently of app volume', () => {
    scheduleFixedNormalizationGain(1.5);
    expect(audioEffectsClient.setFixedNormalizationGain).toHaveBeenLastCalledWith(1);
  });
});
