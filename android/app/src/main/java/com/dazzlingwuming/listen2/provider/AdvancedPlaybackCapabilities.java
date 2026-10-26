package com.dazzlingwuming.listen2.provider;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Page-safe declaration of optional native playback features. Availability is
 * deliberately separate from a desktop feature's existence: no feature is
 * advertised until Android owns its lifecycle and consent requirements.
 */
public final class AdvancedPlaybackCapabilities {
    private final boolean qualitySelection;
    private final boolean partSelection;
    private final boolean defaultRendition;
    private final boolean mv;
    private final boolean pictureInPicture;
    private final boolean audioEffects;
    private final boolean visualization;
    private final boolean loudness;
    private final boolean deepSeekTranslation;

    public AdvancedPlaybackCapabilities(boolean qualitySelection, boolean partSelection,
            boolean defaultRendition, boolean mv, boolean pictureInPicture, boolean audioEffects,
            boolean visualization, boolean loudness, boolean deepSeekTranslation) {
        this.qualitySelection = qualitySelection;
        this.partSelection = partSelection;
        this.defaultRendition = defaultRendition;
        this.mv = mv;
        this.pictureInPicture = pictureInPicture;
        this.audioEffects = audioEffects;
        this.visualization = visualization;
        this.loudness = loudness;
        this.deepSeekTranslation = deepSeekTranslation;
    }

    /** No Android implementation currently owns these optional feature paths. */
    public static AdvancedPlaybackCapabilities unavailable() {
        return new AdvancedPlaybackCapabilities(false, false, false, false, false, false,
                false, false, false);
    }

    /** Bilibili parts can be selected logically; quality selection remains native-only/unavailable. */
    public static AdvancedPlaybackCapabilities bilibiliPartSelectionOnly() {
        return new AdvancedPlaybackCapabilities(false, true, false, false, false, false,
                false, false, false);
    }

    public Map<String, Object> toMap() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("qualitySelection", qualitySelection);
        result.put("partSelection", partSelection);
        result.put("defaultRendition", defaultRendition);
        result.put("mv", mv);
        result.put("pictureInPicture", pictureInPicture);
        result.put("audioEffects", audioEffects);
        result.put("visualization", visualization);
        result.put("loudness", loudness);
        result.put("deepSeekTranslation", deepSeekTranslation);
        return Collections.unmodifiableMap(result);
    }
}
