import {
  BACKUP_FORMAT,
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
    });
    expect(preview).toMatchObject({
      favorites: 1,
      playlists: 1,
      playlistTracks: 1,
      totalTracks: 2,
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
      }),
    ],
  ])('rejects unsafe %s input before planning', (_name, raw) => {
    expect(() => parseBackup(raw)).toThrow(BackupValidationError);
  });

  it('rejects unsupported versions and unknown queue fields', () => {
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
          queue: [track('ne_queue')],
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
      },
      incoming,
    );

    expect(plan.mode).toBe('merge');
    expect(plan.summary).toMatchObject({
      addedFavorites: 1,
      addedPlaylists: 1,
      skippedPlaylists: 1,
      conflictedPlaylists: 1,
    });
    expect(plan.playlists.map(item => item.id)).toEqual([
      'myplaylist_road',
      'myplaylist_same',
      expect.stringMatching(/^myplaylist_import_myplaylist_road/),
    ]);
  });

  it('makes overwrite explicit in the plan while keeping it side-effect free', () => {
    const incoming = createBackup({
      favorites: [track('ne_new')],
      playlists: [],
    });
    const existing = {
      favorites: [track('ne_old')],
      playlists: [
        { id: 'myplaylist_old', title: 'Old', tracks: [track('ne_old')] },
      ],
    };
    const plan = planImport(existing, incoming, 'overwrite');

    expect(plan.favorites.map(item => item.id)).toEqual(['ne_new']);
    expect(plan.playlists).toEqual([]);
    expect(plan.summary).toMatchObject({
      overwrittenFavorites: 1,
      overwrittenPlaylists: 1,
    });
    expect(existing.favorites.map(item => item.id)).toEqual(['ne_old']);
  });

  it('rejects DeepSeek credential, consent, lyric cache, and transport fields', () => {
    for (const forbidden of [
      'deepSeekApiKey',
      'deepSeekConsent',
      'deepSeekCache',
      'lyricText',
      'authorization',
      'headers',
      'cookie',
    ]) {
      expect(() =>
        parseBackup(
          JSON.stringify({
            ...createBackup(snapshot),
            [forbidden]: 'must-not-export',
          }),
        ),
      ).toThrow(BackupValidationError);
    }
  });
});
