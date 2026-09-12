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
