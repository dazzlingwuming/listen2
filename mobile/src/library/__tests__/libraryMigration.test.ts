const mockGetItem = jest.fn();
const mockRemoveItem = jest.fn();
const mockBeginLegacyMigration = jest.fn();

jest.mock('react-native-track-player', () => ({
  __esModule: true, default: {}, Capability: {}, RepeatMode: {}, State: {},
}));

let exportLegacyMigration: typeof import('../legacyMigration').exportLegacyMigration;
let LEGACY_LIBRARY_KEY: typeof import('../legacyMigration').LEGACY_LIBRARY_KEY;
let LEGACY_PLAYER_KEY: typeof import('../legacyMigration').LEGACY_PLAYER_KEY;
let migrateKnownLegacyLibrary: typeof import('../legacyMigration').migrateKnownLegacyLibrary;

describe('legacy library migration', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@react-native-async-storage/async-storage', () => ({ getItem: mockGetItem, removeItem: mockRemoveItem }));
    jest.doMock('react-native', () => ({
      NativeModules: {
        Listen2Library: {
          getSnapshot: jest.fn(), applyMutation: jest.fn(), getMigrationStatus: jest.fn(), beginLegacyMigration: mockBeginLegacyMigration,
        },
      },
    }));
    ({ exportLegacyMigration, migrateKnownLegacyLibrary, LEGACY_LIBRARY_KEY, LEGACY_PLAYER_KEY } = require('../legacyMigration'));
    mockGetItem.mockReset();
    mockRemoveItem.mockReset();
    mockBeginLegacyMigration.mockReset();
  });

  it('exports only bounded display metadata and an URL-free paused checkpoint', () => {
    expect(LEGACY_LIBRARY_KEY).toBe('persist:listen2-mobile-library');
    expect(LEGACY_PLAYER_KEY).toBe('persist:listen2-mobile');
    const legacyLibrary = JSON.stringify({
      playlists: JSON.stringify([{ id: 'road', title: 'Road trip', tracks: [{ source: 'netease', id: '42', title: 'Song', artist: 'Artist', url: 'https://private' }] }]),
      favorites: JSON.stringify([{ source: 'netease', id: '42', title: 'Song', artist: 'Artist', url: 'https://private' }]),
      remoteCollections: JSON.stringify([{ id: 'charts', source: 'netease', title: '排行榜', syncState: 'ready' }]),
      localTracks: JSON.stringify([{ title: 'Private', artist: 'Me', contentUri: 'content://private' }]),
    });
    const legacyPlayer = JSON.stringify({
      playNextQueue: JSON.stringify([{ occurrenceId: 'q1', source: 'netease', id: '42', title: 'Song', artist: 'Artist' }]),
      lyricMetadata: JSON.stringify([{ source: 'netease', id: '42', offsetMillis: 120, selectedVariantId: 'main' }]),
      playlist: JSON.stringify([{ id: 'local', source: 'local', title: 'Private', artist: 'Me', contentUri: 'content://private', fileName: 'p.mp3' }]),
      isPlaying: 'true',
    });
    const exported = exportLegacyMigration(legacyLibrary, 'attempt_1', legacyPlayer);
    expect(exported).toMatchObject({
      attemptId: 'attempt_1', playlists: [{ playlistId: 'road', title: 'Road trip', position: 0, tracks: [{ source: 'netease', trackId: '42', title: 'Song', artist: 'Artist' }] }],
      favorites: [{ source: 'netease', trackId: '42', title: 'Song', artist: 'Artist' }],
      remoteCollections: [{ collectionId: 'charts', source: 'netease', title: '排行榜', syncState: 'ready' }],
      queueCheckpoint: [{ occurrenceId: 'q1', position: 0, source: 'netease', trackId: '42' }],
      lyricMetadata: [{ source: 'netease', trackId: '42', offsetMillis: 120, selectedVariantId: 'main' }],
      localEntries: [{ title: 'Private', artist: 'Me' }],
    });
    expect(exported?.pausedPlayer).toMatchObject({ playNextQueue: [{ occurrenceId: 'q1' }], playlist: [], isPlaying: false });
    expect(JSON.stringify(exported)).not.toContain('content://');
    expect(JSON.stringify(exported)).not.toContain('https://private');

    const legacyWithoutLocalTracks = JSON.stringify({ playlists: '[]', favorites: '[]' });
    expect(exportLegacyMigration(legacyWithoutLocalTracks, 'old_payload')).toMatchObject({ localEntries: [] });
    expect(exportLegacyMigration(JSON.stringify({ playlists: '[]', favorites: '[]', localTracks: '{}' }), 'broken_local')).toBeNull();
  });

  it('skips isolated invalid, unsupported-provider, and local favorite rows', () => {
    const legacyLibrary = JSON.stringify({
      playlists: '[]',
      favorites: JSON.stringify([
        { source: 'netease', id: '42', title: 'Song', artist: 'Artist' },
        { source: 'netease', id: '42', title: 'Duplicate', artist: 'Other' },
        { source: 'local', id: 'local-1', title: 'Private', artist: 'Me' },
        { source: 'unsupported', id: 'provider-1', title: 'Unknown', artist: 'Provider' },
        { provider: 'netease', id: 'provider-only', title: 'Missing source', artist: 'Provider' },
        { source: 'netease', id: 'bad/id', title: 'Malformed', artist: 'Provider' },
        null,
      ]),
    });

    const exported = exportLegacyMigration(legacyLibrary, 'mixed_favorites');
    expect(exported?.favorites).toEqual([
      { source: 'netease', trackId: '42', title: 'Song', artist: 'Artist' },
    ]);
  });

  it('falls back to a safe empty player when the auxiliary player record is corrupted', () => {
    const legacyLibrary = JSON.stringify({
      playlists: '[]',
      favorites: JSON.stringify([{ source: 'netease', id: '42', title: 'Song', artist: 'Artist' }]),
      queueCheckpoint: JSON.stringify([{ occurrenceId: 'q1', source: 'netease', id: '42' }]),
      lyricMetadata: JSON.stringify([{ source: 'netease', id: '42', offsetMillis: 120 }]),
    });

    const exported = exportLegacyMigration(legacyLibrary, 'corrupt_player', '{broken');
    expect(exported).toMatchObject({
      favorites: [{ source: 'netease', trackId: '42' }],
      queueCheckpoint: [{ occurrenceId: 'q1', source: 'netease', trackId: '42' }],
      lyricMetadata: [{ source: 'netease', trackId: '42', offsetMillis: 120 }],
      pausedPlayer: { playlist: [], playNextQueue: [], history: [], isPlaying: false },
    });
  });

  it('retains corrupted or rejected source for a later retry', async () => {
    mockGetItem.mockResolvedValueOnce('{broken');
    await expect(migrateKnownLegacyLibrary('attempt_2')).resolves.toEqual({ status: 'invalid-legacy' });

    const stored = JSON.stringify({ playlists: JSON.stringify([{ title: 'Retry', tracks: [] }]), favorites: '[]', localTracks: '[]' });
    mockGetItem.mockImplementation(async (key: string) => key === LEGACY_LIBRARY_KEY ? stored : null);
    mockBeginLegacyMigration.mockResolvedValue({ backend: 'Room', phase: 'failed', sourceRetained: true, laterStartValidated: false, attemptId: 'attempt_3', checksum: exportLegacyMigration(stored, 'attempt_3')?.checksum });
    await expect(migrateKnownLegacyLibrary('attempt_3')).resolves.toMatchObject({ status: 'retryable' });
    await expect(migrateKnownLegacyLibrary('attempt_4')).resolves.toMatchObject({ status: 'unconfirmed' });
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(mockGetItem.mock.calls.map(call => call[0])).toEqual([
      LEGACY_LIBRARY_KEY,
      LEGACY_PLAYER_KEY,
      LEGACY_LIBRARY_KEY,
      LEGACY_PLAYER_KEY,
      LEGACY_LIBRARY_KEY,
      LEGACY_PLAYER_KEY,
    ]);
  });

  it('retains both legacy records before any later readback cleanup', async () => {
    const stored = JSON.stringify({ playlists: '[]', favorites: '[]' });
    mockGetItem.mockImplementation(async (key: string) => key === LEGACY_LIBRARY_KEY ? stored : '{broken');
    const exported = exportLegacyMigration(stored, 'attempt_5', '{broken');
    mockBeginLegacyMigration.mockResolvedValue({
      backend: 'Room',
      phase: 'complete',
      sourceRetained: true,
      laterStartValidated: false,
      attemptId: 'attempt_5',
      checksum: exported?.checksum,
    });

    await expect(migrateKnownLegacyLibrary('attempt_5')).resolves.toMatchObject({ status: 'migrated' });
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(mockGetItem).toHaveBeenNthCalledWith(1, LEGACY_LIBRARY_KEY);
    expect(mockGetItem).toHaveBeenNthCalledWith(2, LEGACY_PLAYER_KEY);
  });
});
