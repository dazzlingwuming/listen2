package com.dazzlingwuming.listen2;

import com.dazzlingwuming.listen2.data.LocalDataRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Semantic library rows become native queue entries without requesting every video's manifest. */
final class SavedPlaylistQueue {
    private static final Pattern BILI = Pattern.compile("(BV[0-9A-Za-z]{6,32})(?:-([1-9][0-9]{0,17}))?");
    static List<PlaybackMediaResolver.Descriptor> descriptors(LocalDataRepository.PlaylistView playlist) {
        if (playlist == null || playlist.tracks.isEmpty() || playlist.tracks.size() > 5000)
            throw new IllegalArgumentException("EMPTY_PLAYLIST");
        List<PlaybackMediaResolver.Descriptor> result = new ArrayList<>();
        for (LocalDataRepository.Track track : playlist.tracks) {
            Matcher id = BILI.matcher(track.providerTrackId);
            if (!"bilibili".equals(track.source) || !id.matches()) throw new IllegalArgumentException("UNSUPPORTED_TRACK");
            result.add(new PlaybackMediaResolver.Descriptor("bilibili", id.group(1),
                    id.group(2) == null ? 0L : Long.parseLong(id.group(2)), label(track.title, "未命名视频"),
                    label(track.artist, "哔哩哔哩"), Math.max(0, Math.min(28_800_000, track.durationMs)), "audio"));
        }
        return result;
    }
    private static String label(String value, String fallback) {
        String text = value == null ? "" : value.replaceAll("[\\p{Cntrl}<>]", " ").trim();
        return text.isEmpty() ? fallback : text.substring(0, Math.min(256, text.length()));
    }
}
