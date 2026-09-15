import {
  playerTranslationRevision,
  shouldApplyPlayerTranslation,
} from '../PlayerScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('../../store/playerSlice', () => ({}));
jest.mock('../../store/librarySlice', () => ({}));
jest.mock('../../api/client', () => ({
  PROVIDER_CAPABILITIES: {},
  providerClient: {},
}));
jest.mock('../../library/libraryClient', () => ({}));
jest.mock('../../lyrics/cache', () => ({}));
jest.mock('../../lyrics/selectionStore', () => ({}));
jest.mock('../../bilibili/lyrics', () => ({}));
jest.mock('../../bilibili/mvClient', () => ({ bilibiliMvClient: {} }));
jest.mock('../../components/TrackRow', () => ({
  artwork: () => undefined,
  formatDuration: () => '0:00',
  trackArtist: (track: { artist: string }) => track.artist,
  trackSource: (track: { source: string }) => track.source,
  trackTitle: (track: { title: string }) => track.title,
}));
jest.mock('../../components/SourceTabs', () => ({ providerLabels: {} }));
jest.mock('../../components/Sheet', () => ({ Sheet: () => null }));
jest.mock('../../components/BilibiliLyricPicker', () => ({
  BilibiliLyricPicker: () => null,
}));
jest.mock('../../components/DeepSeekConsentSheet', () => ({
  DeepSeekConsentSheet: () => null,
}));
jest.mock('../../types/music', () => ({ isLocalTrack: () => false }));
jest.mock('../../deepseek/client', () => ({
  deepSeekClient: { cancel: jest.fn() },
  hashLyric: (value: string) => (value.includes('first') ? 'a'.repeat(64) : 'b'.repeat(64)),
  hashTrack: () => 'c'.repeat(64),
}));

describe('DeepSeek revision lifecycle', () => {
  it('derives different safe revisions for different lyric documents', () => {
    const first = playerTranslationRevision('[00:01.00] first');
    const second = playerTranslationRevision('[00:01.00] second');
    expect(Number.isSafeInteger(first)).toBe(true);
    expect(Number.isSafeInteger(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it('rejects a late result from an older revision even when its track hash matches', () => {
    expect(
      shouldApplyPlayerTranslation(4, 4, 'track-hash', 'track-hash', 12, 11),
    ).toBe(false);
    expect(
      shouldApplyPlayerTranslation(4, 4, 'track-hash', 'track-hash', 12, 12),
    ).toBe(true);
    expect(
      shouldApplyPlayerTranslation(3, 4, 'track-hash', 'track-hash', 12, 12),
    ).toBe(false);
  });
});
