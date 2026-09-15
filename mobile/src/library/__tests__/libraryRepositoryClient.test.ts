const mockGetSnapshot = jest.fn();
const mockApplyMutation = jest.fn();
const mockGetMigrationStatus = jest.fn();

let libraryClient: typeof import('../libraryClient').libraryClient;
let projectLibrarySnapshot: typeof import('../libraryProjection').projectLibrarySnapshot;

describe('library repository client', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      NativeModules: {
        Listen2Library: {
          getSnapshot: mockGetSnapshot,
          applyMutation: mockApplyMutation,
          getMigrationStatus: mockGetMigrationStatus,
        },
      },
    }));
    ({ libraryClient } = require('../libraryClient'));
    ({ projectLibrarySnapshot } = require('../libraryProjection'));
    jest.clearAllMocks();
  });

  it('accepts only an ordered, semantic native snapshot', async () => {
    mockGetSnapshot.mockResolvedValue({
      schemaVersion: 1,
      revision: 4,
      personalPlaylists: [
        { playlistId: 'p-2', title: 'Later', position: 1, tracks: [] },
        { playlistId: 'p-1', title: 'First', position: 0, tracks: [] },
      ],
      favorites: [],
      localRecords: [],
      remoteCollections: [],
      queueCheckpoint: [],
      lyricMetadata: [],
    });

    await expect(libraryClient.getSnapshot()).resolves.toEqual({
      schemaVersion: 1,
      revision: 4,
      personalPlaylists: [
        { playlistId: 'p-1', title: 'First', position: 0, tracks: [] },
        { playlistId: 'p-2', title: 'Later', position: 1, tracks: [] },
      ],
      favorites: [],
      localRecords: [],
      remoteCollections: [],
      queueCheckpoint: [],
      lyricMetadata: [],
    });
    expect(projectLibrarySnapshot(await libraryClient.getSnapshot()).playlists).toEqual([
      { id: 'p-1', title: 'First', tracks: [] },
      { id: 'p-2', title: 'Later', tracks: [] },
    ]);
  });

  it('rejects raw transport fields and reloads once after a stale receipt', async () => {
    mockGetSnapshot
      .mockResolvedValueOnce({
        schemaVersion: 1,
        revision: 7,
        personalPlaylists: [], favorites: [], localRecords: [],
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        revision: 8,
        personalPlaylists: [], favorites: [], localRecords: [],
      });
    mockApplyMutation.mockResolvedValue({
      requestId: 'request-1',
      status: 'stale',
      revision: 8,
      errorCode: 'STALE_REVISION',
    });

    await expect(
      libraryClient.applyMutation({
        requestId: 'request-1',
        revision: 7,
        kind: 'createPlaylist',
        payload: { playlistId: 'p-1', title: 'One' },
      }),
    ).resolves.toMatchObject({ status: 'stale-revision', revision: 8 });
    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);

    await expect(
      libraryClient.applyMutation({
        requestId: 'request-2',
        revision: 8,
        kind: 'createPlaylist',
        payload: { playlistId: 'p-2', title: 'Two', mediaUrl: 'https://bad' },
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
