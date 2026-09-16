import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppDispatch, useAppSelector } from '../store';
import { historyProjectionReceived, hydrationFailed, hydrationStarted, hydrationSucceeded } from '../store/librarySlice';
import { LibraryClientError, libraryClient } from './libraryClient';
import { history } from '../history/history';
import { migrateKnownLegacyLibrary } from './legacyMigration';

type Props = { children: React.ReactNode };

function errorCode(error: unknown) {
  return error instanceof LibraryClientError && error.code !== 'INVALID_REQUEST'
    ? error.code
    : 'INVALID_RESPONSE';
}

/** Blocks library-dependent UI until Room has supplied an authoritative snapshot. */
export function LibraryBootGate({ children }: Props) {
  const dispatch = useAppDispatch();
  const { hydrated, hydrationPending, hydrationError } = useAppSelector(state => state.library);
  const [degraded, setDegraded] = useState(false);
  const hydrate = useCallback(() => {
    dispatch(hydrationStarted());
    (async () => {
      const migration = await libraryClient.getMigrationStatus();
      if (migration.phase === 'not-started' || migration.phase === 'failed') {
        const attemptId = `boot_${Date.now().toString(36)}`;
        const result = await migrateKnownLegacyLibrary(attemptId);
        // An existing legacy payload must not be silently replaced by an invented
        // empty Room projection. Keep the legacy source selected and surface retry.
        if (result.status === 'invalid-legacy' || result.status === 'unconfirmed' || result.status === 'retryable') throw new LibraryClientError('INVALID_RESPONSE');
      }
      return libraryClient.getSnapshot();
    })().then(
      snapshot => {
        setDegraded(false);
        dispatch(hydrationSucceeded(snapshot));
        // History is independent from the library boot authority. Its absence must
        // not turn a valid Room library into a fake empty/error state.
        void history.recentTracks().then(tracks => dispatch(historyProjectionReceived(tracks)));
      },
      error => {
        // A damaged legacy record or a temporarily unavailable Room bridge must
        // never lock the user out of search and playback. The legacy source is
        // retained for a later retry; library-backed actions remain visibly
        // degraded until an authoritative snapshot succeeds.
        setDegraded(true);
        dispatch(hydrationFailed(errorCode(error)));
      },
    );
  }, [dispatch]);
  useEffect(() => { hydrate(); }, [hydrate]);

  if (hydrated) return <>{children}</>;
  if (!degraded) return <View accessibilityLabel="正在加载音乐库" style={styles.container}><Text style={styles.copy}>正在加载音乐库…</Text></View>;
  return <View style={styles.shell}>
    {children}
    <View accessibilityRole="alert" style={styles.warning}>
      <Text style={styles.warningText}>{hydrationPending ? '正在重试恢复音乐库…' : `音乐库恢复失败（${hydrationError || 'INVALID_RESPONSE'}），搜索和播放仍可使用`}</Text>
      {!hydrationPending && <Pressable accessibilityRole="button" onPress={hydrate} style={styles.retry}><Text style={styles.retryText}>重试</Text></Pressable>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  copy: { color: '#e5e7eb', fontSize: 16, textAlign: 'center' },
  retry: { backgroundColor: '#6d5dfc', borderRadius: 8, marginLeft: 12, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: '#ffffff', fontWeight: '700' },
  shell: { flex: 1 },
  warning: { alignItems: 'center', backgroundColor: '#312e81', borderColor: '#818cf8', borderRadius: 12, borderWidth: 1, bottom: 84, flexDirection: 'row', left: 12, padding: 12, position: 'absolute', right: 12, zIndex: 100 },
  warningText: { color: '#ffffff', flex: 1, fontSize: 13 },
});
