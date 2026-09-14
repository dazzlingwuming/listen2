import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { BilibiliMvScreen } from '../BilibiliMvScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockOpen = jest.fn();
const mockClose = jest.fn();
let mockRoute: any = { params: { bvid: 'BV1xx411c7mD', cid: '12', title: '测试 MV' } };

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }), useRoute: () => mockRoute }));
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('../../components/BilibiliMvView', () => ({ BilibiliMvView: () => null }));
jest.mock('../../bilibili/mvClient', () => ({ bilibiliMvClient: { open: (...args: unknown[]) => mockOpen(...args), close: (...args: unknown[]) => mockClose(...args), selectQuality: jest.fn(), enterFullscreen: jest.fn(), exitFullscreen: jest.fn(), requestPip: jest.fn() } }));

describe('Bilibili MV flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = { params: { bvid: 'BV1xx411c7mD', cid: '12', title: '测试 MV' } };
    mockOpen.mockResolvedValue({ state: 'ready', handle: 'opaque_handle_abcdefghijklmnop', bvid: 'BV1xx411c7mD', cid: '12', qualityId: '80', variants: [{ id: '80', label: '高清', codec: 'avc1', width: 1920, height: 1080 }], positionMs: 0, playIntent: true, refreshing: false });
    mockClose.mockResolvedValue({ state: 'closed', qualityId: '80', variants: [], positionMs: 0, playIntent: false, refreshing: false });
  });
  it('opens only the exact selected part and can close without affecting audio controls', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<BilibiliMvScreen />); await Promise.resolve(); });
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ bvid: 'BV1xx411c7mD', cid: '12', preferredCodecs: ['avc1'] }));
    await act(async () => { tree.root.findByProps({ accessibilityLabel: '关闭MV画面' }).props.onPress(); });
    expect(mockClose).toHaveBeenCalledWith('opaque_handle_abcdefghijklmnop');
    expect(mockGoBack).toHaveBeenCalled();
  });
});
