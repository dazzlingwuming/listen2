import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockRow = jest.fn((_props: unknown) => null);
const mockLocal = {
  id: '11111111-1111-4111-8111-111111111111', source: 'local', title: 'private fixture title',
  artist: 'fixture', accessStatus: 'available', seekable: true,
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { title: '本地音乐', sourceId: 'local', libraryCollection: 'local' } }),
}));
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector({ library: {
    favorites: [], recentTracks: [], playlists: [], localTracks: [mockLocal], revision: 1,
  } }),
}));
jest.mock('../../store/playerSlice', () => ({
  playTracks: (tracks: unknown[], index: number) => ({ type: 'test/playTracks', tracks, index }),
}));
jest.mock('../../api/client', () => ({ PROVIDER_CAPABILITIES: {}, providerClient: {} }));
jest.mock('../../library/libraryClient', () => ({ libraryClient: {} }));
jest.mock('../../library/remoteCollectionCoordinator', () => ({ persistRemoteCollectionRefresh: jest.fn() }));
jest.mock('../../localAudio/picker', () => ({ removeLocalAudio: jest.fn() }));
jest.mock('../../components/TrackRow', () => ({ TrackRow: (props: unknown) => mockRow(props) }));
jest.mock('../../components/Sheet', () => ({ Sheet: () => null }));
jest.mock('../../components/SourceTabs', () => ({ providerLabels: { local: '本地音乐' } }));
jest.mock('../ScreenLayout', () => ({
  ScreenLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>, sectionStyles: {},
}));
const { PlaylistDetailScreen } = require('../PlaylistDetailScreen');

function latestRow(): any {
  return mockRow.mock.calls[mockRow.mock.calls.length - 1][0];
}

describe('playlist playback acknowledgement and navigation', () => {
  let tree: renderer.ReactTestRenderer;
  let stages: jest.SpyInstance;
  beforeEach(async () => {
    jest.clearAllMocks();
    stages = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    await act(async () => { tree = renderer.create(<PlaylistDetailScreen />); });
  });
  afterEach(async () => {
    await act(async () => { tree.unmount(); });
    stages.mockRestore();
  });

  it('keeps preparation visible, blocks duplicate presses and navigates only after true acknowledgement', async () => {
    let resolve!: (result: boolean) => void;
    mockDispatch.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
    const press = latestRow().onPlay;
    await act(async () => { press(); press(); });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(latestRow().onPlay).toBeUndefined();
    expect(latestRow().onPress).toBeUndefined();
    expect(latestRow().action.explanation).toBe('正在准备播放…');
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => { resolve(true); });
    expect(mockNavigate).toHaveBeenCalledWith('Player');
    expect(stages.mock.calls).toEqual([
      ['[Listen2Local] detail-dispatch-start'],
      ['[Listen2Local] detail-dispatch-true'],
      ['[Listen2Local] detail-navigate-ack'],
    ]);
    expect(latestRow().onPlay).toEqual(expect.any(Function));
  });

  it.each([false, undefined])('does not navigate on a non-true result %s', async result => {
    mockDispatch.mockResolvedValue(result);
    await act(async () => { latestRow().onPlay(); });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(stages.mock.calls).toEqual([
      ['[Listen2Local] detail-dispatch-start'], ['[Listen2Local] detail-dispatch-false'],
    ]);
  });

  it('classifies rejection without logging the error or overwriting controller state', async () => {
    mockDispatch.mockRejectedValue(new Error('content://private-document/secret'));
    await act(async () => { latestRow().onPlay(); });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(stages.mock.calls).toEqual([
      ['[Listen2Local] detail-dispatch-start'], ['[Listen2Local] detail-dispatch-caught'],
    ]);
    expect(latestRow().onPlay).toEqual(expect.any(Function));
  });
});
