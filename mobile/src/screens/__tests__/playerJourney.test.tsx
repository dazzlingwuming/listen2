import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockDispatch = jest.fn();
let mockPlayerState: any;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ player: mockPlayerState, library: { favorites: [] } }),
}));
jest.mock('../../api/client', () => ({
  providerClient: { getLyric: jest.fn() },
}));
jest.mock('../../bilibili/lyrics', () => ({
  findBilibiliLyricCandidates: jest.fn(),
}));
jest.mock('../../bilibili/mvClient', () => ({
  bilibiliMvClient: { syncActive: jest.fn() },
}));
jest.mock('../../lyrics/cache', () => ({
  bilibiliLyricCache: { get: jest.fn(), put: jest.fn(), clear: jest.fn() },
}));
jest.mock('../../deepseek/client', () => ({
  deepSeekClient: { cancel: jest.fn(), translate: jest.fn() },
  hashLyric: () => 'a'.repeat(64),
  hashTrack: () => 'b'.repeat(64),
}));
jest.mock('../../store/playerSlice', () => ({
  clearPlayNextQueue: () => ({ type: 'player/clearPlayNextQueue' }),
  movePlayNextTrack: (occurrenceId: string, direction: number) => ({
    type: 'player/moveQueuedNext',
    payload: { occurrenceId, direction },
  }),
  playQueuedTrack: (occurrenceId: string) => ({
    type: 'player/playQueuedTrack',
    payload: occurrenceId,
  }),
  removePlayNextTrack: (occurrenceId: string) => ({
    type: 'player/removeQueuedNext',
    payload: occurrenceId,
  }),
  togglePlayback: () => ({ type: 'player/togglePlayback' }),
}));
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
  providerLabels: { netease: '网易云音乐' },
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

describe('PlayerScreen play-next queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const track = {
      id: 'ne_1',
      source: 'netease',
      title: '同一首歌',
      artist: 'Listen2',
    };
    mockPlayerState = {
      currentTrack: track,
      isPlaying: false,
      position: 0,
      playNextQueue: [
        { ...track, occurrenceId: 'play-next-a', track },
        { ...track, occurrenceId: 'play-next-b', track },
      ],
    };
  });

  it('addresses duplicate queue rows through occurrence-specific accessible actions', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '打开播放队列，共2首' })
        .props.onPress();
    });

    expect(
      tree.root.findByProps({
        accessibilityLabel: '播放队列第2首，同一首歌，重复第2项',
      }),
    ).toBeTruthy();
    const actionable = (label: string, occurrence: number) =>
      tree.root
        .findAllByProps({ accessibilityLabel: label })
        .filter(item => typeof item.props.onPress === 'function')[occurrence];
    await act(async () => {
      actionable('下移同一首歌', 1).props.onPress();
      actionable('移除同一首歌', 1).props.onPress();
      tree.root
        .findByProps({ accessibilityLabel: '清空待播队列' })
        .props.onPress();
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '确认清空待播队列' })
        .props.onPress();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'player/moveQueuedNext',
        payload: { occurrenceId: 'play-next-b', direction: 1 },
      }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'player/clearPlayNextQueue',
      }),
    );
  });
});
