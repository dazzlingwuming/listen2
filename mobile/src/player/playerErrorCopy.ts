const COPY: Readonly<Record<string, string>> = {
  NETWORK_ERROR: '网络连接异常，请检查网络后重试。',
  PROVIDER_ERROR: '音源暂不可用，请稍后重试。',
  ROUTE_UNAVAILABLE: '当前音源暂不可播放。',
  PLAYBACK_UNAVAILABLE: '当前音源暂不可播放。',
  'offline-media-unavailable': '离线媒体不可用，正在尝试在线播放。',
  'local-media-unavailable': '本地音频无法访问，请重新授权文件访问。',
  'playback-unavailable': '播放暂不可用，请稍后重试。',
  'native-playback-error': '播放器发生错误，请重试。',
  'seek-unavailable': '暂时无法跳转播放进度。',
  'volume-unavailable': '暂时无法调整音量。',
  'mode-unavailable': '暂时无法切换播放模式。',
};

export function playerErrorCopy(error: string | null): string | null {
  if (!error) return null;
  return COPY[error] || '播放暂不可用，请稍后重试。';
}
