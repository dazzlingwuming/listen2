package com.dazzlingwuming.listen2.platform;

import android.content.Context;
import android.content.SharedPreferences;
import com.dazzlingwuming.listen2.data.LocalDataRepository;
import com.dazzlingwuming.listen2.library.AndroidLocalDataFacade;
import com.dazzlingwuming.listen2.library.GitHubPlaylistCodec;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

/** Closed, native-only GitHub Gist client. User gestures select an operation, never a URL/header. */
public final class AndroidGitHubSync {
    private final AndroidGitHubTokenVault vault;
    private final SharedPreferences preferences;
    private final AndroidLocalDataFacade library;

    public AndroidGitHubSync(Context context, AndroidLocalDataFacade library) {
        vault = new AndroidGitHubTokenVault(context.getApplicationContext());
        preferences = context.getSharedPreferences("listen2.github.sync.v1", Context.MODE_PRIVATE);
        this.library = library;
    }

    public static boolean validPayload(JSONObject payload) {
        if (payload == null) return false;
        String action = payload.optString("action", "");
        switch (action) {
            case "status": case "disconnect": case "list":
                return payload.length() == 1;
            case "connect":
                return payload.length() == 2 && payload.opt("token") instanceof String
                        && payload.optString("token").matches("[A-Za-z0-9_]{20,255}");
            case "pull":
                return payload.length() == 2 && validGistId(payload.optString("gistId"));
            case "push":
                return payload.length() == 2 && payload.opt("gistId") instanceof String
                        && (payload.optString("gistId").isEmpty() || validGistId(payload.optString("gistId")));
            default: return false;
        }
    }

    public synchronized JSONObject dispatch(JSONObject payload) {
        try {
            if (!validPayload(payload)) return failure("INVALID_INPUT");
            String action = payload.getString("action");
            if ("status".equals(action)) return status();
            if ("disconnect".equals(action)) {
                vault.clear(); preferences.edit().clear().commit(); return status();
            }
            if ("connect".equals(action)) {
                String token = payload.getString("token");
                JSONObject user = new JSONObject(http("GET", "/user", token, null, false));
                String login = user.getString("login");
                if (!login.matches("[A-Za-z0-9-]{1,39}")) return failure("INVALID_RESPONSE");
                try { vault.save(token); } catch (Exception ignored) { return failure("STORAGE_ERROR"); }
                preferences.edit().clear().putString("login", login).commit();
                return status();
            }
            if (!vault.configured()) return failure("TOKEN_REQUIRED");
            String token;
            try { token = vault.read(); } catch (Exception ignored) { return failure("STORAGE_ERROR"); }
            if ("list".equals(action)) return list(token);
            String gistId = payload.getString("gistId");
            if ("pull".equals(action)) {
                JSONObject document = readBackup(gistId, token);
                GitHubPlaylistCodec.ImportResult imported = GitHubPlaylistCodec.toNative(document);
                LocalDataRepository.Result<LocalDataRepository.BackupPreview> merged = library.mergeSyncedBackup(imported.backup);
                if (!merged.ok) return failure("LOCAL_DATA_ERROR");
                remember(gistId);
                return status().put("playlists", merged.value.playlists).put("tracks", merged.value.tracks)
                        .put("favorites", merged.value.favorites).put("skipped", imported.skipped);
            }
            JSONObject document = gistId.isEmpty() ? GitHubPlaylistCodec.empty() : readBackup(gistId, token);
            LocalDataRepository.Backup local = library.exportBackup();
            JSONObject merged = GitHubPlaylistCodec.mergeForUpload(document, local);
            JSONObject request = new JSONObject().put("description", "updated by Listen1 - Listen2 歌单同步")
                    .put("files", new JSONObject().put(GitHubPlaylistCodec.FILE_NAME,
                            new JSONObject().put("content", merged.toString())));
            if (gistId.isEmpty()) request.put("public", false);
            JSONObject saved = new JSONObject(http(gistId.isEmpty() ? "POST" : "PATCH",
                    gistId.isEmpty() ? "/gists" : "/gists/" + gistId, token, request.toString(), false));
            String savedId = saved.getString("id");
            if (!validGistId(savedId)) return failure("INVALID_RESPONSE");
            remember(savedId);
            return status().put("playlists", local.playlists.size()).put("favorites", local.favorites.size());
        } catch (ApiFailure error) {
            return failure(error.code);
        } catch (SocketTimeoutException error) {
            return failure("NETWORK_TIMEOUT");
        } catch (JSONException error) {
            return failure("INVALID_BACKUP");
        } catch (Exception ignored) {
            return failure("NETWORK_ERROR");
        }
    }

    private JSONObject list(String token) throws Exception {
        JSONArray matches = new JSONArray();
        // Bounded pagination. More than 500 Gists can still be reached by entering the Gist ID.
        boolean more = false;
        for (int page = 1; page <= 5; page++) {
            JSONArray gists = new JSONArray(http("GET", "/gists?per_page=100&page=" + page, token, null, false));
            for (int i = 0; i < gists.length(); i++) {
                JSONObject gist = gists.getJSONObject(i);
                JSONObject files = gist.optJSONObject("files");
                String id = gist.optString("id");
                if (files != null && files.has(GitHubPlaylistCodec.FILE_NAME) && validGistId(id))
                    matches.put(new JSONObject().put("id", id)
                            .put("description", gist.optString("description", "Listen2 歌单"))
                            .put("updatedAt", gist.optString("updated_at", ""))
                            .put("public", gist.optBoolean("public")));
            }
            more = gists.length() == 100;
            if (!more) break;
        }
        return status().put("gists", matches).put("hasMore", more);
    }

    private JSONObject readBackup(String id, String token) throws Exception {
        JSONObject gist = new JSONObject(http("GET", "/gists/" + id, token, null, false));
        JSONObject file = gist.getJSONObject("files").optJSONObject(GitHubPlaylistCodec.FILE_NAME);
        if (file == null) throw new ApiFailure("BACKUP_NOT_FOUND");
        if (file.optLong("size", 0) > GitHubPlaylistCodec.MAX_BYTES) throw new ApiFailure("BACKUP_TOO_LARGE");
        String text = file.optBoolean("truncated")
                ? http("GET", file.getString("raw_url"), null, null, true) : file.getString("content");
        return GitHubPlaylistCodec.parse(text);
    }

    private void remember(String id) {
        preferences.edit().putString("gistId", id).putString("lastSync", Instant.now().toString()).commit();
    }
    private JSONObject status() throws JSONException {
        return new JSONObject().put("ok", true).put("status", "OK").put("connected", vault.configured())
                .put("login", preferences.getString("login", ""))
                .put("gistId", preferences.getString("gistId", ""))
                .put("lastSync", preferences.getString("lastSync", ""));
    }
    private static JSONObject failure(String code) {
        try { return new JSONObject().put("ok", false).put("status", code); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    static boolean validGistId(String value) { return value != null && value.matches("[a-fA-F0-9]{5,40}"); }

    private static String http(String method, String path, String token, String body, boolean raw) throws Exception {
        if (Thread.currentThread().isInterrupted()) throw new ApiFailure("CANCELLED");
        URI uri = new URI(raw ? path : "https://api.github.com" + path);
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getFragment() != null
                || (uri.getPort() != -1 && uri.getPort() != 443)
                || !(raw ? "gist.githubusercontent.com" : "api.github.com").equals(uri.getHost()))
            throw new ApiFailure("INVALID_RESPONSE");
        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
        try {
            connection.setConnectTimeout(10000); connection.setReadTimeout(15000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod(method);
            connection.setRequestProperty("User-Agent", "Listen2-Android");
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            if (!raw && token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status == 401) throw new ApiFailure("TOKEN_INVALID");
            if (status == 403 || status == 429) throw new ApiFailure("PERMISSION_OR_RATE_LIMIT");
            if (status == 404) throw new ApiFailure("BACKUP_NOT_FOUND");
            if (status < 200 || status >= 300) throw new ApiFailure("GITHUB_UNAVAILABLE");
            int limit = raw ? GitHubPlaylistCodec.MAX_BYTES : 12 * 1024 * 1024;
            if (connection.getContentLengthLong() > limit) throw new ApiFailure("BACKUP_TOO_LARGE");
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new ApiFailure("CANCELLED");
                    if (out.size() + count > limit) throw new ApiFailure("BACKUP_TOO_LARGE");
                    out.write(buffer, 0, count);
                }
                return out.toString("UTF-8");
            }
        } finally { connection.disconnect(); }
    }
    private static final class ApiFailure extends Exception {
        final String code;
        ApiFailure(String code) { super(code); this.code = code; }
    }
}
