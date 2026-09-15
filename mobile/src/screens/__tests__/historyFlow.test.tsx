import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../ScreenLayout', () => ({ ScreenLayout: ({ children }: any) => <>{children}</>, sectionStyles: { card: {}, section: {}, button: {}, buttonText: {}, secondaryButton: {}, secondaryText: {} } }));
jest.mock('../../history/history', () => ({ history: { getHistory: jest.fn().mockResolvedValue({ status: 'success', data: [{ eventId: 'one', title: '青花瓷', artist: '周杰伦', date: '2026-01-01' }] }), recap: jest.fn().mockResolvedValue({ status: 'success', data: { year: 2026, totalListenedMs: 0, playCount: 1, distinctTracks: 1, distinctArtists: 1, topTracks: [], topArtists: [], monthly: [] } }), recordingEnabled: jest.fn().mockResolvedValue({ status: 'success', data: { recordingEnabled: true } }), setRecordingEnabled: jest.fn().mockResolvedValue({ status: 'busy' }), clear: jest.fn(), exportSafe: jest.fn() } }));
import { HistoryScreen } from '../HistoryScreen';

test('history screen renders durable history and does not claim a busy privacy toggle succeeded', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<HistoryScreen />); });
  expect(tree.root.findAllByProps({ children: '青花瓷' }).length).toBeGreaterThan(0);
  const toggle = tree.root.findAll(node => node.props.accessibilityLabel === '切换听歌记录')[0];
  await act(async () => { await toggle.props.onPress(); });
  expect(tree.root.findAll(node => typeof node.props.children === 'string' && node.props.children.includes('未确认')).length).toBeGreaterThan(0);
});
