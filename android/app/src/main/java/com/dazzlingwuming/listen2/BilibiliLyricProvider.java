package com.dazzlingwuming.listen2;

import java.net.URISyntaxException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Resolves a Bilibili selection to a verified primary lyric without exposing a
 * lyric URL, provider request, cookie, or provider response to a caller.
 *
 * <p>The current implementation intentionally uses the existing closed
 * NetEase native search and primary-lyric routes as a candidate catalog. It
 * does not accept a caller-selected endpoint and it does not try to recover a
 * Bilibili player-response lyric URL. A caller must provide the already-known
 * semantic Bilibili selection; this class is a native/provider seam and is
 * deliberately independent of the WebView RPC contract.</p>
 */
final class BilibiliLyricProvider {
    private static final int MAX_TEXT_BYTES = 256;
    private static final int MAX_ID_LENGTH = 128;
    private static final int MAX_CANDIDATES = 10;
    private static final int MAX_LYRIC_BYTES = 512 * 1024;
    private static final int MAX_DURATION_SECONDS = 28_800;
    private static final double MIN_TITLE_SCORE = 0.92d;
    private static final double MIN_ARTIST_SCORE = 0.88d;
    private static final double MIN_MATCH_SCORE = 0.93d;

    interface CancellationSignal {
        boolean isCancelled();
    }

    interface NetEaseCatalog {
        CatalogResult<List<Candidate>> search(String title, String artist);

        CatalogResult<Lyric> fetchPrimaryLyric(String providerTrackId);
    }

    enum CatalogStatus {
        OK,
        NO_RESULT,
        TIMEOUT,
        CANCELLED,
        PROVIDER_FAILURE,
        MALFORMED_PROVIDER_RESPONSE
    }

    enum Status {
        FOUND,
        NO_LYRIC,
        TIMEOUT,
        CANCELLED,
        PROVIDER_FAILURE,
        INVALID_SELECTION
    }

    static final class Selection {
        final String bvid;
        final long cid;
        final String title;
        final String artist;
        final long durationSeconds;
        final String selectionIdentity;

        Selection(String bvid, long cid, String title, String artist, long durationSeconds,
                String selectionIdentity) {
            this.bvid = bvid;
            this.cid = cid;
            this.title = title;
            this.artist = artist;
            this.durationSeconds = durationSeconds;
            this.selectionIdentity = selectionIdentity;
        }

        boolean isValid() {
            return isBvid(bvid) && cid > 0L && cid <= Long.MAX_VALUE / 2L
                    && isSafeText(title) && isSafeText(artist)
                    && durationSeconds > 0L && durationSeconds <= MAX_DURATION_SECONDS
                    && isSafeIdentity(selectionIdentity);
        }
    }

    static final class Candidate {
        final String providerTrackId;
        final String title;
        final String artist;
        final long durationSeconds;

        Candidate(String providerTrackId, String title, String artist, long durationSeconds) {
            this.providerTrackId = providerTrackId;
            this.title = title;
            this.artist = artist;
            this.durationSeconds = durationSeconds;
        }

        boolean isValid() {
            return providerTrackId != null && providerTrackId.matches("[1-9][0-9]{0,17}")
                    && isSafeText(title) && isSafeText(artist)
                    && durationSeconds > 0L && durationSeconds <= MAX_DURATION_SECONDS;
        }
    }

    static final class Lyric {
        final String lrc;
        final String tlyric;

        Lyric(String lrc, String tlyric) {
            this.lrc = lrc;
            this.tlyric = tlyric == null ? "" : tlyric;
        }
    }

    static final class CatalogResult<T> {
        final CatalogStatus status;
        final T value;

        private CatalogResult(CatalogStatus status, T value) {
            this.status = status;
            this.value = value;
        }

        static <T> CatalogResult<T> success(T value) {
            return new CatalogResult<>(CatalogStatus.OK, value);
        }

        static <T> CatalogResult<T> failure(CatalogStatus status) {
            return new CatalogResult<>(status == null ? CatalogStatus.PROVIDER_FAILURE : status, null);
        }
    }

    /** A bounded result type containing only renderable lyric data and match metadata. */
    static final class Resolution {
        final Status status;
        final String errorCode;
        final String source;
        final String lrc;
        final String tlyric;
        final String matchedTitle;
        final String matchedArtist;
        final long matchedDurationSeconds;
        final int matchScorePercent;

        private Resolution(Status status, String errorCode, String source, String lrc, String tlyric,
                String matchedTitle, String matchedArtist, long matchedDurationSeconds,
                int matchScorePercent) {
            this.status = status;
            this.errorCode = errorCode;
            this.source = source;
            this.lrc = lrc;
            this.tlyric = tlyric;
            this.matchedTitle = matchedTitle;
            this.matchedArtist = matchedArtist;
            this.matchedDurationSeconds = matchedDurationSeconds;
            this.matchScorePercent = matchScorePercent;
        }

        static Resolution found(Candidate candidate, double score, Lyric lyric) {
            return new Resolution(Status.FOUND, null, "netease-primary-for-bilibili", lyric.lrc,
                    lyric.tlyric, candidate.title, candidate.artist, candidate.durationSeconds,
                    (int) Math.round(score * 100d));
        }

        static Resolution failure(Status status, String errorCode) {
            return new Resolution(status, errorCode, null, null, null, null, null, 0L, 0);
        }

        boolean isFound() {
            return status == Status.FOUND;
        }
    }

    private final NetEaseCatalog catalog;

    BilibiliLyricProvider() {
        this(new NativeNetEaseCatalog(new NetEaseNativeProvider()));
    }

    BilibiliLyricProvider(NetEaseCatalog catalog) {
        this.catalog = catalog == null ? new UnavailableCatalog() : catalog;
    }

    Resolution resolve(Selection selection, CancellationSignal cancellation) {
        if (selection == null || !selection.isValid()) {
            return Resolution.failure(Status.INVALID_SELECTION, "INVALID_SELECTION");
        }
        if (isCancelled(cancellation)) return cancelled();

        CatalogResult<List<Candidate>> searched = catalog.search(selection.title, selection.artist);
        if (isCancelled(cancellation)) return cancelled();
        if (searched == null) return providerFailure(CatalogStatus.PROVIDER_FAILURE);
        if (searched.status != CatalogStatus.OK) return catalogFailure(searched.status);

        Candidate matched = bestMatch(selection, searched.value);
        if (matched == null) return Resolution.failure(Status.NO_LYRIC, "NO_HIGH_CONFIDENCE_MATCH");
        if (isCancelled(cancellation)) return cancelled();

        CatalogResult<Lyric> lyricResult = catalog.fetchPrimaryLyric(matched.providerTrackId);
        if (isCancelled(cancellation)) return cancelled();
        if (lyricResult == null) return providerFailure(CatalogStatus.PROVIDER_FAILURE);
        if (lyricResult.status != CatalogStatus.OK) return catalogFailure(lyricResult.status);
        if (!isSafeLrc(lyricResult.value == null ? null : lyricResult.value.lrc)
                || !isSafeOptionalLrc(lyricResult.value.tlyric)) {
            return Resolution.failure(Status.PROVIDER_FAILURE, "MALFORMED_PROVIDER_RESPONSE");
        }

        return Resolution.found(matched, score(selection, matched), lyricResult.value);
    }

    private static Resolution cancelled() {
        return Resolution.failure(Status.CANCELLED, "CANCELLED");
    }

    private static Resolution catalogFailure(CatalogStatus status) {
        if (status == CatalogStatus.NO_RESULT) return Resolution.failure(Status.NO_LYRIC, "NO_LYRIC");
        if (status == CatalogStatus.TIMEOUT) return Resolution.failure(Status.TIMEOUT, "TIMEOUT");
        if (status == CatalogStatus.CANCELLED) return cancelled();
        return providerFailure(status);
    }

    private static Resolution providerFailure(CatalogStatus status) {
        return Resolution.failure(Status.PROVIDER_FAILURE,
                status == CatalogStatus.MALFORMED_PROVIDER_RESPONSE
                        ? "MALFORMED_PROVIDER_RESPONSE" : "PROVIDER_FAILURE");
    }

    private static Candidate bestMatch(Selection selection, List<Candidate> candidates) {
        if (candidates == null || candidates.isEmpty() || candidates.size() > MAX_CANDIDATES) return null;
        Candidate best = null;
        double bestScore = 0d;
        for (Candidate candidate : candidates) {
            if (candidate == null || !candidate.isValid()) continue;
            double title = textScore(selection.title, candidate.title);
            double artist = textScore(selection.artist, candidate.artist);
            double duration = durationScore(selection.durationSeconds, candidate.durationSeconds);
            double score = title * 0.65d + artist * 0.25d + duration * 0.10d;
            if (title < MIN_TITLE_SCORE || artist < MIN_ARTIST_SCORE || duration <= 0d
                    || score < MIN_MATCH_SCORE) continue;
            if (score > bestScore) {
                best = candidate;
                bestScore = score;
            }
        }
        return best;
    }

    private static double score(Selection selection, Candidate candidate) {
        return textScore(selection.title, candidate.title) * 0.65d
                + textScore(selection.artist, candidate.artist) * 0.25d
                + durationScore(selection.durationSeconds, candidate.durationSeconds) * 0.10d;
    }

    private static double durationScore(long expected, long actual) {
        long difference = Math.abs(expected - actual);
        long allowed = Math.max(10L, Math.round(expected * 0.10d));
        if (difference > allowed) return 0d;
        return 1d - ((double) difference / (double) Math.max(1L, allowed)) * 0.10d;
    }

    private static double textScore(String expected, String actual) {
        String normalizedExpected = normalized(expected);
        String normalizedActual = normalized(actual);
        if (normalizedExpected.isEmpty() || normalizedActual.isEmpty()) return 0d;
        if (normalizedExpected.equals(normalizedActual)) return 1d;
        if (normalizedExpected.contains(normalizedActual) || normalizedActual.contains(normalizedExpected)) {
            return 0.75d + 0.20d * ((double) Math.min(normalizedExpected.length(), normalizedActual.length())
                    / (double) Math.max(normalizedExpected.length(), normalizedActual.length()));
        }
        Set<String> expectedTokens = tokens(normalizedExpected);
        Set<String> actualTokens = tokens(normalizedActual);
        if (expectedTokens.isEmpty() || actualTokens.isEmpty()) return 0d;
        Set<String> shared = new HashSet<>(expectedTokens);
        shared.retainAll(actualTokens);
        Set<String> all = new HashSet<>(expectedTokens);
        all.addAll(actualTokens);
        return all.isEmpty() ? 0d : (double) shared.size() / (double) all.size();
    }

    private static Set<String> tokens(String value) {
        Set<String> result = new HashSet<>();
        for (String token : value.split(" ")) {
            if (!token.isEmpty()) result.add(token);
        }
        return result;
    }

    private static String normalized(String value) {
        String raw = Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT);
        StringBuilder result = new StringBuilder(raw.length());
        boolean lastWasSpace = true;
        for (int index = 0; index < raw.length(); index += 1) {
            char character = raw.charAt(index);
            if (Character.isLetterOrDigit(character) || character >= 0x4e00) {
                result.append(character);
                lastWasSpace = false;
            } else if (!lastWasSpace) {
                result.append(' ');
                lastWasSpace = true;
            }
        }
        return result.toString().trim();
    }

    private static boolean isBvid(String value) {
        return value != null && value.matches("BV[1-9A-HJ-NP-Za-km-z]{10}");
    }

    private static boolean isSafeIdentity(String value) {
        return value != null && value.length() <= MAX_ID_LENGTH
                && value.matches("[A-Za-z0-9._:-]{1," + MAX_ID_LENGTH + "}");
    }

    private static boolean isSafeText(String value) {
        if (value == null || value.trim().isEmpty() || !value.trim().equals(value)
                || value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_TEXT_BYTES) return false;
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (Character.isISOControl(character) || character == '<' || character == '>') return false;
        }
        return true;
    }

    private static boolean isSafeLrc(String value) {
        return isSafeOptionalLrc(value) && value != null && !value.trim().isEmpty()
                && value.matches("(?s).*\\[\\d{1,2}:\\d{2}(?:\\.\\d{1,3})?].*");
    }

    private static boolean isSafeOptionalLrc(String value) {
        if (value == null || value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_LYRIC_BYTES) {
            return false;
        }
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if ((Character.isISOControl(character) && character != '\n' && character != '\r'
                    && character != '\t') || character == '<' || character == '>') return false;
        }
        return true;
    }

    private static boolean isCancelled(CancellationSignal cancellation) {
        return Thread.currentThread().isInterrupted() || (cancellation != null && cancellation.isCancelled());
    }

    /** Adapts the existing closed NetEase provider without exposing its transport DTOs. */
    private static final class NativeNetEaseCatalog implements NetEaseCatalog {
        private final NetEaseNativeProvider provider;

        NativeNetEaseCatalog(NetEaseNativeProvider provider) {
            this.provider = provider == null ? new NetEaseNativeProvider() : provider;
        }

        @Override
        public CatalogResult<List<Candidate>> search(String title, String artist) {
            // Keep the fixed NetEase keyword inside its 256-byte route limit.
            // Artist is still mandatory in the post-search confidence check.
            String query = title;
            try {
                NetEaseNativeProvider.Response response = provider.execute(
                        provider.buildSearchRequest(query, 1));
                if (!response.isHttpSuccess()) return failureFor(response);
                AndroidRpcContract.TypedRequest request = AndroidRpcContract.TypedRequest.neteaseSearch(
                        "native-bilibili-lyric", 0, query, 1);
                NetEaseResponseMapper.MappingResult mapped = NetEaseResponseMapper.mapSearch(request,
                        response.body);
                if (!mapped.isValid()) return CatalogResult.failure(CatalogStatus.MALFORMED_PROVIDER_RESPONSE);
                JSONArray rows = mapped.value.optJSONArray("rows");
                if (rows == null) {
                    return CatalogResult.failure(CatalogStatus.MALFORMED_PROVIDER_RESPONSE);
                }
                List<Candidate> candidates = new ArrayList<>();
                int limit = Math.min(rows.length(), MAX_CANDIDATES);
                for (int index = 0; index < limit; index += 1) {
                    JSONObject row = rows.optJSONObject(index);
                    if (row == null) return CatalogResult.failure(CatalogStatus.MALFORMED_PROVIDER_RESPONSE);
                    Candidate candidate = new Candidate(row.optString("providerTrackId", ""),
                            row.optString("title", ""), row.optString("artist", ""),
                            row.optLong("durationMs", 0L) / 1_000L);
                    if (!candidate.isValid()) return CatalogResult.failure(CatalogStatus.MALFORMED_PROVIDER_RESPONSE);
                    candidates.add(candidate);
                }
                return candidates.isEmpty() ? CatalogResult.failure(CatalogStatus.NO_RESULT)
                        : CatalogResult.success(Collections.unmodifiableList(candidates));
            } catch (URISyntaxException ignored) {
                return CatalogResult.failure(CatalogStatus.MALFORMED_PROVIDER_RESPONSE);
            }
        }

        @Override
        public CatalogResult<Lyric> fetchPrimaryLyric(String providerTrackId) {
            try {
                NetEaseNativeProvider.Response response = provider.execute(
                        provider.buildPrimaryLyricRequest(Long.parseLong(providerTrackId)));
                if (!response.isHttpSuccess()) return failureFor(response);
                NetEaseResponseMapper.MappingResult mapped = NetEaseResponseMapper.mapPrimaryLyric(response.body);
                if (!mapped.isValid()) return CatalogResult.failure(CatalogStatus.MALFORMED_PROVIDER_RESPONSE);
                return CatalogResult.success(new Lyric(mapped.value.optString("lyric", ""),
                        mapped.value.optString("tlyric", "")));
            } catch (NumberFormatException | URISyntaxException | JSONException ignored) {
                return CatalogResult.failure(CatalogStatus.MALFORMED_PROVIDER_RESPONSE);
            }
        }

        private static <T> CatalogResult<T> failureFor(NetEaseNativeProvider.Response response) {
            if (response != null && "NETWORK_TIMEOUT".equals(response.errorCode)) {
                return CatalogResult.failure(CatalogStatus.TIMEOUT);
            }
            if (response != null && "CANCELLED".equals(response.errorCode)) {
                return CatalogResult.failure(CatalogStatus.CANCELLED);
            }
            return CatalogResult.failure(CatalogStatus.PROVIDER_FAILURE);
        }
    }

    private static final class UnavailableCatalog implements NetEaseCatalog {
        @Override
        public CatalogResult<List<Candidate>> search(String title, String artist) {
            return CatalogResult.failure(CatalogStatus.PROVIDER_FAILURE);
        }

        @Override
        public CatalogResult<Lyric> fetchPrimaryLyric(String providerTrackId) {
            return CatalogResult.failure(CatalogStatus.PROVIDER_FAILURE);
        }
    }
}
