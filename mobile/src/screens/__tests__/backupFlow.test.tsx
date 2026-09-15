import { createBackup, parseBackup, planImport } from '../../backup/backupCodec';
import type { Track } from '../../types/music';

const track: Track = {
  id: 'safe-track',
  source: 'netease',
  title: 'Safe song',
  artist: 'Listen2',
};

describe('portable backup flow contract', () => {
  it('previews only personal library data and keeps a merge side-effect free before confirmation', () => {
    const document = createBackup({
      favorites: [track],
      playlists: [{ id: 'myplaylist_safe', title: 'Safe', tracks: [track] }],
    });
    expect(document).not.toHaveProperty('queue');
    expect(parseBackup(JSON.stringify(document))).toEqual(document);

    const existing = { favorites: [] as Track[], playlists: [] };
    const plan = planImport(existing, document, 'merge');
    expect(plan.summary.addedFavorites).toBe(1);
    expect(plan.summary.addedPlaylists).toBe(1);
    expect(existing).toEqual({ favorites: [], playlists: [] });
  });
});
