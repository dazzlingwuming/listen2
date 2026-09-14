import { createDeepSeekConsent, hasCompleteDeepSeekConsent } from '../consent';

describe('DeepSeek consent', () => {
  it('requires all six disclosures and a fresh acceptance timestamp', () => {
    const consent = createDeepSeekConsent(
      {
        lyrics: true,
        title: true,
        artist: true,
        possibleCost: true,
        cancellation: true,
        failureImpact: true,
      },
      1700000000000,
    );
    expect(hasCompleteDeepSeekConsent(consent)).toBe(true);
    expect(
      hasCompleteDeepSeekConsent({ ...consent, cancellation: false }),
    ).toBe(false);
    expect(
      hasCompleteDeepSeekConsent({ ...consent, acceptedAtEpochMs: 0 }),
    ).toBe(false);
  });
});
