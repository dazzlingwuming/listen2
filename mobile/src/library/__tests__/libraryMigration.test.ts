const mockGetItem = jest.fn();
const mockBeginLegacyMigration = jest.fn();

jest.mock('react-native-track-player', () => ({
  __esModule: true, default: {}, Capability: {}, RepeatMode: {}, State: {},
}));

let exportLegacyMigration: typeof import('../legacyMigration').exportLegacyMigration;
let migrateKnownLegacyLibrary: typeof import('../legacyMigration').migrateKnownLegacyLibrary;

describe('legacy library migration', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@react-native-async-storage/async-storage', () => ({ getItem: mockGetItem }));
    jest.doMock('react-native', () => ({
      NativeModules: {
        Listen2Library: {
          getSnapshot: jest.fn(), applyMutation: jest.fn(), getMigrationStatus: jest.fn(), beginLegacyMigration: mockBeginLegacyMigration,
        },
      },
    }));
    ({ exportLegacyMigration, migrateKnownLegacyLibrary } = require('../legacyMigration'));
    jest.clearAllMocks();
  });

  it('exports only bounded display metadata and an URL-free paused checkpoint', () => {
    const exported = exportLegacyMigration(JSON.stringify({
      playlists: JSON.stringify([{ id: 'road', title: 'Road trip', tracks: [{ source: 'netease', id: '42', title: 'Song', artist: 'Artist', url: 'https://private' }] }]),
      favorites: JSON.stringify([{ source: 'netease', id: '42', title: 'Song', artist: 'Artist', url: 'https://private' }]),
      queueCheckpoint: JSON.stringify([{ occurrenceId: 'q1', source: 'netease', id: '42', title: 'Song', artist: 'Artist' }]),
      lyricMetadata: JSON.stringify([{ source: 'netease', id: '42', offsetMillis: 120, selectedVariantId: 'main' }]),
      localTracks: JSON.stringify([{ title: 'Private', artist: 'Me', contentUri: 'content://private' }]),
      player: JSON.stringify({ playlist: [{ id: 'local', source: 'local', title: 'Private', artist: 'Me', contentUri: 'content://private', fileName: 'p.mp3' }], isPlaying: true }),
    }), 'attempt_1');
    expect(exported).toMatchObject({
      attemptId: 'attempt_1', playlists: [{ playlistId: 'road', title: 'Road trip', position: 0, tracks: [{ source: 'netease', trackId: '42', title: 'Song', artist: 'Artist' }] }],
      favorites: [{ source: 'netease', trackId: '42', title: 'Song', artist: 'Artist' }], queueCheckpoint: [{ occurrenceId: 'q1', position: 0, source: 'netease', trackId: '42' }], lyricMetadata: [{ source: 'netease', trackId: '42', offsetMillis: 120, selectedVariantId: 'main' }], localEntries: [{ title: 'Private', artist: 'Me' }],
    });
    expect(exported?.pausedPlayer).toMatchObject({ playlist: [], isPlaying: false });
    expect(JSON.stringify(exported)).not.toContain('content://');
    expect(JSON.stringify(exported)).not.toContain('https://private');
  });

  it('retains corrupted or rejected source for a later retry', async () => {
    mockGetItem.mockResolvedValueOnce('{broken');
    await expect(migrateKnownLegacyLibrary('attempt_2')).resolves.toEqual({ status: 'invalid-legacy' });

    const stored = JSON.stringify({ playlists: JSON.stringify([{ title: 'Retry' }]), localTracks: '[]' });
    mockGetItem.mockResolvedValue(stored);
    mockBeginLegacyMigration.mockResolvedValue({ backend: 'Room', phase: 'failed', sourceRetained: true, laterStartValidated: false, attemptId: 'attempt_3', checksum: exportLegacyMigration(stored, 'attempt_3')?.checksum });
    await expect(migrateKnownLegacyLibrary('attempt_3')).resolves.toMatchObject({ status: 'retryable' });
    await expect(migrateKnownLegacyLibrary('attempt_4')).resolves.toMatchObject({ status: 'unconfirmed' });
    expect(mockGetItem).toHaveBeenCalledTimes(3);
  });
});
