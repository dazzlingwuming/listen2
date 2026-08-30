package com.dazzlingwuming.listen2;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
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
    private static final int PAGE_SIZE = 20;
    private static final int MAX_TEXT_LENGTH = 512;

    enum Terminal { OK, CANCELLED, ERROR }

    enum Operation {
        BILIBILI_SEARCH("bilibili.search");

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
            if (operation == null) return ParseResult.error(requestId, "UNSUPPORTED_OPERATION");
            JSONObject payload = object.optJSONObject("payload");
            if (payload == null || !hasExactlyKeys(payload, "keyword", "page")) {
                return ParseResult.error(requestId, "INVALID_PAYLOAD");
            }
            Object keywordValue = payload.opt("keyword");
            Object pageValue = payload.opt("page");
            if (!(keywordValue instanceof String) || !(pageValue instanceof Number)) {
                return ParseResult.error(requestId, "INVALID_PAYLOAD");
            }
            String keyword = ((String) keywordValue).trim();
            int page = ((Number) pageValue).intValue();
            String validation = validateInput(requestId, ((Number) epochValue).intValue(),
                    operation, keyword, page);
            return validation == null
                    ? ParseResult.success(new TypedRequest(requestId, ((Number) epochValue).intValue(),
                            operation, keyword, page))
                    : ParseResult.error(requestId, validation);
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
                JSONObject item = results.optJSONObject(index);
                if (item == null) return ProjectionResult.error("MALFORMED_PROVIDER_RESPONSE");
                String bvid = item.optString("bvid", "");
                String title = plainText(item.optString("title", ""));
                String author = plainText(item.optString("author", ""));
                if (!isSafeBvid(bvid) || title == null || author == null) {
                    return ProjectionResult.error("MALFORMED_PROVIDER_RESPONSE");
                }
                JSONObject row = new JSONObject();
                row.put("source", "bilibili");
                row.put("provider", "bilibili");
                row.put("id", "bitrack_v_" + bvid);
                row.put("bvid", bvid);
                row.put("title", title);
                row.put("author", author);
                if (item.opt("mid") instanceof Number
                        && ((Number) item.opt("mid")).longValue() >= 0) {
                    row.put("authorId", ((Number) item.opt("mid")).longValue());
                }
                row.put("type", "video");
                row.put("capability", "part-selection-required");
                String cover = item.optString("pic", "");
                if (!cover.isEmpty()) {
                    String normalizedCover = normalizeCover(cover);
                    if (normalizedCover == null) return ProjectionResult.error("MALFORMED_PROVIDER_RESPONSE");
                    row.put("cover", normalizedCover);
                }
                Object duration = item.opt("duration");
                if (duration instanceof String && ((String) duration).length() <= 32) {
                    row.put("duration", duration);
                }
                rows.put(row);
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

    static TypedReply reply(TypedRequest request, Terminal terminal, int status,
            JSONObject result, String errorCode) {
        return new TypedReply(request == null ? "" : request.requestId,
                request == null ? 0 : request.pageEpoch, terminal, status, result, errorCode);
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

    private static boolean isSafeBvid(String value) {
        return value != null && value.matches("BV[0-9A-Za-z]{6,32}");
    }

    private static String plainText(String value) {
        if (value == null || value.isEmpty() || value.length() > MAX_TEXT_LENGTH
                || value.indexOf('<') >= 0 || value.indexOf('>') >= 0
                || value.indexOf('\u0000') >= 0) return null;
        return value;
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

        TypedRequest(String requestId, int pageEpoch, Operation operation, String keyword, int page) {
            this.requestId = requestId;
            this.pageEpoch = pageEpoch;
            this.operation = operation;
            this.keyword = keyword;
            this.page = page;
        }
    }

    static final class ParseResult {
        final TypedRequest request;
        final String errorCode;
        private ParseResult(TypedRequest request, String errorCode) { this.request = request; this.errorCode = errorCode; }
        static ParseResult success(TypedRequest request) { return new ParseResult(request, null); }
        static ParseResult error(String errorCode) { return new ParseResult(null, errorCode); }
        static ParseResult error(String requestId, String errorCode) { return new ParseResult(null, errorCode); }
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
