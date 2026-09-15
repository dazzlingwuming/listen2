import libraryReducer, { hydrationSucceeded } from '../../store/librarySlice';

const recordId = '11111111-1111-4111-8111-111111111111';

describe('local-library safe projection', () => {
  it('projects opaque records only after a confirmed native snapshot with queue capability', () => {
    const snapshot = {
      schemaVersion: 1 as const,
      revision: 2,
      personalPlaylists: [],
      favorites: [],
      localRecords: [{ recordId, title: '本地歌', artist: '歌手', album: null, durationMs: 123_000, hasArtwork: true, lyricState: 'attached' as const, availability: 'available' as const, capabilities: ['playlist', 'queue', 'lyrics'] as Array<'playlist' | 'queue' | 'lyrics'> }],
    };
    const library = libraryReducer(undefined, hydrationSucceeded(snapshot));
    expect(library.localTracks).toEqual([expect.objectContaining({ id: recordId, source: 'local', lyricState: 'attached', hasArtwork: true })]);
    expect(JSON.stringify(library.localTracks)).not.toContain('content://');
    expect(library.localTracks[0].capabilities).toContain('queue');
  });

  it('keeps a repairable unavailable record opaque and exposes its non-seekable capability', () => {
    const snapshot = {
      schemaVersion: 1 as const,
      revision: 3,
      personalPlaylists: [],
      favorites: [],
      localRecords: [{ recordId, title: '云端文件', artist: '歌手', album: null, durationMs: null, hasArtwork: false, lyricState: 'none' as const, availability: 'unreadable' as const, capabilities: ['playlist', 'queue', 'lyrics'] as Array<'playlist' | 'queue' | 'lyrics'> }],
    };
    const library = libraryReducer(undefined, hydrationSucceeded(snapshot));
    expect(library.localTracks[0]).toEqual(expect.objectContaining({ id: recordId, accessStatus: 'unreadable', seekable: false }));
    expect(JSON.stringify(library)).not.toContain('content://');
  });
});
