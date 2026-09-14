import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { BilibiliDetailScreen } from '../BilibiliDetailScreen';

const mockNavigate = jest.fn();
const mockDetail = jest.fn();
let mockRoute: any = { params: { bvid: 'BV1xx411c7mD', title: '搜索结果' } };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => mockRoute,
}));
jest.mock('../../bilibili/client', () => ({
  bilibiliClient: { videoDetail: (...args: unknown[]) => mockDetail(...args) },
}));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('../../store/playerSlice', () => ({ playTracks: jest.fn() }));
jest.mock('../ScreenLayout', () => ({
  ScreenLayout: ({ children }: any) => <>{children}</>,
  sectionStyles: {
    card: {},
    button: {},
    buttonText: {},
    secondaryButton: {},
    secondaryText: {},
  },
}));

describe('Bilibili exact part flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = { params: { bvid: 'BV1xx411c7mD', title: '搜索结果' } };
  });
  it('renders ordered exact parts instead of choosing the first result', async () => {
    mockDetail.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      title: '视频',
      owner: '作者',
      parts: [
        { cid: '12', page: '1', title: '第一段' },
        { cid: '13', page: '2', title: '第二段' },
      ],
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliDetailScreen />);
    });
    expect(mockDetail).toHaveBeenCalledWith(
      'BV1xx411c7mD',
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(
      tree.root.findByProps({ accessibilityLabel: '播放第二段' }),
    ).toBeTruthy();
  });
});
