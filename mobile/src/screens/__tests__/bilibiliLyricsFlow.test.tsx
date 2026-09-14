import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockGetLyric = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheClear = jest.fn();
const mockCachePut = jest.fn();
let mockPlayerState: any;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('react-redux', () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ player: mockPlayerState, library: { favorites: [] } }),
}));
jest.mock('../../api/client', () => ({
  providerClient: { getLyric: (...args: unknown[]) => mockGetLyric(...args) },
}));
jest.mock('../../lyrics/cache', () => ({
  bilibiliLyricCache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    put: (...args: unknown[]) => mockCachePut(...args),
    clear: (...args: unknown[]) => mockCacheClear(...args),
  },
}));
jest.mock('../../deepseek/client', () => ({
  deepSeekClient: { cancel: jest.fn(), translate: jest.fn() },
  hashLyric: () => 'a'.repeat(64),
  hashTrack: () => 'b'.repeat(64),
}));
jest.mock('../../store/playerSlice', () => ({ togglePlayback: jest.fn() }));
jest.mock('../../store/librarySlice', () => ({ toggleFavorite: jest.fn() }));
jest.mock('../../types/music', () => ({ isLocalTrack: () => false }));
jest.mock('../../components/TrackRow', () => ({
  artwork: () => undefined,
  formatDuration: () => '0:00',
  trackArtist: (track: any) => track.artist,
  trackSource: (track: any) => track.source,
  trackTitle: (track: any) => track.title,
}));
jest.mock('../../components/SourceTabs', () => ({
  providerLabels: { bilibili: 'Bilibili' },
}));
jest.mock('../../components/Sheet', () => ({
  Sheet: ({
    children,
    visible,
  }: {
    children: React.ReactNode;
    visible: boolean;
  }) => (visible ? <>{children}</> : null),
}));

const { PlayerScreen } = require('../PlayerScreen');

describe('Bilibili lyric player flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayerState = {
      currentTrack: {
        id: 'bitrack_v_BV1xx411c7mD-12',
        source: 'bilibili',
        title: 'Song',
        artist: 'Artist',
        durationMs: 120_000,
      },
      position: 0,
    };
    mockCacheGet.mockResolvedValue(null);
    mockCacheClear.mockResolvedValue({ status: 'ok' });
    mockGetLyric.mockRejectedValue(new Error('LYRIC_UNAVAILABLE'));
  });

  it('keeps playback independent and offers exact-part restore after an auto miss', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockGetLyric).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bitrack_v_BV1xx411c7mD-12' }),
      expect.any(Object),
    );
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '恢复自动歌词' })
        .props.onPress();
      await Promise.resolve();
    });
    expect(mockCacheClear).toHaveBeenCalledWith('bitrack_v_BV1xx411c7mD-12');
  });
});
