/**
 * Lyrics arrive from providers as untrusted text. Keep parsing bounded so a
 * malformed response cannot turn the player sheet into an unbounded list.
 */
export const MAX_LYRIC_SOURCE_CHARS = 120_000;
export const MAX_LYRIC_LINES = 500;
export const MAX_LYRIC_LINE_CHARS = 1_000;
export const MAX_LYRIC_OFFSET_MS = 10 * 60 * 1_000;
export const MAX_LYRIC_TIMESTAMP_MS = 24 * 60 * 60 * 1_000;

export type LyricTimelineLine = Readonly<{
  text: string;
  translation?: string;
  /** Null deliberately represents display-only, untimed lyric text. */
  timestampMs: number | null;
}>;

type ParsedLine = {
  text: string;
  timestampMs: number | null;
  order: number;
};

const OFFSET_PATTERN = /^\s*\[offset\s*:\s*([+-]?\d{1,7})\]\s*$/i;
const METADATA_PATTERN =
  /^\s*\[(?:ar|ti|al|by|re|ve|tool|length|offset)\s*:[^\]]*\]\s*$/i;
const TIMESTAMP_PATTERN = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;

/**
 * Turns LRC (including multi-timestamp rows) into a render-ready time axis.
 * Translation is joined by timestamp when possible, and by row for plain
 * text lyrics. Invalid tags are treated as ordinary text rather than errors.
 */
export function parseLyricTimeline(
  primary: unknown,
  translation?: unknown,
): LyricTimelineLine[] {
  const primaryLines = parseSource(primary);
  const translationLines = parseSource(translation);
  const translationAtTime = new Map<number, string[]>();
  const untimedTranslations: string[] = [];

  for (const line of translationLines) {
    if (line.timestampMs === null) {
      untimedTranslations.push(line.text);
      continue;
    }
    const values = translationAtTime.get(line.timestampMs) || [];
    values.push(line.text);
    translationAtTime.set(line.timestampMs, values);
  }

  const sourceLines = primaryLines.length ? primaryLines : translationLines;
  let untimedIndex = 0;
  return sourceLines.slice(0, MAX_LYRIC_LINES).map(line => {
    if (!primaryLines.length) {
      return { text: line.text, timestampMs: line.timestampMs };
    }
    if (line.timestampMs === null) {
      const matched = untimedTranslations[untimedIndex++];
      return matched
        ? { text: line.text, translation: matched, timestampMs: null }
        : { text: line.text, timestampMs: null };
    }
    const matches = translationAtTime.get(line.timestampMs);
    const matched = matches?.shift();
    return matched
      ? { text: line.text, translation: matched, timestampMs: line.timestampMs }
      : { text: line.text, timestampMs: line.timestampMs };
  });
}

/** Returns the last timed row started at or before the current playback time. */
export function findActiveLyricIndex(
  lines: readonly LyricTimelineLine[],
  positionMs: number,
): number {
  if (!Number.isFinite(positionMs)) return -1;
  const safePosition = Math.max(0, positionMs);
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const timestamp = lines[index].timestampMs;
    if (timestamp !== null && timestamp <= safePosition) active = index;
  }
  return active;
}

function parseSource(value: unknown): ParsedLine[] {
  if (typeof value !== 'string' || !value) return [];
  const source = value.slice(0, MAX_LYRIC_SOURCE_CHARS).replace(/^\uFEFF/, '');
  const rawLines = source.split(/\r?\n/);
  let offsetMs = 0;
  for (const rawLine of rawLines) {
    const match = rawLine.match(OFFSET_PATTERN);
    if (!match) continue;
    const candidate = Number(match[1]);
    if (
      Number.isFinite(candidate) &&
      Math.abs(candidate) <= MAX_LYRIC_OFFSET_MS
    )
      offsetMs = candidate;
  }

  const parsed: ParsedLine[] = [];
  let order = 0;
  for (const rawLine of rawLines) {
    if (parsed.length >= MAX_LYRIC_LINES) break;
    if (OFFSET_PATTERN.test(rawLine)) continue;
    if (METADATA_PATTERN.test(rawLine)) continue;
    const line = cleanText(rawLine);
    if (!line) continue;
    const timestamps: number[] = [];
    TIMESTAMP_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TIMESTAMP_PATTERN.exec(line))) {
      const timestamp = timestampMs(match[1], match[2], match[3], offsetMs);
      if (timestamp !== null) timestamps.push(timestamp);
    }
    const content = cleanText(line.replace(TIMESTAMP_PATTERN, ''));
    if (!content) continue;
    if (!timestamps.length) {
      parsed.push({ text: content, timestampMs: null, order: order++ });
      continue;
    }
    for (const timestamp of timestamps) {
      if (parsed.length >= MAX_LYRIC_LINES) break;
      parsed.push({ text: content, timestampMs: timestamp, order: order++ });
    }
  }

  const timed = parsed
    .filter(line => line.timestampMs !== null)
    .sort(
      (left, right) =>
        left.timestampMs! - right.timestampMs! || left.order - right.order,
    );
  const untimed = parsed.filter(line => line.timestampMs === null);
  return [...timed, ...untimed];
}

function timestampMs(
  minutePart: string,
  secondPart: string,
  fractionPart: string | undefined,
  offsetMs: number,
): number | null {
  const minutes = Number(minutePart);
  const seconds = Number(secondPart);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60)
    return null;
  const fraction = fractionPart ? Number(`${fractionPart}00`.slice(0, 3)) : 0;
  const value = minutes * 60_000 + seconds * 1_000 + fraction + offsetMs;
  if (!Number.isFinite(value) || value > MAX_LYRIC_TIMESTAMP_MS) return null;
  return Math.max(0, value);
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_LYRIC_LINE_CHARS);
}
