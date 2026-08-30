package com.dazzlingwuming.listen2;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashSet;
import java.util.Set;

/** Maps untrusted Bilibili JSON into the intentionally small typed-page DTOs. */
final class BilibiliResponseMapper {
    private static final int MAX_PAGES = 50;
    private static final int MAX_CANDIDATES = 4;
    private static final int MAX_DURATION_SECONDS = 8 * 60 * 60;
    private static final int MAX_TEXT_LENGTH = 512;

    private BilibiliResponseMapper() {}

    static MappingResult mapSearch(AndroidRpcContract.TypedRequest request, String body) {
        AndroidRpcContract.ProjectionResult projection =
                AndroidRpcContract.projectSearchResponse(request, body);
        return projection.isValid() ? MappingResult.success(projection.result)
                : MappingResult.error(projection.errorCode);
    }

    static MappingResult mapVideoDetail(AndroidRpcContract.TypedRequest request, String body) {
        if (request == null || request.operation != AndroidRpcContract.Operation.BILIBILI_VIDEO_DETAIL) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject data = providerData(body);
            if (data == null || !request.bvid.equals(data.opt("bvid"))) {
                return MappingResult.error("IDENTITY_MISMATCH");
            }
            JSONArray pages = projectPages(data.optJSONArray("pages"));
            if (pages == null) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            JSONObject result = new JSONObject();
            result.put("bvid", request.bvid);
            result.put("pages", pages);
            putPlain(result, "title", data.opt("title"));
            putPositiveDuration(result, "duration", data.opt("duration"));
            String cover = safeArtwork(data.opt("pic"));
            if (cover != null) result.put("cover", cover);
            return MappingResult.success(result);
        } catch (JSONException ignored) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    static MappingResult mapAudioManifest(AndroidRpcContract.TypedRequest request,
            JSONObject detailRoot, String body) {
        if (detailRoot == null) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        return mapAudioManifest(request, detailRoot.toString(), body);
    }

    static MappingResult mapAudioManifest(AndroidRpcContract.TypedRequest request,
            String detailBody, String body) {
        if (request == null || request.operation != AndroidRpcContract.Operation.BILIBILI_AUDIO_MANIFEST) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject detail = providerData(detailBody);
            if (detail == null || !request.bvid.equals(detail.opt("bvid"))) {
                return MappingResult.error("IDENTITY_MISMATCH");
            }
            JSONArray pages = projectPages(detail.optJSONArray("pages"));
            if (pages == null) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            long selectedCid = selectCid(request, pages);
            if (selectedCid <= 0) return MappingResult.error("INVALID_PART");

            JSONObject data = providerData(body);
            if (data == null || !request.bvid.equals(data.opt("bvid"))
                    || positiveLong(data.opt("cid")) != selectedCid) {
                return MappingResult.error("IDENTITY_MISMATCH");
            }
            long durationMillis = positiveLong(data.opt("timelength"));
            if (durationMillis <= 0 || durationMillis > MAX_DURATION_SECONDS * 1000L) {
                return MappingResult.error("INVALID_DURATION");
            }
            JSONObject dash = data.optJSONObject("dash");
            JSONArray audioRows = dash == null ? null : dash.optJSONArray("audio");
            if (audioRows == null || audioRows.length() < 1 || audioRows.length() > MAX_PAGES) {
                return MappingResult.error("NO_STREAM");
            }
            JSONObject audio = audioRows.optJSONObject(0);
            if (audio == null) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            String mime = plain(audio.opt("mimeType"));
            String codec = plain(audio.opt("codecs"));
            if (!isApprovedAudio(mime, codec)) return MappingResult.error("UNSUPPORTED_CODEC");
            JSONArray candidates = projectCandidates(audio);
            if (candidates == null || candidates.length() == 0) return MappingResult.error("INVALID_STREAM");
            long expiry = expiryOf(candidates.getString(0));
            if (expiry <= currentEpochSeconds()) return MappingResult.error("EXPIRED_STREAM");

            JSONObject result = new JSONObject();
            result.put("bvid", request.bvid);
            result.put("cid", selectedCid);
            result.put("duration", durationMillis / 1000L);
            result.put("mime", mime);
            result.put("codec", codec);
            result.put("bitrate", positiveLong(audio.opt("bandwidth")));
            result.put("quality", safeQuality(audio.opt("id")));
            result.put("expiry", expiry);
            result.put("candidates", candidates);
            return MappingResult.success(result);
        } catch (JSONException ignored) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    private static JSONObject providerData(String body) {
        if (body == null || body.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES) return null;
        try {
            JSONObject root = new JSONObject(body);
            Object code = root.opt("code");
            if (!(code instanceof Number) || ((Number) code).intValue() != 0) return null;
            return root.optJSONObject("data");
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static JSONArray projectPages(JSONArray source) throws JSONException {
        if (source == null || source.length() == 0 || source.length() > MAX_PAGES) return null;
        JSONArray pages = new JSONArray();
        Set<Long> cids = new HashSet<>();
        for (int index = 0; index < source.length(); index += 1) {
            JSONObject page = source.optJSONObject(index);
            long cid = page == null ? 0L : positiveLong(page.opt("cid"));
            long duration = page == null ? 0L : positiveLong(page.opt("duration"));
            String part = page == null ? null : plain(page.opt("part"));
            if (cid <= 0 || !cids.add(cid) || duration <= 0 || duration > MAX_DURATION_SECONDS
                    || part == null) return null;
            JSONObject projected = new JSONObject();
            projected.put("cid", cid);
            projected.put("page", index + 1);
            projected.put("part", part);
            projected.put("duration", duration);
            pages.put(projected);
        }
        return pages;
    }

    private static long selectCid(AndroidRpcContract.TypedRequest request, JSONArray pages)
            throws JSONException {
        if ("default-first".equals(request.selectionMode)) return pages.getJSONObject(0).getLong("cid");
        if (!"explicit".equals(request.selectionMode) || request.cid <= 0) return 0L;
        for (int index = 0; index < pages.length(); index += 1) {
            if (pages.getJSONObject(index).getLong("cid") == request.cid) return request.cid;
        }
        return 0L;
    }

    private static JSONArray projectCandidates(JSONObject audio) throws JSONException {
        JSONArray candidates = new JSONArray();
        Set<String> seen = new HashSet<>();
        addCandidate(candidates, seen, audio.opt("baseUrl"));
        JSONArray backups = audio.optJSONArray("backupUrl");
        if (backups != null) {
            if (backups.length() > MAX_CANDIDATES) return null;
            for (int index = 0; index < backups.length(); index += 1) addCandidate(candidates, seen, backups.opt(index));
        }
        return candidates.length() > 0 && candidates.length() <= MAX_CANDIDATES ? candidates : null;
    }

    private static void addCandidate(JSONArray candidates, Set<String> seen, Object raw)
            throws JSONException {
        if (!(raw instanceof String)) return;
        String candidate = (String) raw;
        if (!isSafeMediaCandidate(candidate)) throw new JSONException("unsafe candidate");
        if (seen.add(candidate)) candidates.put(candidate);
    }

    private static boolean isSafeMediaCandidate(String candidate) {
        if (candidate == null || candidate.length() > 2048) return false;
        try {
            URI uri = new URI(candidate);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme()) && host != null && uri.getUserInfo() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && (host.equals("bilivideo.com") || host.endsWith(".bilivideo.com"))
                    && uri.getRawFragment() == null && expiryOf(candidate) > 0;
        } catch (URISyntaxException ignored) {
            return false;
        }
    }

    private static long expiryOf(String candidate) {
        try {
            String query = new URI(candidate).getRawQuery();
            if (query == null) return 0L;
            for (String pair : query.split("&")) {
                if (pair.startsWith("deadline=")) return Long.parseLong(pair.substring(9));
            }
        } catch (URISyntaxException | NumberFormatException ignored) {
            // Invalid signed URL metadata is never interpreted as non-expiring.
        }
        return 0L;
    }

    private static boolean isApprovedAudio(String mime, String codec) {
        return "audio/mp4".equals(mime) && codec != null && codec.startsWith("mp4a.");
    }

    private static String safeArtwork(Object raw) {
        if (!(raw instanceof String)) return null;
        String value = (String) raw;
        if (value.startsWith("//")) value = "https:" + value;
        try {
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                    && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                    && uri.getRawFragment() == null && value.length() <= 2048 ? uri.toASCIIString() : null;
        } catch (URISyntaxException ignored) {
            return null;
        }
    }

    private static void putPlain(JSONObject target, String key, Object value) throws JSONException {
        String text = plain(value);
        if (text != null) target.put(key, text);
    }

    private static void putPositiveDuration(JSONObject target, String key, Object value)
            throws JSONException {
        long duration = positiveLong(value);
        if (duration > 0 && duration <= MAX_DURATION_SECONDS) target.put(key, duration);
    }

    private static String plain(Object raw) {
        if (!(raw instanceof String)) return null;
        String value = (String) raw;
        return value.isEmpty() || value.length() > MAX_TEXT_LENGTH || value.indexOf('<') >= 0
                || value.indexOf('>') >= 0 || value.indexOf('\u0000') >= 0 ? null : value;
    }

    private static long positiveLong(Object raw) {
        return raw instanceof Number && ((Number) raw).longValue() > 0
                ? ((Number) raw).longValue() : 0L;
    }

    private static String safeQuality(Object raw) { return raw instanceof Number ? String.valueOf(raw) : ""; }

    private static long currentEpochSeconds() { return System.currentTimeMillis() / 1000L; }

    static final class MappingResult {
        final JSONObject value;
        final String errorCode;

        private MappingResult(JSONObject value, String errorCode) { this.value = value; this.errorCode = errorCode; }
        static MappingResult success(JSONObject value) { return new MappingResult(value, null); }
        static MappingResult error(String errorCode) { return new MappingResult(null, errorCode); }
        boolean isValid() { return value != null; }
    }
}
