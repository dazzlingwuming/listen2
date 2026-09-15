import type {
  ProviderErrorCode,
  ProviderErrorShape,
  ProviderOperation,
  SourceId,
} from '../types';

export class ProviderClientError extends Error implements ProviderErrorShape {
  readonly code: ProviderErrorCode;
  readonly source: SourceId;
  readonly operation: ProviderOperation;
  readonly retryable: boolean;
  readonly action: ProviderErrorShape['action'];

  constructor(
    code: ProviderErrorCode,
    source: SourceId,
    operation: ProviderOperation,
    options: Partial<Pick<ProviderErrorShape, 'retryable' | 'action'>> = {},
  ) {
    super(code);
    this.name = 'ProviderClientError';
    this.code = code;
    this.source = source;
    this.operation = operation;
    this.retryable =
      options.retryable ??
      (code === 'REQUEST_TIMEOUT' || code === 'NETWORK_ERROR');
    this.action =
      options.action ?? (this.retryable ? 'retry' : 'not-available');
  }
}

export function unavailable(
  source: SourceId,
  operation: ProviderOperation,
  code: Extract<
    ProviderErrorCode,
    'ROUTE_UNAVAILABLE' | 'PLAYBACK_UNAVAILABLE' | 'LYRIC_UNAVAILABLE'
  >,
): ProviderClientError {
  return new ProviderClientError(code, source, operation, { retryable: false });
}

export type ProviderErrorPresentation = {
  terminal:
    | 'timeout'
    | 'cancelled'
    | 'offline'
    | 'malformed'
    | 'login-required'
    | 'authorization'
    | 'unavailable'
    | 'provider-error';
  title: string;
  message: string;
  action: 'retry' | 'sign-in' | 'choose-another-source' | 'return';
};

/** Maps only stable error codes to product copy; remote payloads never reach UI. */
export function presentProviderError(
  error: unknown,
): ProviderErrorPresentation {
  const code =
    error instanceof ProviderClientError ? error.code : 'PROVIDER_ERROR';
  if (code === 'REQUEST_TIMEOUT')
    return {
      terminal: 'timeout',
      title: '请求超时',
      message: '请稍后重试。',
      action: 'retry',
    };
  if (code === 'CANCELLED')
    return {
      terminal: 'cancelled',
      title: '已取消',
      message: '搜索范围已保留。',
      action: 'retry',
    };
  if (code === 'NETWORK_ERROR')
    return {
      terminal: 'offline',
      title: '网络不可用',
      message: '请检查网络后重试。',
      action: 'retry',
    };
  if (code === 'INVALID_RESPONSE')
    return {
      terminal: 'malformed',
      title: '来源返回异常',
      message: '请重试或选择其他来源。',
      action: 'choose-another-source',
    };
  if (code === 'LOGIN_REQUIRED')
    return {
      terminal: 'login-required',
      title: '需要登录',
      message: '请先登录该来源。',
      action: 'sign-in',
    };
  if (
    code === 'MEMBERSHIP_REQUIRED' ||
    code === 'DRM_RESTRICTED' ||
    code === 'REGION_RESTRICTED'
  )
    return {
      terminal: 'authorization',
      title: '当前账号无法使用',
      message: '请选择其他可用内容。',
      action: 'choose-another-source',
    };
  if (
    code === 'ROUTE_UNAVAILABLE' ||
    code === 'PLAYBACK_UNAVAILABLE' ||
    code === 'LYRIC_UNAVAILABLE'
  )
    return {
      terminal: 'unavailable',
      title: '该操作暂不可用',
      message: '此来源尚无已验证的授权路径。',
      action: 'choose-another-source',
    };
  return {
    terminal: 'provider-error',
    title: '来源暂时不可用',
    message: '请重试或选择其他来源。',
    action: 'retry',
  };
}
