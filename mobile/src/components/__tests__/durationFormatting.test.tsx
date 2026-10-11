import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { TrackRow, formatDuration, formatDurationSeconds } from '../TrackRow';

jest.mock('../SourceTabs', () => ({ providerLabels: { netease: '网易云音乐', local: '本地音乐' } }));

const fixture = { id: 'ne_1', source: 'netease' as const, title: '歌曲', artist: '艺人' };

describe('explicit playback seconds and canonical track milliseconds', () => {
  it.each([
    [0, '0:00'], [0.964, '0:00'], [1, '0:01'], [60, '1:00'],
    [1000, '16:40'], [1001, '16:41'],
    [-1, '0:00'], [NaN, '0:00'], [Infinity, '0:00'],
  ])('formats %s seconds as %s without guessing its unit', (value, expected) => {
    expect(formatDurationSeconds(value)).toBe(expected);
  });

  it.each([
    [964, '0:00'], [1000, '0:01'], [60000, '1:00'], [720000, '12:00'],
  ])('renders an actual TrackRow durationMs=%s as %s', async (durationMs, expected) => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<TrackRow track={{ ...fixture, durationMs }} />); });
    const labels = tree.root.findAllByType(Text).map(node => React.Children.toArray(node.props.children).join(''));
    expect(labels).toContain(`网易云音乐 · 歌曲 · ${expected}`);
    await act(async () => { tree.unmount(); });
  });

  it.each([120, 120000])('retains existing legacy duration=%s formatting', async duration => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<TrackRow track={{ ...fixture, duration, durationMs: 720000 }} />); });
    const labels = tree.root.findAllByType(Text).map(node => React.Children.toArray(node.props.children).join(''));
    expect(labels).toContain('网易云音乐 · 歌曲 · 2:00');
    expect(formatDuration(duration)).toBe('2:00');
    await act(async () => { tree.unmount(); });
  });
});
