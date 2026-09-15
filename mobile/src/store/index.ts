import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import { createMigrate, persistReducer, persistStore } from 'redux-persist';
import {
  FLUSH,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  REHYDRATE,
} from 'redux-persist/es/constants';
import playerReducer from './playerSlice';
import libraryReducer from './librarySlice';
import downloadReducer, { downloadActions } from './downloadSlice';
import { offlineAudio } from '../offline/offlineAudio';
import { configurePlayerController } from '../player/playerController';
import mvReducer from './mvSlice';
import { migratePlayerState, sanitizePlayerState } from './playerPersistence';
import { history } from '../history/history';
import { createContinuityCoordinator, continuitySignature, queueCheckpointFromPlayer } from '../library/continuityCoordinator';
import { historyProjectionReceived, hydrationSucceeded } from './librarySlice';
import { restorePlayNextCheckpoint } from './playerSlice';

const persistConfig = {
  key: 'listen2-mobile',
  storage: AsyncStorage,
  version: 2,
  // `isPlaying` deliberately remains volatile: reopening the app must not
  // unexpectedly begin audio, while position/queue/mode remain restorable.
  blacklist: ['isPlaying', 'duration', 'bufferedPosition', 'error'],
  migrate: createMigrate({ 2: migratePlayerState as any }),
  // Migrations only run for older stored versions. Reconcile every inbound
  // snapshot through the same pure boundary to reject current-version junk.
  stateReconciler: (inboundState: unknown) => sanitizePlayerState(inboundState),
};

const persistedPlayerReducer = persistReducer(persistConfig, playerReducer);
export const store = configureStore({
  reducer: {
    player: persistedPlayerReducer,
    // Room is the only durable owner; Redux is a hydrated projection.
    library: libraryReducer,
    downloads: downloadReducer,
    // MV transport/handles are process-local. This reducer is purposefully volatile.
    mv: mvReducer,
  },
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

configurePlayerController({
  getPlayerState: () => store.getState().player,
  dispatch: store.dispatch,
});

const continuity = createContinuityCoordinator({
  persist: (queueCheckpoint, lyricMetadata, expectedRevision) =>
    import('../library/libraryClient').then(({ libraryClient }) =>
      libraryClient.replaceContinuityMetadata(queueCheckpoint, lyricMetadata, expectedRevision),
    ),
  read: () => import('../library/libraryClient').then(({ libraryClient }) => libraryClient.getSnapshot()),
  onSnapshot: snapshot => store.dispatch(hydrationSucceeded(snapshot)),
});

let observedLibraryRevision: number | null = null;
let observedContinuity = '';
let appliedNativeQueueCheckpoint = false;
let playerRehydrated = false;
const reconcileContinuity = () => {
  let state = store.getState();
  const revision = state.library.revision;
  if (!state.library.hydrated || typeof revision !== 'number') return;
  let nativeQueue = state.library.queueCheckpoint || [];
  let nativeLyrics = state.library.lyricMetadata || [];
  if (observedLibraryRevision !== revision) {
    observedLibraryRevision = revision;
    continuity.hydrate({ revision, queueCheckpoint: nativeQueue, lyricMetadata: nativeLyrics });
  }
  if (!playerRehydrated) return;
  if (!appliedNativeQueueCheckpoint && nativeQueue.length) {
    const canRestore = nativeQueue.some(checkpoint => state.player.playNextQueue.some(item =>
      item.occurrenceId === checkpoint.occurrenceId ||
      (item.track.source === checkpoint.source && item.track.id === checkpoint.trackId),
    ));
    if (canRestore) {
      store.dispatch(restorePlayNextCheckpoint(nativeQueue));
      // Redux subscriptions can run re-entrantly. Re-read the player and
      // library projections after restoring the native checkpoint so the
      // outer callback cannot enqueue the stale pre-restore empty queue.
      state = store.getState();
      nativeQueue = state.library.queueCheckpoint || [];
      nativeLyrics = state.library.lyricMetadata || [];
      appliedNativeQueueCheckpoint = state.player.playNextQueue.length > 0;
    }
  }
  // Do not let the pre-rehydrate default [] erase a native checkpoint. Once
  // the persisted player reducer contains a queue, a real user change may
  // replace an unmatched native checkpoint through the normal CAS path.
  if (nativeQueue.length && !appliedNativeQueueCheckpoint && !state.player.playNextQueue.length) return;
  const queueCheckpoint = queueCheckpointFromPlayer(state.player.playNextQueue);
  const signature = continuitySignature(queueCheckpoint, nativeLyrics);
  if (signature === observedContinuity) return;
  observedContinuity = signature;
  continuity.request(queueCheckpoint, nativeLyrics, revision);
};
store.subscribe(reconcileContinuity);

let recentRefreshGeneration = 0;
const refreshRecentProjection = () => {
  const generation = ++recentRefreshGeneration;
  void history.recentTracks().then(tracks => {
    if (generation === recentRefreshGeneration) store.dispatch(historyProjectionReceived(tracks));
  }).catch(() => undefined);
};
history.subscribeRecent(reason => {
  if (reason === 'clear') store.dispatch(historyProjectionReceived([]));
  refreshRecentProjection();
});
offlineAudio.subscribe(snapshot =>
  store.dispatch(downloadActions.received(snapshot)),
);

export const persistor = persistStore(store, undefined, () => {
  playerRehydrated = true;
  reconcileContinuity();
  import('../player/playerController').then(({ playerController }) => {
    playerController.restore().catch(() => undefined);
  });
});
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export default store;
