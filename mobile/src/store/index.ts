import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import { persistReducer, persistStore } from 'redux-persist';
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

const persistConfig = {
  key: 'listen2-mobile',
  storage: AsyncStorage,
  version: 1,
  // `isPlaying` deliberately remains volatile: reopening the app must not
  // unexpectedly begin audio, while position/queue/mode remain restorable.
  blacklist: ['isPlaying', 'duration', 'bufferedPosition', 'error'],
};

const persistedPlayerReducer = persistReducer(persistConfig, playerReducer);
const persistedLibraryReducer = persistReducer(
  { key: 'listen2-mobile-library', storage: AsyncStorage, version: 1 },
  libraryReducer,
);

export const store = configureStore({
  reducer: {
    player: persistedPlayerReducer,
    library: persistedLibraryReducer,
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

export const persistor = persistStore(store, undefined, () => {
  import('../player/playerController').then(({ playerController }) => {
    playerController.restore().catch(() => undefined);
  });
});
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export default store;
