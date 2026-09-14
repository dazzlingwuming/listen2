import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseExactBilibiliTrackId } from '../api/ids';
import type { Lyric } from '../types/provider';

const HEAD = 'listen2:bilibili-lyrics:head';
const SLOT = (value: 0 | 1) => `listen2:bilibili-lyrics:slot:${value}`;
const VERSION = 1;
const MAX_RECORDS = 64;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;
const AUTO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type BilibiliLyricCacheRecord = Readonly<{
  identity: string;
  revision: number;
  updatedAt: number;
  lyric: Lyric;
}>;
type Stored = {
  version: number;
  revision: number;
  records: BilibiliLyricCacheRecord[];
};
type ReadState = { store: Stored; activeSlot: 0 | 1 };

const bytes = (value: string) =>
  encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, 'x').length;
let operationChain = Promise.resolve();

function exactIdentity(value: string) {
  const parsed = parseExactBilibiliTrackId(value);
  return parsed?.cacheKey ?? null;
}
function recordShape(record: unknown): record is BilibiliLyricCacheRecord {
  if (!record || typeof record !== 'object') return false;
  const value = record as BilibiliLyricCacheRecord;
  const lyric = value.lyric;
  const provenance = lyric?.provenance;
  return (
    typeof value.identity === 'string' &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    Number.isSafeInteger(value.updatedAt) &&
    Boolean(lyric) &&
    typeof lyric.trackId === 'string' &&
    typeof lyric.text === 'string' &&
    exactIdentity(lyric.trackId) === value.identity &&
    lyric.source === 'bilibili' &&
    Boolean(provenance) &&
    (provenance!.mode === 'manual' || provenance!.mode === 'auto') &&
    (provenance!.matchedProvider === 'netease' ||
      provenance!.matchedProvider === 'qq') &&
    typeof provenance!.matchedCandidateId === 'string' &&
    Number.isFinite(provenance!.matchScore) &&
    bytes(lyric.text) <= MAX_TEXT_BYTES
  );
}
function parseSlot(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Stored;
    return value &&
      value.version === VERSION &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 0 &&
      Array.isArray(value.records) &&
      value.records.length <= MAX_RECORDS &&
      value.records.every(recordShape)
      ? value
      : null;
  } catch {
    return null;
  }
}
async function readUnsafe(): Promise<ReadState> {
  const head = await AsyncStorage.getItem(HEAD);
  const [zero, one] = await Promise.all([
    AsyncStorage.getItem(SLOT(0)),
    AsyncStorage.getItem(SLOT(1)),
  ]);
  const slots = [
    { slot: 0 as const, store: parseSlot(zero) },
    { slot: 1 as const, store: parseSlot(one) },
  ].filter(
    (value): value is { slot: 0 | 1; store: Stored } => value.store !== null,
  );
  if (!slots.length)
    return {
      store: { version: VERSION, revision: 0, records: [] },
      activeSlot: 0,
    };
  slots.sort((left, right) => {
    if (right.store.revision !== left.store.revision)
      return right.store.revision - left.store.revision;
    if (head === String(left.slot)) return -1;
    if (head === String(right.slot)) return 1;
    return left.slot - right.slot;
  });
  const selected = slots[0];
  if (head !== String(selected.slot))
    await AsyncStorage.setItem(HEAD, String(selected.slot));
  return { store: selected.store, activeSlot: selected.slot };
}
function valid(record: BilibiliLyricCacheRecord, now = Date.now()) {
  if (!recordShape(record)) return false;
  const lyric = record.lyric;
  const provenance = lyric.provenance;
  return (
    typeof record.identity === 'string' &&
    Number.isSafeInteger(record.revision) &&
    Number.isSafeInteger(record.updatedAt) &&
    typeof lyric.trackId === 'string' &&
    typeof lyric.text === 'string' &&
    exactIdentity(lyric.trackId) === record.identity &&
    lyric.source === 'bilibili' &&
    Boolean(provenance) &&
    (provenance!.mode === 'manual' || provenance!.mode === 'auto') &&
    (provenance!.matchedProvider === 'netease' ||
      provenance!.matchedProvider === 'qq') &&
    typeof provenance!.matchedCandidateId === 'string' &&
    Number.isFinite(provenance!.matchScore) &&
    bytes(lyric.text) <= MAX_TEXT_BYTES &&
    (provenance!.mode === 'manual' || now - record.updatedAt <= AUTO_MAX_AGE_MS)
  );
}
async function publish(value: Stored, activeSlot: 0 | 1) {
  const next: 0 | 1 = activeSlot === 0 ? 1 : 0;
  await AsyncStorage.setItem(SLOT(next), JSON.stringify(value));
  await AsyncStorage.setItem(HEAD, String(next));
}
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationChain.then(operation, operation);
  operationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export const bilibiliLyricCache = {
  get(trackId: string) {
    const identity = exactIdentity(trackId);
    if (!identity) return Promise.resolve(null);
    return serial(async () => {
      const { store } = await readUnsafe();
      return (
        store.records.find(
          record => record.identity === identity && valid(record),
        ) ?? null
      );
    });
  },
  put(
    record: Omit<
      BilibiliLyricCacheRecord,
      'identity' | 'revision' | 'updatedAt'
    > &
      Partial<
        Pick<BilibiliLyricCacheRecord, 'identity' | 'revision' | 'updatedAt'>
      >,
    expectedRevision?: number,
  ) {
    return serial(async () => {
      const identity = exactIdentity(record.lyric.trackId);
      if (
        !identity ||
        !record.lyric.provenance ||
        bytes(record.lyric.text) > MAX_TEXT_BYTES
      )
        return { status: 'invalid' as const };
      const { store, activeSlot } = await readUnsafe();
      const existing = store.records.find(value => value.identity === identity);
      if (
        expectedRevision !== undefined &&
        (existing?.revision ?? 0) !== expectedRevision
      )
        return { status: 'stale' as const, revision: existing?.revision };
      const next: BilibiliLyricCacheRecord = {
        identity,
        revision: (existing?.revision ?? 0) + 1,
        updatedAt: Date.now(),
        lyric: record.lyric,
      };
      const records = [
        next,
        ...store.records.filter(
          value => value.identity !== identity && valid(value),
        ),
      ].slice(0, MAX_RECORDS);
      while (
        bytes(JSON.stringify(records.map(value => value.lyric.text))) >
        MAX_TOTAL_BYTES
      )
        records.pop();
      await publish(
        {
          version: VERSION,
          revision: store.revision + 1,
          records,
        },
        activeSlot,
      );
      return { status: 'ok' as const, record: next };
    });
  },
  clear(trackId: string) {
    const identity = exactIdentity(trackId);
    if (!identity) return Promise.resolve({ status: 'invalid' as const });
    return serial(async () => {
      const { store, activeSlot } = await readUnsafe();
      await publish(
        {
          ...store,
          revision: store.revision + 1,
          records: store.records.filter(record => record.identity !== identity),
        },
        activeSlot,
      );
      return { status: 'ok' as const };
    });
  },
  list() {
    return serial(async () => (await readUnsafe()).store.records.filter(valid));
  },
  repair() {
    return serial(async () => {
      const { store, activeSlot } = await readUnsafe();
      const records = store.records.filter(valid);
      await publish({ ...store, records }, activeSlot);
      return records;
    });
  },
};
