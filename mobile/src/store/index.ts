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
let observedLocalProjection = '';
let observedContinuity = '';
let appliedNativeQueueCheckpoint = false;
let attemptedNativeQueueRestore = false;
let nativeQueueRestorePending = false;
let playerRehydrated = false;
const reconcileContinuity = () => {
  let state = store.getState();
  const revision = state.library.revision;
  if (!state.library.hydrated || typeof revision !== 'number') return;
  let nativeQueue = state.library.queueCheckpoint || [];
  let nativeLyrics = state.library.lyricMetadata || [];
  const localProjection = JSON.stringify(state.library.localTracks || []);
  if (localProjection !== observedLocalProjection) {
    observedLocalProjection = localProjection;
    if (nativeQueueRestorePending) {
      attemptedNativeQueueRestore = false;
      appliedNativeQueueCheckpoint = false;
    }
  }
  if (observedLibraryRevision !== revision) {
    observedLibraryRevision = revision;
    continuity.hydrate({ revision, queueCheckpoint: nativeQueue, lyricMetadata: nativeLyrics });
    if (nativeQueueRestorePending) {
      attemptedNativeQueueRestore = false;
      appliedNativeQueueCheckpoint = false;
    }
  }
  if (!playerRehydrated) return;
  if (!nativeQueue.length) {
    nativeQueueRestorePending = false;
    attemptedNativeQueueRestore = false;
    appliedNativeQueueCheckpoint = false;
  }
  if (!attemptedNativeQueueRestore && nativeQueue.length) {
    // Room is the durable owner. Do not require an occurrence from the old
    // Redux projection before dispatching: a restart can legitimately leave
    // that projection empty, and the reducer has a semantic remote fallback.
    attemptedNativeQueueRestore = true;
    store.dispatch(
      restorePlayNextCheckpoint({
        checkpoints: nativeQueue,
        localTracks: state.library.localTracks || [],
      }),
    );
    // Redux subscriptions can run re-entrantly. Re-read the player and
    // library projections after restoring the native checkpoint so the
    // outer callback cannot enqueue a stale or partial queue projection.
    state = store.getState();
    nativeQueue = state.library.queueCheckpoint || [];
    nativeLyrics = state.library.lyricMetadata || [];
    const matchesCheckpoint = (checkpoint: (typeof nativeQueue)[number]) =>
      state.player.playNextQueue.some(
        item =>
          item.resolutionState !== 'unresolved' &&
          (item.occurrenceId === checkpoint.occurrenceId ||
            (item.track.source === checkpoint.source &&
              item.track.id === checkpoint.trackId)),
      );
    appliedNativeQueueCheckpoint = nativeQueue.every(matchesCheckpoint);
    nativeQueueRestorePending = nativeQueue.some(
      checkpoint => !matchesCheckpoint(checkpoint),
    );
  }
  // Do not let an empty or partial old Redux projection erase native rows.
  // Local checkpoints that cannot be resolved from the native catalog remain
  // explicitly unresolved until a later, authoritative reconciliation.
  if (
    nativeQueue.length &&
    !appliedNativeQueueCheckpoint &&
    nativeQueue.some(
      checkpoint =>
        !state.player.playNextQueue.some(
          item =>
            item.resolutionState !== 'unresolved' &&
            (item.occurrenceId === checkpoint.occurrenceId ||
              (item.track.source === checkpoint.source &&
                item.track.id === checkpoint.trackId)),
        ),
    )
  )
    return;
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
