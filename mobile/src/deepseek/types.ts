export type DeepSeekVaultState =
  | 'configured'
  | 'not-configured'
  | 'keystore-unavailable'
  | 'corrupt-cleared';

export type DeepSeekErrorCode =
  | 'CACHE_WRITE_FAILED'
  | 'CANCELLED'
  | 'CONFIGURE_UNAVAILABLE'
  | 'CONSENT_REQUIRED'
  | 'CORRUPT_CLEARED'
  | 'INVALID_ALIGNMENT'
  | 'INVALID_KEY'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'INVALID_REVISION'
  | 'KEYSTORE_UNAVAILABLE'
  | 'LYRIC_TOO_LARGE'
  | 'LYRIC_UNAVAILABLE'
  | 'MISSING_KEY'
  | 'NO_TIMED_LINES'
  | 'NOT_CACHED'
  | 'OPERATION_REUSED'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'REQUEST_TOO_LARGE'
  | 'RESPONSE_TOO_LARGE'
  | 'SECURE_STORAGE_CORRUPT'
  | 'SECURE_STORAGE_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'STALE_IDENTITY'
  | 'STALE_REVISION'
  | 'TIMEOUT'
  | 'TOO_MANY_TIMED_LINES';

export interface DeepSeekConsent {
  readonly lyrics: boolean;
  readonly title: boolean;
  readonly artist: boolean;
  readonly possibleCost: boolean;
  readonly cancellation: boolean;
  readonly failureImpact: boolean;
  readonly acceptedAtEpochMs: number;
}

/** Status is intentionally a sealed projection; key presence is never exposed. */
export interface DeepSeekStatus {
  readonly state: DeepSeekVaultState;
  readonly errorCode?: DeepSeekErrorCode;
}

export interface DeepSeekConfigureStatus extends DeepSeekStatus {
  readonly status: 'configured' | 'cancelled';
}

export interface DeepSeekTranslationLine {
  readonly id: string;
  readonly timestamp: string;
  readonly text: string;
}

export interface DeepSeekTranslateRequest {
  readonly operationId: string;
  readonly provider: 'netease' | 'qq' | 'bilibili';
  readonly sourceTrackId: string;
  readonly lyric: string;
  readonly title: string;
  readonly artist: string;
  readonly style: string;
  readonly lyricHash: string;
  readonly trackHash: string;
  /** Semantic source-lyric revision; stale results must never render or cache. */
  readonly revision: number;
  readonly target: 'zh-CN';
  readonly consent: DeepSeekConsent;
  readonly allowNetwork: boolean;
  readonly forceRefresh: boolean;
  /** Required for Bilibili: proves the lyric was selected from a fixed source. */
  readonly matchedProvider?: 'netease' | 'qq';
  readonly matchedCandidateId?: string;
}

export interface DeepSeekTranslateResult {
  readonly status: 'ok' | 'not-cached' | 'error' | 'cancelled';
  readonly errorCode?: DeepSeekErrorCode;
  readonly translationLines?: readonly DeepSeekTranslationLine[];
  readonly revision?: number;
  readonly lyricHash?: string;
  readonly trackHash?: string;
  readonly cacheHit: boolean;
}

export interface DeepSeekTestResult {
  readonly status: 'ok' | 'error' | 'cancelled';
  readonly errorCode?: DeepSeekErrorCode;
}
