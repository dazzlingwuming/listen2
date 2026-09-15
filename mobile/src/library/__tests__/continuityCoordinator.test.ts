import {
  continuitySignature,
  createContinuityCoordinator,
} from '../continuityCoordinator';
import type {
  LibraryLyricMetadata,
  LibraryQueueCheckpoint,
  LibrarySnapshot,
} from '../types';

const snapshot = (
  revision: number,
  queueCheckpoint: LibraryQueueCheckpoint[] = [],
  lyricMetadata: LibraryLyricMetadata[] = [],
) => ({ revision, queueCheckpoint, lyricMetadata }) as LibrarySnapshot;

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('continuity coordinator', () => {
  it('retries a failed write from a fresh native revision', async () => {
    const queue = [{ occurrenceId: 'q1', position: 0, source: 'netease' as const, trackId: '42' }];
    const persist = jest.fn()
      .mockRejectedValueOnce(new Error('bridge'))
      .mockResolvedValueOnce(snapshot(3, queue));
    const read = jest.fn().mockResolvedValue(snapshot(2));
    const onSnapshot = jest.fn();
    const coordinator = createContinuityCoordinator({ persist, read, onSnapshot });
    coordinator.hydrate(snapshot(1));

    coordinator.request(queue, [], 1);
    await tick();

    expect(persist).toHaveBeenNthCalledWith(1, queue, [], 1);
    expect(persist).toHaveBeenNthCalledWith(2, queue, [], 2);
    expect(onSnapshot).toHaveBeenCalledWith(snapshot(3, queue));
  });

  it('ignores a late epoch and commits only the newest queue projection', async () => {
    const firstQueue = [{ occurrenceId: 'q1', position: 0, source: 'netease' as const, trackId: '1' }];
    const latestQueue = [{ occurrenceId: 'q2', position: 0, source: 'netease' as const, trackId: '2' }];
    let resolveFirst: (value: LibrarySnapshot) => void = () => undefined;
    const firstResponse = new Promise<LibrarySnapshot>(resolve => { resolveFirst = resolve; });
    const persist = jest.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(snapshot(3, latestQueue));
    const onSnapshot = jest.fn();
    const coordinator = createContinuityCoordinator({
      persist,
      read: jest.fn().mockResolvedValue(snapshot(2)),
      onSnapshot,
    });
    coordinator.hydrate(snapshot(1));
    coordinator.request(firstQueue, [], 1);
    coordinator.request(latestQueue, [], 1);
    resolveFirst(snapshot(2, firstQueue));
    await tick();

    expect(persist).toHaveBeenNthCalledWith(2, latestQueue, [], 1);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(continuitySignature(onSnapshot.mock.calls[0][0].queueCheckpoint, [])).toBe(
      continuitySignature(latestQueue, []),
    );
  });
});
