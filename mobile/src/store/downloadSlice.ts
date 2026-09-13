import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import { offlineAudio, type DownloadSnapshot } from '../offline/offlineAudio';
import type { PlayableTrack } from '../types/music';
type State = DownloadSnapshot & { hydrated: boolean };
const initialState: State = {
  usedBytes: 0,
  quotaBytes: 512 * 1024 * 1024,
  entries: [],
  hydrated: false,
};
const refresh = async () => offlineAudio.listDownloads();
export const hydrateDownloads = createAsyncThunk('downloads/hydrate', refresh);
export const requestDownload = createAsyncThunk(
  'downloads/request',
  (track: PlayableTrack) => offlineAudio.enqueueDownload(track),
);
export const cancelDownload = createAsyncThunk(
  'downloads/cancel',
  (id: string) => offlineAudio.cancelDownload(id),
);
export const retryDownload = createAsyncThunk(
  'downloads/retry',
  (p: { source: string; trackId: string }) =>
    offlineAudio.retryDownload(p.source, p.trackId),
);
export const removeDownload = createAsyncThunk(
  'downloads/remove',
  (p: { source: string; trackId: string }) =>
    offlineAudio.removeDownload(p.source, p.trackId),
);
export const clearDownloads = createAsyncThunk('downloads/clear', () =>
  offlineAudio.clearDownloads(),
);
const apply = (s: State, a: PayloadAction<DownloadSnapshot>) => {
  s.usedBytes = a.payload.usedBytes;
  s.quotaBytes = a.payload.quotaBytes;
  s.entries = a.payload.entries;
  s.hydrated = true;
};
const slice = createSlice({
  name: 'downloads',
  initialState,
  reducers: { received: apply },
  extraReducers: b =>
    b
      .addCase(hydrateDownloads.fulfilled, apply)
      .addCase(requestDownload.fulfilled, apply)
      .addCase(cancelDownload.fulfilled, apply)
      .addCase(retryDownload.fulfilled, apply)
      .addCase(removeDownload.fulfilled, apply)
      .addCase(clearDownloads.fulfilled, apply),
});
export const downloadActions = slice.actions;
export default slice.reducer;
