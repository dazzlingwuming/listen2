package com.dazzlingwuming.listen2;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Version 2 of the packaged-page to Android bridge.  This contract intentionally
 * names operations, not transport: pages cannot select URLs, headers or cookies.
 */
final class AndroidRpcContract {
    static final int PROTOCOL_VERSION = 2;
    static final int MAX_REQUEST_ID_LENGTH = 128;
    static final int MAX_KEYWORD_BYTES = 256;
    static final int MAX_PAGE = 1000;
    static final int MAX_RESULT_ROWS = 50;
    static final String BILIBILI_SEARCH_PATH = "/x/web-interface/search/type";
    static final String BILIBILI_VIDEO_DETAIL_PATH = "/x/web-interface/view";
    static final String BILIBILI_AUDIO_MANIFEST_PATH = "/x/player/playurl";
    static final String NETEASE_SOURCE = "netease";
    private static final int PAGE_SIZE = 20;
    private static final int MAX_TEXT_LENGTH = 512;

    enum Terminal { OK, CANCELLED, ERROR }

    enum Operation {
        BILIBILI_SEARCH("bilibili.search"),
        BILIBILI_VIDEO_DETAIL("bilibili.video.detail"),
        BILIBILI_AUDIO_MANIFEST("bilibili.audio.manifest"),
        NETEASE_SEARCH("netease.search"),
        PLAYBACK_COMMAND("playback.command"),
        RPC_CANCEL("rpc.cancel");

        final String wireName;

        Operation(String wireName) {
            this.wireName = wireName;
        }

        static Operation fromWireName(Object value) {
            if (!(value instanceof String)) return null;
            for (Operation operation : values()) {
                if (operation.wireName.equals(value)) return operation;
            }
            return null;
        }
    }

    private AndroidRpcContract() {}

    static ParseResult parseRequest(String rawMessage) {
        if (rawMessage == null || rawMessage.length() > HttpBridgePolicy.MAX_MESSAGE_LENGTH) {
            return ParseResult.error("INVALID_REQUEST");
        }
        try {
            JSONObject object = new JSONObject(rawMessage);
            if (!hasExactlyKeys(object, "version", "operation", "requestId", "pageEpoch", "payload")) {
                return ParseResult.error("UNKNOWN_FIELD");
            }
            if (!(object.opt("version") instanceof Number)
                    || ((Number) object.opt("version")).intValue() != PROTOCOL_VERSION) {
                return ParseResult.error("UNSUPPORTED_VERSION");
            }
            Object requestIdValue = object.opt("requestId");
            if (!(requestIdValue instanceof String) || !isValidRequestId((String) requestIdValue)) {
                return ParseResult.error("INVALID_REQUEST_ID");
            }
            String requestId = (String) requestIdValue;
            Object epochValue = object.opt("pageEpoch");
            if (!(epochValue instanceof Number)
                    || ((Number) epochValue).longValue() < 0
                    || ((Number) epochValue).longValue() > Integer.MAX_VALUE) {
                return ParseResult.error(requestId, "INVALID_PAGE_EPOCH");
            }
            Operation operation = Operation.fromWireName(object.opt("operation"));
            if (operation == null) {
                return ParseResult.error(requestId, ((Number) epochValue).intValue(),
                        "UNSUPPORTED_OPERATION");
            }
            JSONObject payload = object.optJSONObject("payload");
            TypedRequest typed = parsePayload(requestId, ((Number) epochValue).intValue(),
                    operation, payload);
            return typed == null ? ParseResult.error(requestId, "INVALID_PAYLOAD")
                    : ParseResult.success(typed);
        } catch (JSONException ignored) {
            return ParseResult.error("INVALID_JSON");
        }
    }

    static URI buildSearchUri(TypedRequest request) throws URISyntaxException {
        if (request == null || request.operation != Operation.BILIBILI_SEARCH) {
            throw new URISyntaxException("", "Unsupported operation");
        }
        String query = "search_type=video&page=" + request.page + "&page_size=" + PAGE_SIZE
                + "&keyword=" + URLEncoder.encode(request.keyword, StandardCharsets.UTF_8)
                + "&platform=pc";
        return new URI("https", null, HttpBridgePolicy.BILIBILI_API_HOST, -1,
                BILIBILI_SEARCH_PATH, query, null);
    }

    static URI buildVideoDetailUri(TypedRequest request) throws URISyntaxException {
        if (request == null || request.operation != Operation.BILIBILI_VIDEO_DETAIL) {
            throw new URISyntaxException("", "Unsupported operation");
        }
        return new URI("https", null, HttpBridgePolicy.BILIBILI_API_HOST, -1,
                BILIBILI_VIDEO_DETAIL_PATH, "bvid=" + request.bvid, null);
    }

    static URI buildAudioManifestUri(TypedRequest request) throws URISyntaxException {
        if (request == null || request.operation != Operation.BILIBILI_AUDIO_MANIFEST) {
            throw new URISyntaxException("", "Unsupported operation");
        }
        long selectedCid = request.cid;
        if (selectedCid <= 0) throw new URISyntaxException("", "CID required before route build");
        String query = "fnval=16&fnver=0&fourk=1&bvid=" + request.bvid + "&cid=" + selectedCid;
        return new URI("https", null, HttpBridgePolicy.BILIBILI_API_HOST, -1,
                BILIBILI_AUDIO_MANIFEST_PATH, query, null);
    }

    /** Android-free validation hook for deterministic JVM boundary tests. */
    static String validateInput(String requestId, int pageEpoch, Operation operation,
            String keyword, int page) {
        if (!isValidRequestId(requestId)) return "INVALID_REQUEST_ID";
        if (pageEpoch < 0) return "INVALID_PAGE_EPOCH";
        if (operation == null) return "UNSUPPORTED_OPERATION";
        if (keyword == null || keyword.trim().isEmpty()
                || keyword.trim().getBytes(StandardCharsets.UTF_8).length > MAX_KEYWORD_BYTES
                || page < 1 || page > MAX_PAGE) return "INVALID_PAYLOAD";
        return null;
    }

    static String validateManifestInput(String requestId, int pageEpoch, String bvid,
            String selectionMode, long cid) {
        if (!isValidRequestId(requestId)) return "INVALID_REQUEST_ID";
        if (pageEpoch < 0) return "INVALID_PAGE_EPOCH";
        if (!isSafeBvid(bvid) || !isSelectionMode(selectionMode)) return "INVALID_PAYLOAD";
        if ("explicit".equals(selectionMode)) return cid > 0 ? null : "INVALID_PAYLOAD";
        return cid == 0 ? null : "INVALID_PAYLOAD";
    }

    private static TypedRequest parsePayload(String requestId, int pageEpoch, Operation operation,
            JSONObject payload) {
        if (payload == null) return null;
        if (operation == Operation.BILIBILI_SEARCH || operation == Operation.NETEASE_SEARCH) {
            if (!hasExactlyKeys(payload, "keyword", "page")) return null;
            Object keyword = payload.opt("keyword");
            Object page = payload.opt("page");
            if (!(keyword instanceof String) || !(page instanceof Number)) return null;
            String normalized = ((String) keyword).trim();
            return validateInput(requestId, pageEpoch, operation, normalized,
                    ((Number) page).intValue()) == null
                    ? new TypedRequest(requestId, pageEpoch, operation, normalized,
                            ((Number) page).intValue()) : null;
        }
        if (operation == Operation.BILIBILI_VIDEO_DETAIL) {
            if (!hasExactlyKeys(payload, "bvid") || !(payload.opt("bvid") instanceof String)) return null;
            String bvid = (String) payload.opt("bvid");
            return isValidRequestId(requestId) && pageEpoch >= 0 && isSafeBvid(bvid)
                    ? TypedRequest.videoDetail(requestId, pageEpoch, bvid) : null;
        }
        if (operation == Operation.BILIBILI_AUDIO_MANIFEST) {
            Object bvid = payload.opt("bvid");
            Object mode = payload.opt("selectionMode");
            Object cid = payload.opt("cid");
            if (!(bvid instanceof String) || !(mode instanceof String)) return null;
            long value = cid instanceof Number ? ((Number) cid).longValue() : 0L;
            boolean expectedKeys = "explicit".equals(mode)
                    ? hasExactlyKeys(payload, "bvid", "selectionMode", "cid")
                    : hasExactlyKeys(payload, "bvid", "selectionMode");
            return expectedKeys && validateManifestInput(requestId, pageEpoch,
                    (String) bvid, (String) mode, value) == null
                    ? TypedRequest.audioManifest(requestId, pageEpoch, (String) bvid,
                            (String) mode, value) : null;
        }
        if (operation == Operation.RPC_CANCEL) {
            if (!hasExactlyKeys(payload, "targetRequestId", "targetPageEpoch")
                    || !(payload.opt("targetRequestId") instanceof String)
                    || !(payload.opt("targetPageEpoch") instanceof Number)) return null;
            String targetId = (String) payload.opt("targetRequestId");
            int targetEpoch = ((Number) payload.opt("targetPageEpoch")).intValue();
            return isValidRequestId(requestId) && pageEpoch >= 0 && isValidRequestId(targetId)
                    && targetEpoch >= 0
                    ? TypedRequest.cancel(requestId, pageEpoch, targetId, targetEpoch) : null;
        }
        if (operation == Operation.PLAYBACK_COMMAND) {
            if (!hasExactlyKeys(payload, "expectedRevision", "command", "payload")) return null;
            Object expectedRevision = payload.opt("expectedRevision");
            Object command = payload.opt("command");
            JSONObject commandPayload = payload.optJSONObject("payload");
            if (!(expectedRevision instanceof Number) || ((Number) expectedRevision).longValue() < 0L
                    || ((Number) expectedRevision).longValue() > Integer.MAX_VALUE
                    || !(command instanceof String) || ((String) command).isEmpty()
                    || ((String) command).length() > 64 || commandPayload == null) return null;
            return TypedRequest.playbackCommand(requestId, pageEpoch, payload);
        }
        return null;
    }

    /**
     * Converts the closed playback operation into the pure-Java policy envelope.
     * JSON arrays, nulls, and transport-like nested structures are rejected before
     * they can reach a native playback owner.
     */
    static Map<String, Object> toPlaybackEnvelope(TypedRequest request) {
        if (request == null || request.operation != Operation.PLAYBACK_COMMAND
                || request.playbackPayload == null) return null;
        try {
            Map<String, Object> envelope = new LinkedHashMap<>();
            envelope.put("requestId", request.requestId);
            envelope.put("pageEpoch", Long.valueOf(request.pageEpoch));
            envelope.put("expectedRevision", Long.valueOf(request.playbackPayload.getLong("expectedRevision")));
            envelope.put("command", request.playbackPayload.getString("command"));
            Map<String, Object> commandPayload = jsonObjectToMap(
                    request.playbackPayload.getJSONObject("payload"));
            if (commandPayload == null) return null;
            envelope.put("payload", commandPayload);
            return envelope;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static Map<String, Object> jsonObjectToMap(JSONObject object) {
        if (object == null || object.length() > 16) return null;
        Map<String, Object> result = new LinkedHashMap<>();
        java.util.Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (key == null || key.isEmpty() || key.length() > 64) return null;
            Object value = object.opt(key);
            if (!(value instanceof String) && !(value instanceof Boolean) && !(value instanceof Number)) {
                return null;
            }
            result.put(key, value);
        }
        return result;
    }

    static ProjectionResult projectSearchResponse(TypedRequest request, String rawBody) {
        if (request == null || rawBody == null || rawBody.length() > HttpBridgePolicy.MAX_RESPONSE_BYTES) {
            return ProjectionResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
        try {
            JSONObject root = new JSONObject(rawBody);
            if (!(root.opt("code") instanceof Number)
                    || ((Number) root.opt("code")).intValue() != 0) {
                return ProjectionResult.error("PROVIDER_STATUS");
            }
            JSONObject data = root.optJSONObject("data");
            JSONArray results = data == null ? null : data.optJSONArray("result");
            if (results == null || results.length() > MAX_RESULT_ROWS) {
                return ProjectionResult.error("MALFORMED_PROVIDER_RESPONSE");
            }
            JSONArray rows = new JSONArray();
            for (int index = 0; index < results.length(); index += 1) {
                // Current public search pages can include non-video promotion
                // rows alongside real videos. They have no usable BVID and
                // must never become selectable tracks, but one such row must
                // not discard otherwise valid, independently projected rows.
                JSONObject row = projectSearchRow(results.optJSONObject(index));
                if (row != null) rows.put(row);
            }
            if (results.length() > 0 && rows.length() == 0) {
                return ProjectionResult.error("MALFORMED_PROVIDER_RESPONSE");
            }
            int total = data.opt("numResults") instanceof Number
                    ? Math.max(0, ((Number) data.opt("numResults")).intValue()) : rows.length();
            JSONObject result = new JSONObject();
            result.put("source", "bilibili");
            result.put("total", total);
            result.put("rows", rows);
            return ProjectionResult.success(result);
        } catch (JSONException ignored) {
            return ProjectionResult.error("MALFORMED_PROVIDER_RESPONSE");
        }
    }

    /** Projects one independently safe, directly playable Bilibili video row. */
    private static JSONObject projectSearchRow(JSONObject item) throws JSONException {
        if (item == null) return null;
        String bvid = item.optString("bvid", "");
        String title = plainText(item.optString("title", ""));
        String author = plainText(item.optString("author", ""));
        if (!isSafeBvid(bvid) || title == null || author == null) return null;

        String cover = item.optString("pic", "");
        String normalizedCover = cover.isEmpty() ? null : normalizeCover(cover);
        if (!cover.isEmpty() && normalizedCover == null) return null;

        JSONObject row = new JSONObject();
        row.put("source", "bilibili");
        row.put("provider", "bilibili");
        row.put("id", "bitrack_v_" + bvid);
        row.put("bvid", bvid);
        row.put("title", title);
        row.put("author", author);
        if (item.opt("mid") instanceof Number && ((Number) item.opt("mid")).longValue() >= 0) {
            row.put("authorId", ((Number) item.opt("mid")).longValue());
        }
        row.put("type", "video");
        row.put("capability", "part-selection-required");
        if (normalizedCover != null) row.put("cover", normalizedCover);
        Object duration = item.opt("duration");
        if (duration instanceof String && ((String) duration).length() <= 32) {
            row.put("duration", duration);
        }
        return row;
    }

    static TypedReply reply(TypedRequest request, Terminal terminal, int status,
            JSONObject result, String errorCode) {
        return new TypedReply(request == null ? "" : request.requestId,
                request == null ? 0 : request.pageEpoch, terminal, status, result, errorCode);
    }

    static TypedReply errorReply(ParseResult parsed, String errorCode) {
        return new TypedReply(parsed == null ? "" : parsed.requestId,
                parsed == null ? 0 : parsed.pageEpoch, Terminal.ERROR, 0, null, errorCode);
    }

    private static boolean isValidRequestId(String value) {
        return value != null && !value.isEmpty() && value.length() <= MAX_REQUEST_ID_LENGTH;
    }

    private static boolean hasExactlyKeys(JSONObject object, String... expected) {
        Set<String> keys = new HashSet<>();
        java.util.Iterator<String> iterator = object.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        if (keys.size() != expected.length) return false;
        for (String key : expected) if (!keys.contains(key)) return false;
        return true;
    }

    static boolean isSafeBvid(String value) {
        return value != null && value.matches("BV[0-9A-Za-z]{6,32}");
    }

    private static boolean isSelectionMode(String value) {
        return "default-first".equals(value) || "explicit".equals(value);
    }

    private static String plainText(String value) {
        if (value == null || value.isEmpty() || value.length() > MAX_TEXT_LENGTH
                || value.indexOf('\u0000') >= 0) return null;
        // Video-search titles legitimately include this provider-owned emphasis
        // markup around the matched term. Remove only that exact inert tag;
        // any other markup remains an invalid provider response.
        String normalized = value
                .replaceAll("(?i)<em\\s+class=[\\\"']keyword[\\\"']\\s*>", "")
                .replaceAll("(?i)</em\\s*>", "");
        if (normalized.indexOf('<') >= 0 || normalized.indexOf('>') >= 0) return null;
        return normalized.replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'");
    }

    private static String normalizeCover(String value) {
        String candidate = value.startsWith("//") ? "https:" + value : value;
        try {
            URI uri = new URI(candidate);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getUserInfo() != null || uri.getRawFragment() != null
                    || candidate.length() > 2048) return null;
            return uri.toASCIIString();
        } catch (URISyntaxException ignored) {
            return null;
        }
    }

    static final class TypedRequest {
        final String requestId;
        final int pageEpoch;
        final Operation operation;
        final String keyword;
        final int page;
        final String bvid;
        final String selectionMode;
        final long cid;
        final String targetRequestId;
        final int targetPageEpoch;
        final JSONObject playbackPayload;

        TypedRequest(String requestId, int pageEpoch, Operation operation, String keyword, int page) {
            this.requestId = requestId;
            this.pageEpoch = pageEpoch;
            this.operation = operation;
            this.keyword = keyword;
            this.page = page;
            this.bvid = null;
            this.selectionMode = null;
            this.cid = 0L;
            this.targetRequestId = null;
            this.targetPageEpoch = 0;
            this.playbackPayload = null;
        }

        private TypedRequest(String requestId, int pageEpoch, Operation operation, String bvid,
                String selectionMode, long cid, String targetRequestId, int targetPageEpoch) {
            this.requestId = requestId;
            this.pageEpoch = pageEpoch;
            this.operation = operation;
            this.keyword = null;
            this.page = 0;
            this.bvid = bvid;
            this.selectionMode = selectionMode;
            this.cid = cid;
            this.targetRequestId = targetRequestId;
            this.targetPageEpoch = targetPageEpoch;
            this.playbackPayload = null;
        }

        static TypedRequest videoDetail(String requestId, int pageEpoch, String bvid) {
            return new TypedRequest(requestId, pageEpoch, Operation.BILIBILI_VIDEO_DETAIL,
                    bvid, null, 0L, null, 0);
        }

        static TypedRequest audioManifest(String requestId, int pageEpoch, String bvid,
                String selectionMode, long cid) {
            return new TypedRequest(requestId, pageEpoch, Operation.BILIBILI_AUDIO_MANIFEST,
                    bvid, selectionMode, cid, null, 0);
        }

        static TypedRequest neteaseSearch(String requestId, int pageEpoch, String keyword, int page) {
            return new TypedRequest(requestId, pageEpoch, Operation.NETEASE_SEARCH, keyword, page);
        }

        static TypedRequest cancel(String requestId, int pageEpoch, String targetRequestId,
                int targetPageEpoch) {
            return new TypedRequest(requestId, pageEpoch, Operation.RPC_CANCEL,
                    null, null, 0L, targetRequestId, targetPageEpoch);
        }

        static TypedRequest playbackCommand(String requestId, int pageEpoch, JSONObject payload) {
            return new TypedRequest(requestId, pageEpoch, payload);
        }

        private TypedRequest(String requestId, int pageEpoch, JSONObject playbackPayload) {
            this.requestId = requestId;
            this.pageEpoch = pageEpoch;
            this.operation = Operation.PLAYBACK_COMMAND;
            this.keyword = null;
            this.page = 0;
            this.bvid = null;
            this.selectionMode = null;
            this.cid = 0L;
            this.targetRequestId = null;
            this.targetPageEpoch = 0;
            this.playbackPayload = playbackPayload;
        }
    }

    static final class ParseResult {
        final TypedRequest request;
        final String errorCode;
        final String requestId;
        final int pageEpoch;
        private ParseResult(TypedRequest request, String requestId, int pageEpoch, String errorCode) {
            this.request = request;
            this.requestId = requestId;
            this.pageEpoch = pageEpoch;
            this.errorCode = errorCode;
        }
        static ParseResult success(TypedRequest request) {
            return new ParseResult(request, request.requestId, request.pageEpoch, null);
        }
        static ParseResult error(String errorCode) {
            return new ParseResult(null, "", 0, errorCode);
        }
        static ParseResult error(String requestId, String errorCode) {
            return new ParseResult(null, requestId, 0, errorCode);
        }
        static ParseResult error(String requestId, int pageEpoch, String errorCode) {
            return new ParseResult(null, requestId, pageEpoch, errorCode);
        }
        boolean isValid() { return request != null; }
    }

    static final class ProjectionResult {
        final JSONObject result;
        final String errorCode;
        private ProjectionResult(JSONObject result, String errorCode) { this.result = result; this.errorCode = errorCode; }
        static ProjectionResult success(JSONObject result) { return new ProjectionResult(result, null); }
        static ProjectionResult error(String errorCode) { return new ProjectionResult(null, errorCode); }
        boolean isValid() { return result != null; }
    }

    static final class TypedReply {
        final String requestId;
        final int pageEpoch;
        final Terminal terminal;
        final int status;
        final JSONObject result;
        final String errorCode;
        TypedReply(String requestId, int pageEpoch, Terminal terminal, int status,
                JSONObject result, String errorCode) {
            this.requestId = requestId; this.pageEpoch = pageEpoch; this.terminal = terminal;
            this.status = status; this.result = result; this.errorCode = errorCode;
        }
        String toJson() {
            JSONObject object = new JSONObject();
            try {
                object.put("version", PROTOCOL_VERSION);
                object.put("requestId", requestId);
                object.put("pageEpoch", pageEpoch);
                object.put("terminal", terminal.name().toLowerCase());
                object.put("status", status);
                if (terminal == Terminal.OK) object.put("result", result);
                else object.put("error", errorCode == null ? "INTERNAL_ERROR" : errorCode);
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
            return object.toString();
        }
    }
}
