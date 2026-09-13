const COPY: Readonly<Record<string, string>> = {
  QUEUE_FULL: '下载任务已满，请等待当前任务完成后重试。',
  CAPACITY_EXCEEDED: '离线空间不足，请删除已下载内容后重试。',
  QUOTA_EXCEEDED: '离线空间不足，请删除已下载内容后重试。',
  FILE_TOO_LARGE: '文件超过离线下载大小限制，请选择其他音源。',
  CANCELLED: '下载已取消，可随时重新下载。',
  NETWORK: '网络连接不稳定，请检查网络后重试。',
  DEADLINE_EXCEEDED: '网络连接不稳定，请检查网络后重试。',
  PROVIDER_REJECTED: '音源暂不可下载，请稍后重试或更换音源。',
  ENTITLEMENT: '音源暂不可下载，请稍后重试或更换音源。',
  CORRUPT: '离线文件不可用，请移除后重新下载。',
  UNAVAILABLE: '离线文件不可用，请移除后重新下载。',
  INTERRUPTED: '下载中断，请重试。',
};

export function offlineDownloadErrorCopy(
  errorCode: string | null,
): string | null {
  if (!errorCode) return null;
  return COPY[errorCode] || '下载失败，请重试。';
}
