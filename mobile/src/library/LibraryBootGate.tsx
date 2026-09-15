import React, { useCallback, useEffect } from 'react';
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
        dispatch(hydrationSucceeded(snapshot));
        // History is independent from the library boot authority. Its absence must
        // not turn a valid Room library into a fake empty/error state.
        void history.recentTracks().then(tracks => dispatch(historyProjectionReceived(tracks)));
      },
      error => dispatch(hydrationFailed(errorCode(error))),
    );
  }, [dispatch]);
  useEffect(() => { hydrate(); }, [hydrate]);

  if (hydrated) return <>{children}</>;
  if (hydrationPending) return <View accessibilityLabel="正在加载音乐库" style={styles.container}><Text style={styles.copy}>正在加载音乐库…</Text></View>;
  return <View style={styles.container}>
    <Text accessibilityRole="alert" style={styles.copy}>音乐库暂时不可用（{hydrationError || 'INVALID_RESPONSE'}）</Text>
    <Pressable accessibilityRole="button" onPress={hydrate} style={styles.retry}><Text style={styles.retryText}>重试</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  copy: { color: '#e5e7eb', fontSize: 16, textAlign: 'center' },
  retry: { backgroundColor: '#6d5dfc', borderRadius: 10, marginTop: 16, paddingHorizontal: 22, paddingVertical: 12 },
  retryText: { color: '#ffffff', fontWeight: '700' },
});
