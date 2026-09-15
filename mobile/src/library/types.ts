export const LIBRARY_SCHEMA_VERSION = 1;
export const MAX_LIBRARY_PLAYLISTS = 2_000;
export const MAX_LIBRARY_TITLE_LENGTH = 160;

export type LibraryPlaylistRecord = {
  playlistId: string;
  title: string;
  position: number;
};

export type LibrarySnapshot = {
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  revision: number;
  personalPlaylists: LibraryPlaylistRecord[];
};

export type CreatePlaylistMutation = {
  requestId: string;
  revision: number;
  kind: 'createPlaylist';
  payload: { playlistId: string; title: string };
};

export type LibraryMutation = CreatePlaylistMutation;

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
