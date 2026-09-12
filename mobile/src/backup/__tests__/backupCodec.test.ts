import {
  BACKUP_FORMAT,
  BACKUP_LIMITS,
  BACKUP_VERSION,
  BackupValidationError,
  createBackup,
  parseBackup,
  planImport,
  previewBackup,
  stringifyBackup,
} from '../backupCodec';
import type { Track } from '../../types/music';

const track = (id: string, title = id): Track => ({
  id,
  source: 'netease',
  title,
  artist: 'Listen2',
  album: 'Test album',
  durationMs: 180000,
  artworkUrl: 'https://example.test/artwork.jpg',
});

const snapshot = {
  favorites: [track('ne_1')],
  playlists: [
    { id: 'myplaylist_road', title: 'Road trip', tracks: [track('ne_1')] },
  ],
  queue: [track('ne_2'), track('ne_2')],
  queueMode: 'play-next' as const,
};

describe('backupCodec', () => {
  it('round-trips a versioned metadata-only backup and reports bounded counts', () => {
    const json = stringifyBackup(
      snapshot,
      new Date('2026-09-12T06:00:00.000Z'),
    );
    const parsed = parseBackup(json);
    const preview = previewBackup(json);

    expect(parsed).toMatchObject({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-09-12T06:00:00.000Z',
      queueMode: 'play-next',
    });
    expect(parsed.queue.map(item => item.id)).toEqual(['ne_2', 'ne_2']);
    expect(preview).toMatchObject({
      favorites: 1,
      playlists: 1,
      playlistTracks: 1,
      queueTracks: 2,
      totalTracks: 4,
    });
  });

  it('strips non-contract metadata during export but rejects sensitive trees', () => {
    const sourceTrack = {
      ...track('ne_3'),
      providerPayload: { harmlessButPrivate: 'not exported' },
    } as Track & { providerPayload: unknown };
    const exported = createBackup({ ...snapshot, favorites: [sourceTrack] });
    expect(exported.favorites[0]).not.toHaveProperty('providerPayload');

    expect(() =>
      createBackup({
        ...snapshot,
        favorites: [
          { ...track('ne_4'), accessToken: 'should-not-leak' } as Track,
        ],
      }),
    ).toThrow(BackupValidationError);
  });

  it.each([
    ['prototype key', '{"__proto__":{},"format":"listen2-mobile-backup"}'],
    [
      'credential field',
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: '2026-09-12T06:00:00.000Z',
        favorites: [{ ...track('ne_5'), token: 'secret' }],
        playlists: [],
        queue: [],
      }),
    ],
    [
      'local path',
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: '2026-09-12T06:00:00.000Z',
        favorites: [{ ...track('ne_6'), artworkUrl: 'file:///sdcard/a.mp3' }],
        playlists: [],
        queue: [],
      }),
    ],
    [
      'prototype identifier',
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: '2026-09-12T06:00:00.000Z',
        favorites: [{ ...track('__proto__') }],
        playlists: [],
        queue: [],
      }),
    ],
  ])('rejects unsafe %s input before planning', (_name, raw) => {
    expect(() => parseBackup(raw)).toThrow(BackupValidationError);
  });

  it('rejects unsupported versions and bounded queue/list sizes', () => {
    expect(() =>
      parseBackup(
        JSON.stringify({
          ...createBackup(snapshot),
          version: BACKUP_VERSION + 1,
        }),
      ),
    ).toThrow(BackupValidationError);

    expect(() =>
      parseBackup(
        JSON.stringify({
          ...createBackup(snapshot),
          queue: Array.from({ length: BACKUP_LIMITS.maxQueueTracks + 1 }, () =>
            track('ne_queue'),
          ),
        }),
      ),
    ).toThrow(BackupValidationError);
  });

  it('plans a non-destructive merge with favorite de-duplication and a conflict ID', () => {
    const incoming = createBackup({
      favorites: [track('ne_1'), track('ne_3')],
      playlists: [
        {
          id: 'myplaylist_road',
          title: 'Road trip 2',
          tracks: [track('ne_3')],
        },
        { id: 'myplaylist_same', title: 'Same', tracks: [] },
      ],
      queue: [track('ne_4'), track('ne_4')],
      queueMode: 'playlist',
    });
    const plan = planImport(
      {
        favorites: [track('ne_1')],
        playlists: [
          {
            id: 'myplaylist_road',
            title: 'Road trip',
            tracks: [track('ne_1')],
          },
          { id: 'myplaylist_same', title: 'Same', tracks: [] },
        ],
        queue: [track('ne_2')],
        queueMode: 'playlist',
      },
      incoming,
    );

    expect(plan.mode).toBe('merge');
    expect(plan.summary).toMatchObject({
      addedFavorites: 1,
      addedPlaylists: 1,
      skippedPlaylists: 1,
      conflictedPlaylists: 1,
      queueTracks: 3,
      queueTracksToAdd: 2,
    });
    expect(plan.playlists.map(item => item.id)).toEqual([
      'myplaylist_road',
      'myplaylist_same',
      expect.stringMatching(/^myplaylist_import_myplaylist_road/),
    ]);
    expect(plan.queueToAppend.map(item => item.id)).toEqual(['ne_4', 'ne_4']);
  });

  it('makes overwrite explicit in the plan while keeping it side-effect free', () => {
    const incoming = createBackup({
      favorites: [track('ne_new')],
      playlists: [],
      queue: [track('ne_queue')],
      queueMode: 'play-next',
    });
    const existing = {
      favorites: [track('ne_old')],
      playlists: [
        { id: 'myplaylist_old', title: 'Old', tracks: [track('ne_old')] },
      ],
      queue: [track('ne_old')],
      queueMode: 'playlist' as const,
    };
    const plan = planImport(existing, incoming, 'overwrite');

    expect(plan.favorites.map(item => item.id)).toEqual(['ne_new']);
    expect(plan.playlists).toEqual([]);
    expect(plan.queue.map(item => item.id)).toEqual(['ne_queue']);
    expect(plan.summary).toMatchObject({
      overwrittenFavorites: 1,
      overwrittenPlaylists: 1,
      overwrittenQueueTracks: 1,
    });
    expect(existing.favorites.map(item => item.id)).toEqual(['ne_old']);
  });
});
