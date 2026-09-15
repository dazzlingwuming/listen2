import { NativeModules } from 'react-native';

export type AudioEffectsStatus =
  | 'enabled'
  | 'disabled'
  | 'unavailable'
  | 'invalid-preset';

export type AudioEffectsSnapshot = Readonly<{
  status: AudioEffectsStatus;
  preset: 'neutral' | 'bass' | 'vocal' | 'treble';
  fixedGain: number;
}>;

type NativeEffects = Readonly<{
  capability?: () => Promise<unknown>;
  selectPreset?: (preset: string) => Promise<unknown>;
  reset?: () => Promise<unknown>;
  setVisualizationEnabled?: (enabled: boolean) => Promise<unknown>;
  setFixedNormalizationGain?: (gain: number) => Promise<unknown>;
}>;

const nativeEffects = NativeModules.Listen2AudioEffects as NativeEffects | undefined;
const neutral: AudioEffectsSnapshot = {
  status: 'unavailable',
  preset: 'neutral',
  fixedGain: 1,
};

export function parseAudioEffectsSnapshot(value: unknown): AudioEffectsSnapshot {
  if (!value || typeof value !== 'object') return neutral;
  const record = value as Record<string, unknown>;
  const status = record.status;
  const preset = record.preset;
  const fixedGain = record.fixedGain;
  return {
    status:
      status === 'enabled' || status === 'disabled' || status === 'invalid-preset'
        ? status
        : 'unavailable',
    preset:
      preset === 'bass' || preset === 'vocal' || preset === 'treble'
        ? preset
        : 'neutral',
    fixedGain:
      typeof fixedGain === 'number' && Number.isFinite(fixedGain)
        ? Math.max(0, Math.min(4, fixedGain))
        : 1,
  };
}

async function call(method: keyof NativeEffects, ...args: unknown[]) {
  const target = nativeEffects?.[method];
  if (typeof target !== 'function') return neutral;
  try {
    return parseAudioEffectsSnapshot(await (target as any)(...args));
  } catch {
    return neutral;
  }
}

/** Effects are optional and must never delay RNTP transport startup. */
export const audioEffectsClient = {
  status: () => call('capability'),
  selectPreset: (preset: AudioEffectsSnapshot['preset']) =>
    call('selectPreset', preset),
  reset: () => call('reset'),
  setVisualizationEnabled: (enabled: boolean) =>
    call('setVisualizationEnabled', enabled),
  setFixedNormalizationGain: (gain: number) =>
    call('setFixedNormalizationGain', gain),
};

export function audioEffectsLabel(snapshot: AudioEffectsSnapshot) {
  if (snapshot.status === 'unavailable') return '音效不可用（当前播放会话不支持）';
  if (snapshot.status === 'enabled') return `音效：${snapshot.preset}`;
  return '音效：原声';
}
