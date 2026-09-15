import React from 'react';
import { act, create } from 'react-test-renderer';
import { AccountSourcesScreen } from '../SettingsScreen';

const mockStatus = jest.fn();
const mockBegin = jest.fn();
const mockPoll = jest.fn();
const mockCancel = jest.fn();
const mockLogout = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => ({}) }));
jest.mock('../ScreenLayout', () => ({
  ScreenLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sectionStyles: { section: {}, card: {}, button: {}, buttonText: {}, secondaryButton: {}, secondaryText: {} },
}));
jest.mock('../../bilibili/client', () => ({
  bilibiliClient: {
    status: (...args: unknown[]) => mockStatus(...args),
    qrBegin: (...args: unknown[]) => mockBegin(...args),
    qrPoll: (...args: unknown[]) => mockPoll(...args),
    qrCancel: (...args: unknown[]) => mockCancel(...args),
    logout: (...args: unknown[]) => mockLogout(...args),
  },
}));

const unauthenticated = {
  status: 'unauthenticated' as const,
  attemptId: '', expiresAt: 0, qrPngDataUri: '', retryable: true, nextAction: 'begin' as const,
};

describe('fixed account matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus.mockResolvedValue(unauthenticated);
  });

  it('renders the locked seven sources and only exposes Bilibili authentication', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<AccountSourcesScreen />); });
    const text = JSON.stringify(tree.toJSON());
    for (const label of ['QQ音乐', '酷狗音乐', '酷我音乐', '咪咕音乐', 'Taihe', '哔哩哔哩', '网易云音乐']) expect(text).toContain(label);
    expect(tree.root.findAllByProps({ accessibilityLabel: '开始 Bilibili 扫码登录' }).length).toBeGreaterThan(0);
    expect(text).toContain('当前没有可验证的手机端登录能力');
  });

  it('starts a new QR attempt through the public Bilibili client only', async () => {
    mockBegin.mockResolvedValue({ ...unauthenticated, status: 'waiting', attemptId: 'attempt-1', qrPngDataUri: 'data:image/png;base64,AA' });
    mockPoll.mockResolvedValue({ ...unauthenticated, status: 'cancelled', nextAction: 'begin' });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<AccountSourcesScreen />); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: '开始 Bilibili 扫码登录' }).props.onPress(); });
    expect(mockBegin).toHaveBeenCalledTimes(1);
    expect(mockPoll).toHaveBeenCalledWith('attempt-1');
  });
});
