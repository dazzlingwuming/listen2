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
      playlists: JSON.stringify([{ title: 'Road trip', tracks: [{ url: 'https://private' }] }]),
      localTracks: JSON.stringify([{ title: 'Private', artist: 'Me', contentUri: 'content://private' }]),
      player: JSON.stringify({ playlist: [{ id: 'local', source: 'local', title: 'Private', artist: 'Me', contentUri: 'content://private', fileName: 'p.mp3' }], isPlaying: true }),
    }), 'attempt_1');
    expect(exported).toMatchObject({
      attemptId: 'attempt_1', playlists: [{ title: 'Road trip' }], localEntries: [{ title: 'Private', artist: 'Me' }],
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
    mockBeginLegacyMigration.mockResolvedValue({ backend: 'Room', phase: 'failed', sourceRetained: true, laterStartValidated: false, attemptId: 'attempt_3', checksum: 'fnv1a-14cc059f' });
    await expect(migrateKnownLegacyLibrary('attempt_3')).resolves.toMatchObject({ status: 'retryable' });
    await expect(migrateKnownLegacyLibrary('attempt_4')).resolves.toMatchObject({ status: 'unconfirmed' });
    expect(mockGetItem).toHaveBeenCalledTimes(3);
  });
});
