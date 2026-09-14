import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { BilibiliMvQualityId } from '../bilibili/types';

/** Semantic recovery data only. It is intentionally not wrapped by redux-persist. */
export type MvSnapshot = Readonly<{
  bvid: string;
  cid: string;
  qualityId: BilibiliMvQualityId;
  positionMs: number;
  playIntent: boolean;
}>;
export type MvState = { snapshot: MvSnapshot | null };
const initialState: MvState = { snapshot: null };

const mvSlice = createSlice({
  name: 'mv',
  initialState,
  reducers: {
    setSnapshot(state, action: PayloadAction<MvSnapshot>) {
      state.snapshot = action.payload;
    },
    clearSnapshot(state) {
      state.snapshot = null;
    },
  },
});

export const mvActions = mvSlice.actions;
export default mvSlice.reducer;
