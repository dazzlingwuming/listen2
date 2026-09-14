package com.listen2mobile.bilibili

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.net.ssl.HttpsURLConnection

/** Closed native transport. Only the active QR poll has a disconnectable handle. */
class BilibiliHttpsGateway : BilibiliGateway {
    private data class ActivePoll(val key: String, val connection: HttpsURLConnection)

    private val cookies = LinkedHashMap<String, String>()
    private val activePoll = AtomicReference<ActivePoll?>(null)
    private val cancelledPoll = AtomicReference<String?>(null)
    private val persistedCookieNames = setOf("SESSDATA", "DedeUserID", "DedeUserID__ckMd5", "bili_jct")

    override fun beginQr(): BilibiliSession.QrChallenge {
        val data = request("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
        val key = data.optString("qrcode_key", "")
        val url = data.optString("url", "")
        if (!key.matches(Regex("[A-Za-z0-9_-]{1,256}")) || url.length > 2048)
            throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return BilibiliSession.QrChallenge(key, url, System.currentTimeMillis() + 180_000L)
    }

    override fun pollQr(qrKey: String): BilibiliSession.PollResult {
        if (!qrKey.matches(Regex("[A-Za-z0-9_-]{1,256}")) )
            return BilibiliSession.PollResult.Failed(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val data = request(
            "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encode(qrKey)}",
            pollKey = qrKey,
        )
        return when (data.optInt("code", Int.MIN_VALUE)) {
            86101 -> BilibiliSession.PollResult.Waiting
            86090 -> BilibiliSession.PollResult.Scanned
            86038 -> BilibiliSession.PollResult.Expired
            0 -> data.optString("refresh_token", "")
                .takeIf { it.isNotBlank() && it.length <= 4096 }
                ?.let { BilibiliSession.PollResult.Authenticated(it) }
                ?: BilibiliSession.PollResult.Failed(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            else -> BilibiliSession.PollResult.Failed(BilibiliPolicy.ErrorCode.PROVIDER_ERROR)
        }
    }

    override fun cancelPoll(qrKey: String) {
        cancelledPoll.set(qrKey)
        val current = activePoll.get()
        if (current != null && current.key == qrKey && activePoll.compareAndSet(current, null))
            current.connection.disconnect()
    }

    override fun exportSession(refreshMaterial: String): BilibiliVault.SessionMaterial {
        val snapshot = synchronized(cookies) {
            cookies.filterKeys { it in persistedCookieNames }.toMap()
        }
        val csrf = snapshot["bili_jct"]
        if (refreshMaterial.isBlank() || snapshot["SESSDATA"].isNullOrBlank() || csrf.isNullOrBlank())
            throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return BilibiliVault.SessionMaterial(refreshMaterial, snapshot, csrf)
    }

    override fun restoreSession(material: BilibiliVault.SessionMaterial) {
        if (material.refreshMaterial.isBlank() || material.refreshMaterial.length > 4096 ||
            material.cookies.isEmpty() || material.cookies.size > persistedCookieNames.size ||
            material.cookies.keys.any { it !in persistedCookieNames } ||
            material.cookies["SESSDATA"].isNullOrBlank() || material.cookies["bili_jct"].isNullOrBlank()
        ) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        synchronized(cookies) {
            cookies.clear()
            cookies.putAll(material.cookies)
        }
    }

    /** Fixed cookie-info -> correspond -> refresh -> confirm sequence; no caller route or body. */
    override fun refresh(material: BilibiliVault.SessionMaterial): BilibiliVault.SessionMaterial? {
        restoreSession(material)
        val csrf = material.cookies["bili_jct"] ?: material.csrf ?: return null
        val info = request("https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=${encode(csrf)}")
        if (!info.optBoolean("refresh", false)) return exportSession(material.refreshMaterial)
        val timestamp = info.optLong("timestamp", 0L).takeIf { it > 0L } ?: System.currentTimeMillis()
        val refreshCsrf = extractRefreshCsrf(requestText("https://www.bilibili.com/correspond/1/${refreshCorrespondPath(timestamp)}"))
            ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        val refreshed = request(
            "https://passport.bilibili.com/x/passport-login/web/cookie/refresh",
            method = "POST",
            body = formBody(
                "csrf" to csrf,
                "refresh_csrf" to refreshCsrf,
                "source" to "main_web",
                "refresh_token" to material.refreshMaterial,
            ),
        ).optString("refresh_token", "").takeIf { it.isNotBlank() && it.length <= 4096 }
            ?: return null
        val newCsrf = synchronized(cookies) { cookies["bili_jct"] }
            ?.takeIf { it.isNotBlank() } ?: return null
        request(
            "https://passport.bilibili.com/x/passport-login/web/confirm/refresh",
            method = "POST",
            body = formBody("csrf" to newCsrf, "refresh_token" to material.refreshMaterial),
        )
        return exportSession(refreshed)
    }

    override fun logout() {
        activePoll.get()?.let { cancelPoll(it.key) }
        synchronized(cookies) { cookies.clear() }
    }

    override fun account(): BilibiliGateway.Account? {
        if (synchronized(cookies) { cookies["SESSDATA"].isNullOrBlank() }) return null
        return try {
            val data = request("https://api.bilibili.com/x/web-interface/nav", allowAnonymous = true)
            if (data.optBoolean("_anonymous", false)) return null
            BilibiliGateway.Account(data.optString("uname", null), data.optString("face", null))
        } catch (_: Exception) { null }
    }

    override fun videoDetail(bvid: String): BilibiliGateway.VideoDetail {
        if (!BilibiliPolicy.isCanonicalBvid(bvid)) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val data = request("https://api.bilibili.com/x/web-interface/view?bvid=${encode(bvid)}")
        if (data.optString("bvid", "") != bvid) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        val pages = data.optJSONArray("pages") ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        if (pages.length() !in 1..50) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        val parts = ArrayList<BilibiliGateway.VideoPart>()
        for (index in 0 until pages.length()) {
            val page = pages.optJSONObject(index) ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            val cid = page.optLong("cid", 0)
            val number = page.optLong("page", 0)
            val title = BilibiliPolicy.safeText(page.optString("part", ""), 160)
            if (cid <= 0 || number != index + 1L || title == null) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            parts += BilibiliGateway.VideoPart(cid, number, title, page.optLong("duration", 0).takeIf { it > 0 }?.times(1000L))
        }
        val title = BilibiliPolicy.safeText(data.optString("title", ""), 160)
            ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return BilibiliGateway.VideoDetail(bvid, title, BilibiliPolicy.safeText(data.optJSONObject("owner")?.optString("name", null), 80), parts)
    }

    override fun resolveAudio(track: BilibiliPolicy.SemanticTrack): BilibiliPolicy.AudioHandoff {
        val detail = videoDetail(track.bvid)
        if (detail.parts.none { it.cid == track.cid && it.page == track.page })
            throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val query = BilibiliPolicy.buildWbiQuery(
            mapOf("bvid" to track.bvid, "cid" to track.cid.toString(), "qn" to "80", "fnval" to "16", "fnver" to "0", "fourk" to "0"),
            wbiMixinKey(),
            System.currentTimeMillis() / 1000L,
        ) ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val audio = request("https://api.bilibili.com/x/player/wbi/playurl?$query")
            .optJSONObject("dash")?.optJSONArray("audio")
            ?: throw ProviderException(BilibiliPolicy.ErrorCode.DRM_RESTRICTED)
        val candidates = ArrayList<BilibiliPolicy.MediaCandidate>()
        for (index in 0 until audio.length()) {
            val item = audio.optJSONObject(index) ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            candidates += BilibiliPolicy.MediaCandidate(
                item.optLong("id", 0),
                item.optString("baseUrl", item.optString("base_url", "")),
                item.optString("mimeType", item.optString("mime_type", "")),
                item.optString("codecs", ""),
                hasAlternateUrl(item),
            )
        }
        val now = System.currentTimeMillis()
        val selected = BilibiliPolicy.selectAudioCandidate(candidates, now)
            ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        val deadline = BilibiliPolicy.signedDeadline(selected.url)
            ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return BilibiliPolicy.AudioHandoff(track.bvid, track.cid, track.page, selected.url, deadline)
    }

    override fun resolveVideo(request: BilibiliMvPolicy.MvRequest): BilibiliMvPolicy.VideoManifest {
        val detail = videoDetail(request.bvid)
        if (detail.bvid != request.bvid || detail.parts.none { it.cid == request.cid })
            throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val quality = request.qualityId.takeUnless { it == "auto" } ?: "80"
        val query = BilibiliPolicy.buildWbiQuery(
            mapOf("bvid" to request.bvid, "cid" to request.cid.toString(), "qn" to quality, "fnval" to "16", "fnver" to "0", "fourk" to "0"),
            wbiMixinKey(),
            System.currentTimeMillis() / 1000L,
        ) ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val video = request("https://api.bilibili.com/x/player/wbi/playurl?$query")
            .optJSONObject("dash")?.optJSONArray("video")
            ?: throw ProviderException(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)
        if (video.length() !in 1..4) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        val candidates = ArrayList<BilibiliMvPolicy.VideoCandidate>()
        for (index in 0 until video.length()) {
            val item = video.optJSONObject(index) ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            candidates += BilibiliMvPolicy.VideoCandidate(
                id = item.optInt("id", 0),
                label = item.optString("id", ""),
                url = item.optString("baseUrl", item.optString("base_url", "")),
                mimeType = item.optString("mimeType", item.optString("mime_type", "")),
                codecs = item.optString("codecs", ""),
                width = item.optInt("width", 0),
                height = item.optInt("height", 0),
                frameRate = item.optString("frameRate", "").substringBefore('/').toIntOrNull() ?: 0,
                role = "video",
                hasAlternateUrl = hasAlternateUrl(item),
            )
        }
        return BilibiliMvPolicy.VideoManifest(request.bvid, request.cid, candidates)
    }

    private fun wbiMixinKey(): String {
        val image = request("https://api.bilibili.com/x/web-interface/nav").optJSONObject("wbi_img")
            ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        val source = image.optString("img_url", "").substringAfterLast('/').substringBefore('.') +
            image.optString("sub_url", "").substringAfterLast('/').substringBefore('.')
        val order = intArrayOf(46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52)
        if (source.length < 64) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return order.joinToString("") { source[it].toString() }.take(32)
    }

    private fun request(rawUrl: String, method: String = "GET", body: String? = null, pollKey: String? = null, allowAnonymous: Boolean = false): JSONObject {
        if (!BilibiliPolicy.isApprovedApiRoute(rawUrl) || (method != "GET" && method != "POST"))
            throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        var connection: HttpsURLConnection? = null
        var registeredPoll: ActivePoll? = null
        try {
            if (pollKey != null && isPollCancelled(pollKey)) throw ProviderException(BilibiliPolicy.ErrorCode.CANCELLED)
            connection = URL(rawUrl).openConnection() as HttpsURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.requestMethod = method
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Referer", BilibiliPolicy.FIXED_REFERER)
            connection.setRequestProperty("User-Agent", "Listen2Mobile/1")
            cookieHeader()?.let { connection.setRequestProperty("Cookie", it) }
            if (pollKey != null) {
                registeredPoll = ActivePoll(pollKey, connection)
                activePoll.set(registeredPoll)
                if (isPollCancelled(pollKey)) throw ProviderException(BilibiliPolicy.ErrorCode.CANCELLED)
            }
            if (body != null) {
                val bytes = body.toByteArray(StandardCharsets.UTF_8)
                if (bytes.size > BilibiliPolicy.MAX_BODY_BYTES) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            if (pollKey != null && isPollCancelled(pollKey)) throw ProviderException(BilibiliPolicy.ErrorCode.CANCELLED)
            if (status !in 200..299) throw ProviderException(if (status == 401 || status == 403) BilibiliPolicy.ErrorCode.LOGIN_REQUIRED else BilibiliPolicy.ErrorCode.NETWORK_ERROR)
            val root = JSONObject(readBounded(connection, pollKey))
            if (pollKey != null && isPollCancelled(pollKey)) throw ProviderException(BilibiliPolicy.ErrorCode.CANCELLED)
            commitCookies(connection)
            return when (root.optInt("code", Int.MIN_VALUE)) {
                0 -> root.optJSONObject("data") ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
                -101 -> if (allowAnonymous) JSONObject().put("_anonymous", true) else throw ProviderException(BilibiliPolicy.ErrorCode.LOGIN_REQUIRED)
                -10403, 6002003 -> throw ProviderException(BilibiliPolicy.ErrorCode.MEMBERSHIP_REQUIRED)
                -403 -> throw ProviderException(BilibiliPolicy.ErrorCode.REGION_RESTRICTED)
                else -> throw ProviderException(BilibiliPolicy.ErrorCode.PROVIDER_ERROR)
            }
        } catch (error: ProviderException) {
            throw error
        } catch (_: java.net.SocketTimeoutException) {
            throw ProviderException(if (pollKey != null && isPollCancelled(pollKey)) BilibiliPolicy.ErrorCode.CANCELLED else BilibiliPolicy.ErrorCode.REQUEST_TIMEOUT)
        } catch (_: Exception) {
            throw ProviderException(if (pollKey != null && isPollCancelled(pollKey)) BilibiliPolicy.ErrorCode.CANCELLED else BilibiliPolicy.ErrorCode.NETWORK_ERROR)
        } finally {
            registeredPoll?.let { activePoll.compareAndSet(it, null) }
            connection?.disconnect()
        }
    }

    private fun requestText(rawUrl: String): String {
        if (!BilibiliPolicy.isApprovedRefreshCorrespondRoute(rawUrl)) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        var connection: HttpsURLConnection? = null
        try {
            connection = URL(rawUrl).openConnection() as HttpsURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept", "text/html")
            connection.setRequestProperty("Referer", BilibiliPolicy.FIXED_REFERER)
            cookieHeader()?.let { connection.setRequestProperty("Cookie", it) }
            if (connection.responseCode !in 200..299) throw ProviderException(BilibiliPolicy.ErrorCode.NETWORK_ERROR)
            val text = readBounded(connection, null)
            commitCookies(connection)
            return text
        } catch (error: ProviderException) {
            throw error
        } catch (_: java.net.SocketTimeoutException) {
            throw ProviderException(BilibiliPolicy.ErrorCode.REQUEST_TIMEOUT)
        } catch (_: Exception) {
            throw ProviderException(BilibiliPolicy.ErrorCode.NETWORK_ERROR)
        } finally {
            connection?.disconnect()
        }
    }

    private fun isPollCancelled(key: String) = cancelledPoll.get() == key
    private fun hasAlternateUrl(item: JSONObject): Boolean = hasValue(item.opt("backupUrl")) || hasValue(item.opt("backup_url"))
    private fun hasValue(value: Any?): Boolean = when (value) {
        null, JSONObject.NULL -> false
        is String -> value.isNotBlank()
        is JSONArray -> value.length() > 0
        else -> true
    }
    private fun formBody(vararg values: Pair<String, String>) = values.joinToString("&") { "${encode(it.first)}=${encode(it.second)}" }
    private fun cookieHeader(): String? = synchronized(cookies) {
        cookies.takeIf { it.isNotEmpty() }?.entries?.joinToString("; ") { "${it.key}=${it.value}" }?.takeIf { it.length <= 8192 }
    }
    private fun commitCookies(connection: HttpsURLConnection) = synchronized(cookies) {
        connection.headerFields.forEach { (name, values) ->
            if (name.equals("Set-Cookie", true)) values?.forEach { header ->
                val pair = header.substringBefore(';')
                val cut = pair.indexOf('=')
                if (cut in 1..128) {
                    val key = pair.substring(0, cut)
                    val value = pair.substring(cut + 1)
                    if (key.matches(Regex("[A-Za-z0-9_-]{1,128}")) && value.length <= 4096 && !value.contains('\n') && !value.contains('\r')) cookies[key] = value
                }
            }
        }
    }
    private fun readBounded(connection: HttpsURLConnection, pollKey: String?): String = connection.inputStream.use { input ->
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (true) {
            if (pollKey != null && isPollCancelled(pollKey)) throw ProviderException(BilibiliPolicy.ErrorCode.CANCELLED)
            val count = input.read(buffer)
            if (count < 0) break
            if (out.size() + count > BilibiliPolicy.MAX_RESPONSE_BYTES) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            out.write(buffer, 0, count)
        }
        out.toString(StandardCharsets.UTF_8.name())
    }
    private fun refreshCorrespondPath(timestamp: Long): String {
        if (timestamp <= 0L) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val encodedKey = Base64.decode(REFRESH_PUBLIC_KEY, Base64.DEFAULT)
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(encodedKey))
        val cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        cipher.init(Cipher.ENCRYPT_MODE, publicKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
        return cipher.doFinal("refresh_$timestamp".toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
    private fun extractRefreshCsrf(html: String): String? = Regex("<div\\b[^>]*\\bid=[\\\"']1-name[\\\"'][^>]*>\\s*([^<\\s]+)\\s*</div>", RegexOption.IGNORE_CASE)
        .find(html)?.groupValues?.getOrNull(1)?.takeIf { it.length in 1..512 && it.none { character -> character.code <= 31 } }
    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8.name())

    class ProviderException(val code: BilibiliPolicy.ErrorCode) : IOException(code.name)

    private companion object {
        const val REFRESH_PUBLIC_KEY = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0EgUc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40JNrRuoEUXpabUzGB8QIDAQAB"
    }
}
