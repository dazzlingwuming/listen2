import {
  MAX_LYRIC_LINES,
  findActiveLyricIndex,
  parseLyricTimeline,
} from '../timeline';

describe('parseLyricTimeline', () => {
  it('expands multi-timestamp LRC rows, applies a bounded offset, and orders rows', () => {
    expect(
      parseLyricTimeline(
        '[offset:-500]\n[00:03.25][00:01.5]same line\n[00:02.00]middle',
      ),
    ).toEqual([
      { text: 'same line', timestampMs: 1_000 },
      { text: 'middle', timestampMs: 1_500 },
      { text: 'same line', timestampMs: 2_750 },
    ]);
  });

  it('pairs translation by timestamp and preserves plain-text bilingual rows', () => {
    expect(
      parseLyricTimeline(
        '[00:01.00]First\n[00:02.00]Second\nPlain',
        '[00:02.00]第二句\n[00:01.00]第一句\n翻译纯文本',
      ),
    ).toEqual([
      { text: 'First', translation: '第一句', timestampMs: 1_000 },
      { text: 'Second', translation: '第二句', timestampMs: 2_000 },
      { text: 'Plain', translation: '翻译纯文本', timestampMs: null },
    ]);
  });

  it('keeps untimed text readable and makes it deliberately non-highlightable', () => {
    const lines = parseLyricTimeline('[ti: Song]\nFirst line\nSecond line');
    expect(lines).toEqual([
      { text: 'First line', timestampMs: null },
      { text: 'Second line', timestampMs: null },
    ]);
    expect(findActiveLyricIndex(lines, 9_000)).toBe(-1);
  });

  it('rejects out-of-range offsets and limits malformed source output', () => {
    const oversized = Array.from(
      { length: MAX_LYRIC_LINES + 20 },
      (_, index) =>
        `[00:${String(index % 60).padStart(2, '0')}.00]line ${index}`,
    ).join('\n');
    const lines = parseLyricTimeline('[offset:9999999]\n' + oversized);
    expect(lines).toHaveLength(MAX_LYRIC_LINES);
    expect(lines[0]).toMatchObject({ timestampMs: 0 });
    expect(parseLyricTimeline('[00:99.00]bad')).toEqual([
      { text: '[00:99.00]bad', timestampMs: null },
    ]);
  });
});

describe('findActiveLyricIndex', () => {
  const lines = parseLyricTimeline('[00:01.00]A\n[00:02.00]B\n[00:03.00]C');

  it('selects the most recently started timed line', () => {
    expect(findActiveLyricIndex(lines, 999)).toBe(-1);
    expect(findActiveLyricIndex(lines, 1_000)).toBe(0);
    expect(findActiveLyricIndex(lines, 2_500)).toBe(1);
    expect(findActiveLyricIndex(lines, Number.NaN)).toBe(-1);
  });
});
