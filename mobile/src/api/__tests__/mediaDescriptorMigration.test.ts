import { validateNativeMediaDescriptor } from '../nativePlayback';
import type { SourceId } from '../../types';

declare const require: (moduleName: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (file: string, encoding: string) => string };
const path = require('path') as { join: (...parts: string[]) => string };

const AUTHORITY = 'com.dazzlingwuming.listen2.media';
const LEASE_ID = 'a'.repeat(48);
const REQUEST_ID = 'media-netease-fixture';
const TRACK_ID = 'netrack_42';

function descriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    requestId: REQUEST_ID,
    source: 'netease' satisfies SourceId,
    semanticTrackId: TRACK_ID,
    generation: 2,
    playableUri: `content://${AUTHORITY}/lease/${LEASE_ID}`,
    mimeType: 'audio/mpeg',
    container: 'mp3',
    codec: 'mp3',
    durationMs: 123000,
    selectedRenditionId: 'default',
    renditions: [
      {
        id: 'default',
        label: 'authorized',
        mimeType: 'audio/mpeg',
        container: 'mp3',
        codec: 'mp3',
        durationMs: 123000,
      },
    ],
    entitlementStatus: 'allowed',
    leaseExpiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

const expected = {
  id: TRACK_ID,
  source: 'netease' as const,
  requestId: REQUEST_ID,
};

describe('native media descriptor migration', () => {
  it('has no retired raw-track contract in production or focused fixtures', () => {
    const files = [
      '../client.ts',
      '../providers.ts',
      '../nativePlayback.ts',
      '../../types/music.ts',
      '../../types/provider.ts',
      '../../bilibili/client.ts',
      '../../player/playerController.ts',
      './client.test.ts',
      '../../bilibili/__tests__/client.test.ts',
      '../../player/__tests__/playerController.test.ts',
      '../../player/__tests__/playerController.bilibiliRetry.test.ts',
    ];
    for (const relative of files) {
      const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
      const retiredType = ['Bootstrap', 'Track'].join('');
      const retiredCall = ['bootstrap', 'Track'].join('');
      expect(source).not.toContain(retiredType);
      expect(source).not.toContain(retiredCall);
    }
  });

  it('accepts only the exact app-owned descriptor shape', () => {
    expect(validateNativeMediaDescriptor(descriptor(), expected)).toEqual(
      expect.objectContaining({
        version: 1,
        source: 'netease',
        semanticTrackId: TRACK_ID,
        playableUri: `content://${AUTHORITY}/lease/${LEASE_ID}`,
        entitlementStatus: 'allowed',
      }),
    );
  });

  it.each([
    ['extra top-level key', { url: 'https://provider.invalid/audio.mp3' }],
    [
      'unsafe URI authority',
      { playableUri: 'content://other.application.media/lease/' + LEASE_ID },
    ],
    ['missing codec', { codec: undefined }],
    ['forged rendition', { selectedRenditionId: 'premium' }],
    ['expired lease', { leaseExpiresAt: Date.now() - 1 }],
    ['denied entitlement', { entitlementStatus: 'membership-required' }],
  ])('rejects %s before player handoff', (_name, changes) => {
    expect(() => validateNativeMediaDescriptor(descriptor(changes), expected)).toThrow(
      'INVALID_RESPONSE',
    );
  });

  it('rejects forged Bilibili part membership', () => {
    const bilibili = {
      ...descriptor({
        source: 'bilibili',
        semanticTrackId: 'bitrack_v_BV1xx411c7mD-456',
        partId: '999',
      }),
    };
    expect(() =>
      validateNativeMediaDescriptor(bilibili, {
        id: 'bitrack_v_BV1xx411c7mD-456',
        source: 'bilibili',
        requestId: REQUEST_ID,
      }),
    ).toThrow('INVALID_RESPONSE');
  });
});
