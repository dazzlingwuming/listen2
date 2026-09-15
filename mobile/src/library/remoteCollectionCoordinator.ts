import { libraryClient } from './libraryClient';
import type { LibraryRemoteCollection, LibrarySnapshot } from './types';

let refreshEpoch = 0;

/**
 * Upserts a provider result through the native revision-checked bridge. A
 * concurrent refresh invalidates older work; a stale revision is retried from
 * the returned native snapshot, while any transport/validation failure keeps
 * the last remote projection untouched.
 */
export async function persistRemoteCollectionRefresh(
  incoming: LibraryRemoteCollection[],
): Promise<LibrarySnapshot | null> {
  const epoch = ++refreshEpoch;
  let base: LibrarySnapshot;
  try {
    base = await libraryClient.getSnapshot();
  } catch {
    return null;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (epoch !== refreshEpoch) return null;
    const byId = new Map((base.remoteCollections || []).map(item => [item.collectionId, item]));
    incoming.forEach(item => byId.set(item.collectionId, item));
    const merged = Array.from(byId.values());
    try {
      const saved = await libraryClient.replaceRemoteCollections(merged, base.revision);
      if (epoch !== refreshEpoch) return null;
      const sameProjection = saved.remoteCollections?.length === merged.length &&
        merged.every(item => saved.remoteCollections?.some(candidate => candidate.collectionId === item.collectionId && candidate.source === item.source && candidate.title === item.title && candidate.syncState === item.syncState));
      if (saved.revision > base.revision && sameProjection) return saved;
      base = saved;
    } catch {
      return null;
    }
  }
  return null;
}
