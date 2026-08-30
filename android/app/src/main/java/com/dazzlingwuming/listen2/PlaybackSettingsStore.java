package com.dazzlingwuming.listen2;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;

/** One named preference file for only small non-sensitive playback settings. */
public final class PlaybackSettingsStore {
    private static final String FILE_NAME = "listen2_playback_settings";
    private static final String VOLUME_PERCENT = "volumePercent";
    private static final String MUTED = "muted";
    private static final int DEFAULT_VOLUME_PERCENT = 100;

    private final SharedPreferences preferences;

    public PlaybackSettingsStore(@NonNull Context context) {
        preferences = context.getApplicationContext().getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE);
    }

    public int getVolumePercent() {
        return clamp(preferences.getInt(VOLUME_PERCENT, DEFAULT_VOLUME_PERCENT));
    }

    public void setVolumePercent(int volumePercent) {
        if (volumePercent < 0 || volumePercent > 100) {
            throw new IllegalArgumentException("volumePercent must be 0 through 100");
        }
        preferences.edit().putInt(VOLUME_PERCENT, volumePercent).apply();
    }

    public boolean isMuted() {
        return preferences.getBoolean(MUTED, false);
    }

    public void setMuted(boolean muted) {
        preferences.edit().putBoolean(MUTED, muted).apply();
    }

    /** Migration seam: future settings storage imports these exact two scalar values only. */
    public SettingsSnapshot snapshotForMigration() {
        return new SettingsSnapshot(getVolumePercent(), isMuted());
    }

    public boolean acceptsKey(String key) {
        return VOLUME_PERCENT.equals(key) || MUTED.equals(key);
    }

    /** Test-only cleanup that still targets this store rather than a global preference namespace. */
    public void clearForTest() {
        preferences.edit().clear().commit();
    }

    private static int clamp(int value) {
        if (value < 0) return 0;
        return Math.min(value, 100);
    }

    public static final class SettingsSnapshot {
        private final int volumePercent;
        private final boolean muted;

        SettingsSnapshot(int volumePercent, boolean muted) {
            this.volumePercent = volumePercent;
            this.muted = muted;
        }

        public int getVolumePercent() { return volumePercent; }
        public boolean isMuted() { return muted; }
    }
}
