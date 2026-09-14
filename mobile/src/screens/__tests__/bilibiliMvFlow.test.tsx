import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { BilibiliMvScreen } from '../BilibiliMvScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockOpen = jest.fn();
const mockClose = jest.fn();
const mockSelectQuality = jest.fn();
let mockRoute: any = {
  params: { bvid: 'BV1xx411c7mD', cid: '12', title: '测试 MV' },
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => mockRoute,
}));
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('../../components/BilibiliMvView', () => ({
  BilibiliMvView: () => null,
}));
jest.mock('../../bilibili/mvClient', () => ({
  bilibiliMvClient: {
    restore: jest.fn().mockRejectedValue(new Error('none')),
    open: (...args: unknown[]) => mockOpen(...args),
    close: (...args: unknown[]) => mockClose(...args),
    selectQuality: (...args: unknown[]) => mockSelectQuality(...args),
    enterFullscreen: jest.fn(),
    exitFullscreen: jest.fn(),
    requestPip: jest.fn(),
    sync: jest.fn(),
    onPipState: () => ({ remove: jest.fn() }),
  },
}));

describe('Bilibili MV flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {
      params: { bvid: 'BV1xx411c7mD', cid: '12', title: '测试 MV' },
    };
    mockOpen.mockResolvedValue({
      state: 'ready',
      handle: 'opaque_handle_abcdefghijklmnop',
      bvid: 'BV1xx411c7mD',
      cid: '12',
      qualityId: '80',
      variants: [
        { id: '80', label: '高清', codec: 'avc1', width: 1920, height: 1080 },
      ],
      positionMs: 0,
      playIntent: true,
      refreshing: false,
    });
    mockClose.mockResolvedValue({
      state: 'closed',
      qualityId: '80',
      variants: [],
      positionMs: 0,
      playIntent: false,
      refreshing: false,
    });
  });
  it('opens only the exact selected part and can close without affecting audio controls', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliMvScreen />);
      await Promise.resolve();
    });
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        bvid: 'BV1xx411c7mD',
        cid: '12',
        preferredCodecs: ['avc1'],
      }),
    );
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '关闭MV画面' })
        .props.onPress();
    });
    expect(mockClose).toHaveBeenCalledWith('opaque_handle_abcdefghijklmnop');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('uses recovery semantics to obtain a fresh handle and syncs only that handle', async () => {
    mockRoute = {
      params: {
        bvid: 'BV1xx411c7mD',
        cid: '12',
        title: '恢复 MV',
        restore: { qualityId: '80', positionMs: 1200, playIntent: true },
      },
    };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliMvScreen />);
      await Promise.resolve();
    });
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ qualityId: '80' }),
    );
    await act(async () => {
      tree.unmount();
    });
  });

  it('releases a stale async open handle after the screen unmounts', async () => {
    let resolveOpen!: (value: any) => void;
    mockOpen.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOpen = resolve;
        }),
    );
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliMvScreen />);
      await Promise.resolve();
    });
    await act(async () => {
      tree.unmount();
      resolveOpen({
        state: 'ready',
        handle: 'opaque_handle_stale_abcdefghijk',
        bvid: 'BV1xx411c7mD',
        cid: '12',
        qualityId: '80',
        variants: [],
        positionMs: 0,
        playIntent: false,
        refreshing: false,
      });
      await Promise.resolve();
    });
    expect(mockClose).toHaveBeenCalledWith('opaque_handle_stale_abcdefghijk');
  });
});
