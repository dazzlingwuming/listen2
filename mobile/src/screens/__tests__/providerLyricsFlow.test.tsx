import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockGetLyric = jest.fn();
const mockDispatch = jest.fn();
let mockPlayerState: any;
let mockLibraryState: any;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ player: mockPlayerState, library: mockLibraryState }),
}));
jest.mock('../../api/client', () => ({
  providerClient: { getLyric: (...args: unknown[]) => mockGetLyric(...args) },
  PROVIDER_CAPABILITIES: {
    kugou: { operations: { lyrics: { status: 'available' } } },
    kuwo: { operations: { lyrics: { status: 'available' } } },
  },
}));
jest.mock('../../bilibili/lyrics', () => ({
  findBilibiliLyricCandidates: jest.fn(),
}));
jest.mock('../../bilibili/mvClient', () => ({ bilibiliMvClient: { syncActive: jest.fn() } }));
jest.mock('../../lyrics/cache', () => ({
  bilibiliLyricCache: { get: jest.fn(), put: jest.fn(), clear: jest.fn() },
}));
jest.mock('../../lyrics/selectionStore', () => ({
  lyricSelectionStore: {
    get: jest.fn().mockResolvedValue(null),
    put: jest.fn(),
    clearManual: jest.fn(),
    setOffset: jest.fn(),
  },
}));
jest.mock('../../deepseek/client', () => ({
  deepSeekClient: { cancel: jest.fn(), translate: jest.fn() },
  hashLyric: () => 'a'.repeat(64),
  hashTrack: () => 'b'.repeat(64),
  translationLinesToLrc: jest.fn(),
}));
jest.mock('../../store/playerSlice', () => ({ togglePlayback: jest.fn() }));
jest.mock('../../store/librarySlice', () => ({
  toggleFavorite: jest.fn(),
  continuityLyricMetadataObserved: jest.fn(() => ({
    type: 'library/continuityLyricMetadataObserved',
  })),
  continuityLyricMetadataRemoved: jest.fn(() => ({
    type: 'library/continuityLyricMetadataRemoved',
  })),
}));
jest.mock('../../types/music', () => ({ isLocalTrack: () => false }));
jest.mock('../../components/TrackRow', () => ({
  artwork: () => undefined,
  formatDuration: () => '0:00',
  trackArtist: (track: any) => track.artist,
  trackSource: (track: any) => track.source,
  trackTitle: (track: any) => track.title,
}));
jest.mock('../../components/SourceTabs', () => ({
  providerLabels: { kugou: '酷狗', kuwo: '酷我' },
}));
jest.mock('../../components/Sheet', () => ({
  Sheet: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <>{children}</> : null,
}));
jest.mock('../../audioFx/client', () => ({
  audioEffectsClient: {
    status: jest.fn().mockResolvedValue({ status: 'unavailable', preset: 'neutral', fixedGain: 1 }),
    selectPreset: jest.fn(),
    setVisualizationEnabled: jest.fn(),
  },
  audioEffectsLabel: () => '音效不可用',
  subscribeAudioAnalysis: () => ({ remove: jest.fn() }),
}));

const { PlayerScreen } = require('../PlayerScreen');

function track(source: 'kugou' | 'kuwo', id: string) {
  return {
    id,
    source,
    title: `${source} song`,
    artist: 'Artist',
    ...(source === 'kugou' ? { providerAlbumId: '12' } : {}),
  };
}

describe('Kugou and Kuwo lyric player flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLyric.mockReset();
    mockPlayerState = {
      currentTrack: track('kugou', 'kgtrack_AABBCCDDEEFF0011'),
      position: 0,
    };
    mockLibraryState = { favorites: [], lyricMetadata: [], revision: 0 };
  });

  it.each([
    [
      'Kugou to Kuwo',
      track('kugou', 'kgtrack_AABBCCDDEEFF0011'),
      track('kuwo', 'kwtrack_12'),
    ],
    [
      'Kuwo to Kugou',
      track('kuwo', 'kwtrack_12'),
      track('kugou', 'kgtrack_AABBCCDDEEFF0011'),
    ],
  ])(
    'cancels the old request and ignores its late result after a %s switch',
    async (_label, previousTrack, currentTrack) => {
      let resolvePrevious!: (value: unknown) => void;
      let resolveCurrent!: (value: unknown) => void;
      mockGetLyric
        .mockImplementationOnce(
          () => new Promise(resolve => { resolvePrevious = resolve; }),
        )
        .mockImplementationOnce(
          () => new Promise(resolve => { resolveCurrent = resolve; }),
        );

      mockPlayerState = { ...mockPlayerState, currentTrack: previousTrack };
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(<PlayerScreen />);
      });
      await act(async () => {
        tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
      });
      expect(mockGetLyric.mock.calls[0][0]).toMatchObject({ id: previousTrack.id, source: previousTrack.source });

      mockPlayerState = { ...mockPlayerState, currentTrack };
      await act(async () => {
        tree.update(<PlayerScreen />);
      });
      expect(mockGetLyric.mock.calls[0][1].signal.aborted).toBe(true);

      await act(async () => {
        tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
      });
      expect(mockGetLyric.mock.calls[1][0]).toMatchObject({ id: currentTrack.id, source: currentTrack.source });

      await act(async () => {
        resolvePrevious({
          trackId: previousTrack.id,
          source: previousTrack.source,
          text: '[00:01.00]stale previous lyric',
        });
        await Promise.resolve();
      });
      expect(JSON.stringify(tree.toJSON())).not.toContain(
        'stale previous lyric',
      );

      await act(async () => {
        resolveCurrent({
          trackId: currentTrack.id,
          source: currentTrack.source,
          text: '[00:02.00]current lyric',
        });
        await Promise.resolve();
      });
      expect(JSON.stringify(tree.toJSON())).toContain('current lyric');
      await act(async () => tree.unmount());
    },
  );
});
