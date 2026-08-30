package com.dazzlingwuming.listen2;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Projects untrusted NetEase provider data into the small page-safe search DTO. */
final class NetEaseResponseMapper {
    private static final int MAX_ROWS = 50;
    private static final int MAX_TEXT = 512;

    private NetEaseResponseMapper() {}

    static MappingResult mapSearch(AndroidRpcContract.TypedRequest request, String body) {
        if (request == null || request.operation != AndroidRpcContract.Operation.NETEASE_SEARCH
                || body == null || body.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject root = new JSONObject(body);
            Object code = root.opt("code");
            if (!(code instanceof Number)) return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            int providerCode = ((Number) code).intValue();
            if (providerCode != 200) return MappingResult.error(errorForProviderCode(providerCode));
            JSONObject result = root.optJSONObject("result");
            JSONArray songs = result == null ? null : result.optJSONArray("songs");
            if (songs == null || songs.length() > MAX_ROWS) {
                return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            }
            JSONArray rows = new JSONArray();
            for (int index = 0; index < songs.length(); index += 1) {
                JSONObject row = projectSong(songs.optJSONObject(index));
                if (row != null) rows.put(row);
            }
            if (songs.length() > 0 && rows.length() == 0) {
                return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
            }
            JSONObject safe = new JSONObject();
            safe.put("source", AndroidRpcContract.NETEASE_SOURCE);
            safe.put("provider", AndroidRpcContract.NETEASE_SOURCE);
            safe.put("total", boundedCount(result.opt("songCount"), rows.length()));
            safe.put("rows", rows);
            return MappingResult.success(safe);
        } catch (JSONException ignored) {
            return MappingResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    static String errorForStatus(int status) {
        if (status == 401) return "LOGIN_REQUIRED";
        if (status == 402) return "MEMBERSHIP_REQUIRED";
        if (status == 403) return "ENTITLEMENT_REQUIRED";
        if (status == 423) return "DRM_RESTRICTED";
        if (status == 429) return "RATE_LIMIT";
        if (status == 451) return "REGION_RESTRICTED";
        if (status >= 500 && status <= 599) return "PROVIDER_STATUS";
        return "HTTP_STATUS";
    }

    private static String errorForProviderCode(int code) {
        if (code == 301 || code == 302) return "LOGIN_REQUIRED";
        if (code == 401 || code == 403) return "ENTITLEMENT_REQUIRED";
        if (code == 429) return "RATE_LIMIT";
        return "PROVIDER_STATUS";
    }

    private static JSONObject projectSong(JSONObject song) throws JSONException {
        if (song == null || !(song.opt("id") instanceof Number)) return null;
        long id = ((Number) song.opt("id")).longValue();
        String title = safeText(song.optString("name", ""));
        JSONArray artists = song.optJSONArray("artists");
        String artist = artists == null || artists.length() == 0 ? null
                : safeText(artists.optJSONObject(0) == null ? ""
                        : artists.optJSONObject(0).optString("name", ""));
        if (id <= 0 || title == null || artist == null) return null;
        JSONObject safe = new JSONObject();
        safe.put("source", AndroidRpcContract.NETEASE_SOURCE);
        safe.put("provider", AndroidRpcContract.NETEASE_SOURCE);
        safe.put("id", "netrack_" + id);
        safe.put("providerTrackId", Long.toString(id));
        safe.put("title", title);
        safe.put("artist", artist);
        if (song.opt("duration") instanceof Number && ((Number) song.opt("duration")).longValue() > 0) {
            safe.put("durationMs", ((Number) song.opt("duration")).longValue());
        }
        safe.put("capability", "route-unavailable");
        return safe;
    }

    private static int boundedCount(Object value, int fallback) {
        if (!(value instanceof Number)) return fallback;
        return Math.max(0, Math.min(1_000_000, ((Number) value).intValue()));
    }

    private static String safeText(String value) {
        if (value == null || value.isEmpty() || value.length() > MAX_TEXT
                || value.indexOf('\u0000') >= 0 || value.indexOf('<') >= 0 || value.indexOf('>') >= 0) {
            return null;
        }
        return value;
    }

    static final class MappingResult {
        final JSONObject value;
        final String errorCode;
        private MappingResult(JSONObject value, String errorCode) {
            this.value = value;
            this.errorCode = errorCode;
        }
        static MappingResult success(JSONObject value) { return new MappingResult(value, null); }
        static MappingResult error(String errorCode) { return new MappingResult(null, errorCode); }
        boolean isValid() { return value != null; }
    }
}
