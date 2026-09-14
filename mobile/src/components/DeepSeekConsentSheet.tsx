import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import { createDeepSeekConsent } from '../deepseek/consent';
import type { DeepSeekConsentChoices } from '../deepseek/consent';
import type { DeepSeekConsent } from '../deepseek/types';
import { colors, spacing, text } from '../theme';

const DISCLOSURES: Array<[keyof DeepSeekConsentChoices, string]> = [
  ['lyrics', '将发送当前完整同步歌词'],
  ['title', '将发送歌曲标题'],
  ['artist', '将发送歌手名称'],
  ['possibleCost', '此请求可能产生 API 费用'],
  ['cancellation', '切歌或关闭时可取消请求'],
  ['failureImpact', '失败时会保留原歌词，不会伪造译文'],
];

export function DeepSeekConsentSheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (consent: DeepSeekConsent) => void;
}) {
  const [choices, setChoices] = useState<DeepSeekConsentChoices>({
    lyrics: false,
    title: false,
    artist: false,
    possibleCost: false,
    cancellation: false,
    failureImpact: false,
  });
  const complete = Object.values(choices).every(Boolean);
  return (
    <Sheet onClose={onClose} title="使用 DeepSeek 翻译歌词" visible={visible}>
      <View style={styles.content}>
        <Text style={text.meta}>
          仅本次确认后才会联网；不会在加载歌词或播放时自动请求。
        </Text>
        {DISCLOSURES.map(([key, label]) => (
          <Pressable
            accessibilityLabel={label}
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
        <Pressable
          accessibilityLabel="确认使用 DeepSeek 翻译"
          disabled={!complete}
          onPress={() => onConfirm(createDeepSeekConsent(choices))}
          style={[styles.confirm, !complete && styles.disabled]}
        >
          <Text style={styles.confirmText}>确认并翻译</Text>
        </Pressable>
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
  confirm: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  disabled: { opacity: 0.45 },
  confirmText: { color: colors.background, fontWeight: '700' },
});
