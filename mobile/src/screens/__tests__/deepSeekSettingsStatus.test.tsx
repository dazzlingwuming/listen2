import {
  deepSeekCanConfigure,
  deepSeekCanTest,
  deepSeekStatusLabel,
} from '../SettingsScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

describe('DeepSeek Settings status-only flow', () => {
  it('renders fail-closed storage status without exposing key state', () => {
    const unavailable = {
      state: 'keystore-unavailable' as const,
      errorCode: 'KEYSTORE_UNAVAILABLE' as const,
    };
    expect(deepSeekStatusLabel(unavailable)).toBe(
      '当前设备无法安全保存 DeepSeek 密钥，因此翻译功能已停用。',
    );
    expect(deepSeekCanConfigure(unavailable)).toBe(false);
    expect(deepSeekCanTest(unavailable)).toBe(false);
    expect(deepSeekStatusLabel({ state: 'configured' })).toBe('已配置');
    expect(deepSeekStatusLabel({ state: 'not-configured' })).toBe('未配置');
  });

  it('allows testing only from configured status', () => {
    expect(deepSeekCanTest({ state: 'configured' })).toBe(true);
    expect(deepSeekCanConfigure({ state: 'not-configured' })).toBe(true);
    expect(deepSeekCanConfigure({ state: 'corrupt-cleared' })).toBe(true);
  });
});
