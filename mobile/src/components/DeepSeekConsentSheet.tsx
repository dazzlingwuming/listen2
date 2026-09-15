import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import { createDeepSeekConsent } from '../deepseek/consent';
import type { DeepSeekConsentChoices } from '../deepseek/consent';
import type { DeepSeekConsent } from '../deepseek/types';
import { colors, spacing, text } from '../theme';

const EMPTY_CHOICES: DeepSeekConsentChoices = {
  lyrics: false,
  title: false,
  artist: false,
  possibleCost: false,
  cancellation: false,
  failureImpact: false,
};

const DISCLOSURES: Array<[keyof DeepSeekConsentChoices, string]> = [
  ['lyrics', '将发送当前完整同步歌词'],
  ['title', '将发送歌曲标题'],
  ['artist', '将发送歌手名称'],
  ['possibleCost', '此请求可能产生 API 费用'],
  ['cancellation', '确认前取消不会发送请求；切歌或关闭时可取消'],
  ['failureImpact', '失败不会替换或保存当前译文'],
];

export function DeepSeekConsentSheet({
  visible,
  title,
  artist,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  artist: string;
  onClose: () => void;
  onConfirm: (consent: DeepSeekConsent) => void;
}) {
  const [choices, setChoices] = useState<DeepSeekConsentChoices>(EMPTY_CHOICES);
  useEffect(() => {
    if (!visible) setChoices(EMPTY_CHOICES);
  }, [visible]);
  const complete = Object.values(choices).every(Boolean);
  const close = () => {
    setChoices(EMPTY_CHOICES);
    onClose();
  };
  return (
    <Sheet onClose={close} title="将当前歌词发送给 DeepSeek？" visible={visible}>
      <View style={styles.content}>
        <Text style={text.body}>
          当前歌曲：{title} · {artist}
        </Text>
        <Text style={text.meta}>
          这会发送当前完整同步歌词、歌曲标题和歌手名称给 DeepSeek。请求可能产生 API
          费用；确认前取消不会发送请求，失败不会替换或保存当前译文。
        </Text>
        {DISCLOSURES.map(([key, label]) => (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: choices[key] }}
            key={key}
            onPress={() =>
              setChoices(current => ({ ...current, [key]: !current[key] }))
            }
            style={styles.choice}
          >
            <Text style={styles.check}>{choices[key] ? '✓' : '○'}</Text>
            <Text style={text.body}>{label}</Text>
          </Pressable>
        ))}
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="取消，不发送"
            accessibilityRole="button"
            hasTVPreferredFocus
            onPress={close}
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>取消，不发送</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="同意并翻译"
            accessibilityRole="button"
            disabled={!complete}
            onPress={() => onConfirm(createDeepSeekConsent(choices))}
            style={[styles.confirm, !complete && styles.disabled]}
          >
            <Text style={styles.confirmText}>同意并翻译</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  choice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  check: { color: colors.accent, fontSize: 22, width: 28 },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  cancel: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  cancelText: { color: colors.text, fontWeight: '600' },
  confirm: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
  confirmText: { color: colors.background, fontWeight: '700' },
});
