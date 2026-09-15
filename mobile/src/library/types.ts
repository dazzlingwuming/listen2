export const LIBRARY_SCHEMA_VERSION = 1;
export const MAX_LIBRARY_PLAYLISTS = 2_000;
export const MAX_LIBRARY_TITLE_LENGTH = 160;

export type LibraryPlaylistRecord = {
  playlistId: string;
  title: string;
  position: number;
  tracks: LibraryTrackRecord[];
};

export type LibraryTrackRecord = {
  source: 'netease' | 'kugou' | 'kuwo' | 'qq' | 'bilibili' | 'local';
  trackId: string;
  title: string;
  artist: string;
};

export type LibrarySnapshot = {
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  revision: number;
  personalPlaylists: LibraryPlaylistRecord[];
  favorites: LibraryTrackRecord[];
  localRecords: LibraryLocalRecord[];
};

/** Safe projection only; the document URI and persisted permission stay native-private. */
export type LibraryLocalRecord = {
  recordId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  hasArtwork: boolean;
  lyricState: 'none' | 'attached';
  availability: 'available' | 'needs-repair' | 'revoked' | 'unreadable' | 'unsupported' | 'duplicate';
  capabilities: Array<'playlist' | 'queue' | 'lyrics'>;
};

export type CreatePlaylistMutation = {
  requestId: string;
  revision: number;
  kind: 'createPlaylist';
  payload: { playlistId: string; title: string };
};

export type LibraryMutation =
  | CreatePlaylistMutation
  | { requestId: string; revision: number; kind: 'renamePlaylist'; payload: { playlistId: string; title: string } }
  | { requestId: string; revision: number; kind: 'deletePlaylist'; payload: { playlistId: string } }
  | { requestId: string; revision: number; kind: 'movePlaylist'; payload: { playlistId: string; direction: 'up' | 'down' } }
  | { requestId: string; revision: number; kind: 'addTrack'; payload: { playlistId: string; source: LibraryTrackRecord['source']; trackId: string; title: string; artist: string } }
  | { requestId: string; revision: number; kind: 'removeTrack'; payload: { playlistId: string; source: LibraryTrackRecord['source']; trackId: string } }
  | { requestId: string; revision: number; kind: 'favorite'; payload: { playlistId: 'favorites'; source: LibraryTrackRecord['source']; trackId: string; title: string; artist: string } }
  | { requestId: string; revision: number; kind: 'unfavorite'; payload: { playlistId: 'favorites'; source: LibraryTrackRecord['source']; trackId: string } };

export type LibraryMutationReceipt = {
  requestId: string;
  status: 'accepted' | 'stale-revision' | 'rejected';
  revision: number;
  errorCode: string | null;
  snapshot?: LibrarySnapshot;
};

export type LibraryMigrationStatus = {
  backend: 'Room';
  phase: 'not-started' | 'copying' | 'validated' | 'complete' | 'failed';
  sourceRetained: boolean;
  laterStartValidated: boolean;
  attemptId: string | null;
  checksum: string | null;
};

export type LegacyMigrationRequest = {
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  attemptId: string;
  checksum: string;
  playlists: Array<{ title: string }>;
  localEntries: Array<{ title: string; artist: string }>;
};

export type LibraryCapabilityFlags = {
  personalPlaylists: true;
  favorites: false;
  history: false;
  localTracks: false;
};

export type LibraryLocalPlaceholder = {
  id: string;
  title: string;
  artist: string;
  accessStatus: 'needs-repair';
};

export type LibraryHistoryPlaceholder = {
  id: string;
  title: string;
  artist: string;
  unavailable: true;
};
