import type { PlayNextOccurrence } from '../store/playerSlice';
import type {
  LibraryLyricMetadata,
  LibraryQueueCheckpoint,
  LibrarySnapshot,
} from './types';

type ContinuitySnapshot = Pick<LibrarySnapshot, 'revision' | 'queueCheckpoint' | 'lyricMetadata'>;
type PersistContinuity = (
  queueCheckpoint: LibraryQueueCheckpoint[],
  lyricMetadata: LibraryLyricMetadata[],
  expectedRevision: number,
) => Promise<LibrarySnapshot>;

type PendingWrite = {
  queueCheckpoint: LibraryQueueCheckpoint[];
  lyricMetadata: LibraryLyricMetadata[];
  expectedRevision: number;
  epoch: number;
  attempts: number;
};

export function queueCheckpointFromPlayer(queue: PlayNextOccurrence[]): LibraryQueueCheckpoint[] {
  return queue.map((occurrence, position) => ({
    occurrenceId: occurrence.occurrenceId,
    position,
    source: occurrence.track.source,
    trackId: occurrence.track.id,
  }));
}

export function continuitySignature(
  queueCheckpoint: LibraryQueueCheckpoint[],
  lyricMetadata: LibraryLyricMetadata[],
) {
  return JSON.stringify({ queueCheckpoint, lyricMetadata });
}

/**
 * Serializes player/lyric observations into the native CAS bridge. A stale or
 * late response can update the projection only when it belongs to the latest
 * epoch; a failed write is retried once from a freshly read revision.
 */
export function createContinuityCoordinator(options: {
  persist: PersistContinuity;
  read: () => Promise<LibrarySnapshot>;
  onSnapshot: (snapshot: LibrarySnapshot) => void;
}) {
  let hydrated = false;
  let epoch = 0;
  let confirmedRevision = 0;
  let confirmedSignature = continuitySignature([], []);
  let requestedSignature = confirmedSignature;
  let pending: PendingWrite | null = null;
  let writing = false;

  const acceptSnapshot = (snapshot: ContinuitySnapshot) => {
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < confirmedRevision) return false;
    const queueCheckpoint = snapshot.queueCheckpoint || [];
    const lyricMetadata = snapshot.lyricMetadata || [];
    confirmedRevision = snapshot.revision;
    confirmedSignature = continuitySignature(queueCheckpoint, lyricMetadata);
    requestedSignature = confirmedSignature;
    hydrated = true;
    return true;
  };

  const drain = async () => {
    if (writing) return;
    writing = true;
    while (pending) {
      const operation = pending;
      pending = null;
      let snapshot: LibrarySnapshot;
      try {
        snapshot = await options.persist(
          operation.queueCheckpoint,
          operation.lyricMetadata,
          operation.expectedRevision,
        );
      } catch {
        if (operation.attempts === 0 && operation.epoch === epoch) {
          try {
            const latest = await options.read();
            if (operation.epoch === epoch && acceptSnapshot(latest)) {
              requestedSignature = continuitySignature(operation.queueCheckpoint, operation.lyricMetadata);
              pending = { ...operation, expectedRevision: latest.revision, attempts: 1 };
              continue;
            }
          } catch {
            // Keep the last confirmed native projection; the next semantic
            // change can request the bridge again.
          }
        }
        if (operation.epoch === epoch) requestedSignature = confirmedSignature;
        continue;
      }
      if (operation.epoch !== epoch || !acceptSnapshot(snapshot)) continue;
      const desiredSignature = continuitySignature(operation.queueCheckpoint, operation.lyricMetadata);
      const savedSignature = continuitySignature(snapshot.queueCheckpoint || [], snapshot.lyricMetadata || []);
      if (snapshot.revision > operation.expectedRevision && savedSignature === desiredSignature) {
        if (operation.epoch === epoch) options.onSnapshot(snapshot);
        continue;
      }
      if (operation.attempts === 0 && operation.epoch === epoch) {
        // Native returned a stale/current snapshot without our payload. Retry
        // against that revision, never overwrite the newer native projection.
        pending = { ...operation, expectedRevision: snapshot.revision, attempts: 1 };
        requestedSignature = desiredSignature;
        continue;
      }
      if (operation.epoch === epoch) requestedSignature = confirmedSignature;
    }
    writing = false;
  };

  return {
    hydrate(snapshot: ContinuitySnapshot) {
      acceptSnapshot(snapshot);
    },
    request(queueCheckpoint: LibraryQueueCheckpoint[], lyricMetadata: LibraryLyricMetadata[], expectedRevision: number) {
      if (!hydrated || !Number.isSafeInteger(expectedRevision) || expectedRevision < confirmedRevision) return;
      const nextSignature = continuitySignature(queueCheckpoint, lyricMetadata);
      if (nextSignature === requestedSignature) return;
      requestedSignature = nextSignature;
      const operationEpoch = ++epoch;
      pending = { queueCheckpoint, lyricMetadata, expectedRevision, epoch: operationEpoch, attempts: 0 };
      void drain();
    },
    invalidate() {
      epoch += 1;
      pending = null;
      requestedSignature = confirmedSignature;
    },
  };
}
