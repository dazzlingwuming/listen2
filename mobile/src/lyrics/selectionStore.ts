import { parseExactBilibiliTrackId } from '../api/ids';
import type { SourceId } from '../types';
import type { BilibiliLyricCacheRecord } from './cache';
import { MAX_LYRIC_OFFSET_MS } from './timeline';

const HEAD = 'listen2:lyric-selection:head';
const SLOT = (value: 0 | 1) => `listen2:lyric-selection:slot:${value}`;
const VERSION = 1;
const MAX_RECORDS = 128;

export type LyricSelectionKey = Readonly<{
  source: SourceId;
  trackId: string;
  partId: string | null;
}>;
export type LyricSelectionRecord = Readonly<{
  key: LyricSelectionKey;
  revision: number;
  updatedAt: number;
  offsetMs: number;
  manual?: Readonly<{ provider: 'netease' | 'qq'; candidateId: string }>;
}>;
export type LyricSelectionWriteResult =
  | { status: 'ok'; record: LyricSelectionRecord }
  | { status: 'stale'; revision?: number }
  | { status: 'not-found' }
  | { status: 'invalid' };
type Stored = {
  version: number;
  revision: number;
  records: LyricSelectionRecord[];
};
type State = { store: Stored; slot: 0 | 1 };

let chain = Promise.resolve();
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
let storageInstance: Storage | undefined;

/** Load storage only for a semantic selection operation, not lyric rendering. */
function storage(): Storage {
  if (!storageInstance) {
    const module = require('@react-native-async-storage/async-storage');
    storageInstance = (module.default ?? module) as Storage;
  }
  return storageInstance;
}
const identity = (key: LyricSelectionKey) =>
  `${key.source}|${key.trackId}|${key.partId ?? '-'}`;

function validKey(value: unknown): value is LyricSelectionKey {
  if (!value || typeof value !== 'object') return false;
  const key = value as LyricSelectionKey;
  if (typeof key.source !== 'string' || typeof key.trackId !== 'string')
    return false;
  const exact =
    key.source === 'bilibili' ? parseExactBilibiliTrackId(key.trackId) : null;
  if (key.source === 'bilibili')
    return Boolean(exact && key.partId === exact.cid);
  return (
    key.partId === null &&
    /^[a-z]+track_[A-Za-z0-9_-]{1,128}$/.test(key.trackId)
  );
}
function validRecord(value: unknown): value is LyricSelectionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as LyricSelectionRecord;
  const manual = record.manual;
  return (
    validKey(record.key) &&
    Number.isSafeInteger(record.revision) &&
    record.revision > 0 &&
    Number.isSafeInteger(record.updatedAt) &&
    Number.isFinite(record.offsetMs) &&
    Math.abs(record.offsetMs) <= MAX_LYRIC_OFFSET_MS &&
    (!manual ||
      (record.key.source === 'bilibili' &&
        (manual.provider === 'netease' || manual.provider === 'qq') &&
        typeof manual.candidateId === 'string' &&
        /^[A-Za-z0-9_-]{1,160}$/.test(manual.candidateId)))
  );
}
function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Stored;
    return parsed?.version === VERSION &&
      Number.isSafeInteger(parsed.revision) &&
      parsed.revision >= 0 &&
      Array.isArray(parsed.records) &&
      parsed.records.length <= MAX_RECORDS &&
      parsed.records.every(validRecord)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
async function read(): Promise<State> {
  const head = await storage().getItem(HEAD);
  const [zero, one] = await Promise.all([
    storage().getItem(SLOT(0)),
    storage().getItem(SLOT(1)),
  ]);
  const candidates = [
    { slot: 0 as const, store: parse(zero) },
    { slot: 1 as const, store: parse(one) },
  ].filter((value): value is State => value.store !== null);
  if (!candidates.length)
    return { slot: 0, store: { version: VERSION, revision: 0, records: [] } };
  candidates.sort(
    (left, right) =>
      right.store.revision - left.store.revision ||
      (head === String(left.slot) ? -1 : 1),
  );
  const selected = candidates[0];
  if (head !== String(selected.slot))
    await storage().setItem(HEAD, String(selected.slot));
  return selected;
}
async function publish(store: Stored, active: 0 | 1) {
  const next: 0 | 1 = active === 0 ? 1 : 0;
  await storage().setItem(SLOT(next), JSON.stringify(store));
  await storage().setItem(HEAD, String(next));
}
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = chain.then(operation, operation);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function sameRecord(left: LyricSelectionRecord, key: LyricSelectionKey) {
  return identity(left.key) === identity(key);
}

async function persist(
  store: Stored,
  slot: 0 | 1,
  record: LyricSelectionRecord,
) {
  await publish(
    {
      version: VERSION,
      revision: store.revision + 1,
      records: [
        record,
        ...store.records.filter(value => !sameRecord(value, record.key)),
      ].slice(0, MAX_RECORDS),
    },
    slot,
  );
}

/** Read-only bridge for compatible Bilibili cache records; it never rewrites cache. */
export function selectionFromBilibiliCache(
  record: BilibiliLyricCacheRecord | null,
): LyricSelectionRecord | null {
  if (
    !record ||
    !validKey({
      source: 'bilibili',
      trackId: record.lyric.trackId,
      partId: parseExactBilibiliTrackId(record.lyric.trackId)?.cid ?? null,
    })
  )
    return null;
  const exact = parseExactBilibiliTrackId(record.lyric.trackId)!;
  const provenance = record.lyric.provenance;
  return {
    key: { source: 'bilibili', trackId: exact.trackId, partId: exact.cid },
    revision: record.revision,
    updatedAt: record.updatedAt,
    offsetMs: 0,
    ...(provenance?.mode === 'manual'
      ? {
          manual: {
            provider: provenance.matchedProvider,
            candidateId: provenance.matchedCandidateId,
          },
        }
      : {}),
  };
}

export const lyricSelectionStore = {
  get(key: LyricSelectionKey) {
    if (!validKey(key)) return Promise.resolve(null);
    return serial(async () => {
      const { store } = await read();
      return (
        store.records.find(record => identity(record.key) === identity(key)) ??
        null
      );
    });
  },
  put(
    input: Omit<LyricSelectionRecord, 'revision' | 'updatedAt'>,
    expectedRevision?: number,
  ): Promise<LyricSelectionWriteResult> {
    if (
      !validKey(input.key) ||
      !Number.isFinite(input.offsetMs) ||
      Math.abs(input.offsetMs) > MAX_LYRIC_OFFSET_MS ||
      (input.manual && input.key.source !== 'bilibili')
    )
      return Promise.resolve({ status: 'invalid' as const });
    return serial(async () => {
      const { store, slot } = await read();
      const existing = store.records.find(record =>
        sameRecord(record, input.key),
      );
      if (
        expectedRevision !== undefined &&
        (existing?.revision ?? 0) !== expectedRevision
      )
        return { status: 'stale' as const, revision: existing?.revision };
      const record: LyricSelectionRecord = {
        key: input.key,
        revision: (existing?.revision ?? 0) + 1,
        updatedAt: Date.now(),
        offsetMs: input.offsetMs,
        ...(input.manual ? { manual: input.manual } : {}),
      };
      await persist(store, slot, record);
      return { status: 'ok' as const, record };
    });
  },
  setOffset(
    key: LyricSelectionKey,
    offsetMs: number,
    expectedRevision?: number,
  ): Promise<LyricSelectionWriteResult> {
    if (
      !validKey(key) ||
      !Number.isFinite(offsetMs) ||
      Math.abs(offsetMs) > MAX_LYRIC_OFFSET_MS
    )
      return Promise.resolve({ status: 'invalid' });
    return serial(async () => {
      const { store, slot } = await read();
      const current = store.records.find(record => sameRecord(record, key));
      if (
        expectedRevision !== undefined &&
        (current?.revision ?? 0) !== expectedRevision
      )
        return { status: 'stale' as const, revision: current?.revision };
      const record: LyricSelectionRecord = {
        key,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: Date.now(),
        offsetMs,
        ...(current?.manual ? { manual: current.manual } : {}),
      };
      await persist(store, slot, record);
      return { status: 'ok' as const, record };
    });
  },
  clearManual(
    key: LyricSelectionKey,
    expectedRevision?: number,
  ): Promise<LyricSelectionWriteResult> {
    if (!validKey(key)) return Promise.resolve({ status: 'invalid' });
    return serial(async () => {
      const { store, slot } = await read();
      const current = store.records.find(record => sameRecord(record, key));
      if (!current) return { status: 'not-found' as const };
      if (
        expectedRevision !== undefined &&
        current.revision !== expectedRevision
      )
        return { status: 'stale' as const, revision: current.revision };
      const record: LyricSelectionRecord = {
        key,
        revision: current.revision + 1,
        updatedAt: Date.now(),
        offsetMs: current.offsetMs,
      };
      await persist(store, slot, record);
      return { status: 'ok' as const, record };
    });
  },
};
