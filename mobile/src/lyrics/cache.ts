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

const bytes = (value: string) =>
  encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, 'x').length;
let writeChain = Promise.resolve();

function exactIdentity(value: string) {
  const parsed = parseExactBilibiliTrackId(value);
  return parsed?.cacheKey ?? null;
}
function current(value: Stored): Stored {
  return value &&
    value.version === VERSION &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    Array.isArray(value.records)
    ? value
    : { version: VERSION, revision: 0, records: [] };
}
async function read(): Promise<Stored> {
  const head = await AsyncStorage.getItem(HEAD);
  const slot = head === '1' ? 1 : 0;
  for (const candidate of [slot, slot === 0 ? 1 : 0] as const) {
    try {
      const raw = await AsyncStorage.getItem(SLOT(candidate));
      if (!raw) continue;
      const parsed = current(JSON.parse(raw));
      if (
        parsed.records.every(
          record =>
            exactIdentity(record.lyric.trackId) &&
            record.identity === exactIdentity(record.lyric.trackId),
        )
      )
        return parsed;
    } catch {
      // Fall through to the alternate atomically published slot.
    }
  }
  return { version: VERSION, revision: 0, records: [] };
}
function valid(record: BilibiliLyricCacheRecord, now = Date.now()) {
  const provenance = record.lyric.provenance;
  return (
    exactIdentity(record.lyric.trackId) === record.identity &&
    record.lyric.source === 'bilibili' &&
    Boolean(provenance) &&
    bytes(record.lyric.text) <= MAX_TEXT_BYTES &&
    (provenance!.mode === 'manual' || now - record.updatedAt <= AUTO_MAX_AGE_MS)
  );
}
async function publish(value: Stored) {
  const oldHead = await AsyncStorage.getItem(HEAD);
  const next: 0 | 1 = oldHead === '0' ? 1 : 0;
  await AsyncStorage.setItem(SLOT(next), JSON.stringify(value));
  await AsyncStorage.setItem(HEAD, String(next));
}

export const bilibiliLyricCache = {
  async get(trackId: string) {
    const identity = exactIdentity(trackId);
    if (!identity) return null;
    const store = await read();
    return (
      store.records.find(
        record => record.identity === identity && valid(record),
      ) ?? null
    );
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
    const operation = async () => {
      const identity = exactIdentity(record.lyric.trackId);
      if (
        !identity ||
        !record.lyric.provenance ||
        bytes(record.lyric.text) > MAX_TEXT_BYTES
      )
        return { status: 'invalid' as const };
      const store = await read();
      const existing = store.records.find(value => value.identity === identity);
      if (
        expectedRevision !== undefined &&
        existing?.revision !== expectedRevision
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
      await publish({
        version: VERSION,
        revision: store.revision + 1,
        records,
      });
      return { status: 'ok' as const, record: next };
    };
    const result = writeChain.then(operation, operation);
    writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  },
  clear(trackId: string) {
    const identity = exactIdentity(trackId);
    if (!identity) return Promise.resolve({ status: 'invalid' as const });
    const operation = async () => {
      const store = await read();
      await publish({
        ...store,
        revision: store.revision + 1,
        records: store.records.filter(record => record.identity !== identity),
      });
      return { status: 'ok' as const };
    };
    const result = writeChain.then(operation, operation);
    writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  },
  async list() {
    return (await read()).records.filter(valid);
  },
  async repair() {
    const store = await read();
    const records = store.records.filter(valid);
    await publish({ ...store, records });
    return records;
  },
};
