package com.listen2mobile.bilibili

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

/** Fixed-endpoint, native-owned Bilibili transport. No JS-controlled URL, header, cookie, or redirect exists here. */
class BilibiliHttpsGateway : BilibiliGateway {
    private val cookies = LinkedHashMap<String, String>()

    override fun beginQr(): BilibiliSession.QrChallenge {
        val data = request("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
        val key = data.optString("qrcode_key", "")
        val url = data.optString("url", "")
        if (!key.matches(Regex("[A-Za-z0-9_-]{1,256}")) || url.length > 2048) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return BilibiliSession.QrChallenge(key, url, System.currentTimeMillis() + 180_000L)
    }

    override fun pollQr(qrKey: String): BilibiliSession.PollResult {
        if (!qrKey.matches(Regex("[A-Za-z0-9_-]{1,256}"))) return BilibiliSession.PollResult.Failed(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val data = request("https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encode(qrKey)}")
        return when (data.optInt("code", Int.MIN_VALUE)) {
            86101 -> BilibiliSession.PollResult.Waiting
            86090 -> BilibiliSession.PollResult.Scanned
            86038 -> BilibiliSession.PollResult.Expired
            0 -> data.optString("refresh_token", "").takeIf { it.isNotBlank() && it.length <= 4096 }
                ?.let { BilibiliSession.PollResult.Authenticated(it) }
                ?: BilibiliSession.PollResult.Failed(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            else -> BilibiliSession.PollResult.Failed(BilibiliPolicy.ErrorCode.PROVIDER_ERROR)
        }
    }

    override fun logout() { cookies.clear() }

    override fun account(): BilibiliGateway.Account? {
        if (cookies["SESSDATA"].isNullOrBlank()) return null
        return try {
            val data = request("https://api.bilibili.com/x/web-interface/nav")
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
        val title = BilibiliPolicy.safeText(data.optString("title", ""), 160) ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return BilibiliGateway.VideoDetail(bvid, title, BilibiliPolicy.safeText(data.optJSONObject("owner")?.optString("name", null), 80), parts)
    }

    override fun resolveAudio(track: BilibiliPolicy.SemanticTrack): BilibiliPolicy.AudioHandoff {
        val detail = videoDetail(track.bvid)
        if (detail.parts.none { it.cid == track.cid && it.page == track.page }) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val mixin = wbiMixinKey()
        val query = BilibiliPolicy.buildWbiQuery(
            mapOf("bvid" to track.bvid, "cid" to track.cid.toString(), "qn" to "80", "fnval" to "16", "fnver" to "0", "fourk" to "0"), mixin, System.currentTimeMillis() / 1000L,
        ) ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val data = request("https://api.bilibili.com/x/player/wbi/playurl?$query")
        val audio = data.optJSONObject("dash")?.optJSONArray("audio")?.optJSONObject(0) ?: throw ProviderException(BilibiliPolicy.ErrorCode.DRM_RESTRICTED)
        val url = audio.optString("baseUrl", "")
        val deadline = System.currentTimeMillis() + 30 * 60 * 1000L
        if (!BilibiliPolicy.isSafeAudioHandoff(url, mapOf("Referer" to BilibiliPolicy.FIXED_REFERER), deadline, System.currentTimeMillis())) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return BilibiliPolicy.AudioHandoff(track.bvid, track.cid, track.page, url, deadline)
    }

    private fun wbiMixinKey(): String {
        val data = request("https://api.bilibili.com/x/web-interface/nav")
        val image = data.optJSONObject("wbi_img") ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        val img = image.optString("img_url", "").substringAfterLast('/').substringBefore('.')
        val sub = image.optString("sub_url", "").substringAfterLast('/').substringBefore('.')
        val source = img + sub
        val order = intArrayOf(46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52)
        if (source.length < 64) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
        return order.joinToString("") { source[it].toString() }.take(32)
    }

    private fun request(rawUrl: String): JSONObject {
        if (!BilibiliPolicy.isApprovedApiRoute(rawUrl)) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        var connection: HttpsURLConnection? = null
        try {
            connection = URL(rawUrl).openConnection() as HttpsURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "Listen2Mobile/1")
            cookieHeader()?.let { connection.setRequestProperty("Cookie", it) }
            val status = connection.responseCode
            if (status !in 200..299) throw ProviderException(if (status == 401 || status == 403) BilibiliPolicy.ErrorCode.LOGIN_REQUIRED else BilibiliPolicy.ErrorCode.NETWORK_ERROR)
            commitCookies(connection)
            val root = JSONObject(readBounded(connection))
            when (root.optInt("code", Int.MIN_VALUE)) {
                0 -> return root.optJSONObject("data") ?: throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
                -101 -> throw ProviderException(BilibiliPolicy.ErrorCode.LOGIN_REQUIRED)
                -10403, 6002003 -> throw ProviderException(BilibiliPolicy.ErrorCode.MEMBERSHIP_REQUIRED)
                -403 -> throw ProviderException(BilibiliPolicy.ErrorCode.REGION_RESTRICTED)
                else -> throw ProviderException(BilibiliPolicy.ErrorCode.PROVIDER_ERROR)
            }
        } catch (error: ProviderException) { throw error
        } catch (_: java.net.SocketTimeoutException) { throw ProviderException(BilibiliPolicy.ErrorCode.REQUEST_TIMEOUT)
        } catch (_: Exception) { throw ProviderException(BilibiliPolicy.ErrorCode.NETWORK_ERROR)
        } finally { connection?.disconnect() }
    }

    private fun cookieHeader(): String? = cookies.takeIf { it.isNotEmpty() }?.entries?.joinToString("; ") { "${it.key}=${it.value}" }?.takeIf { it.length <= 8192 }
    private fun commitCookies(connection: HttpsURLConnection) {
        connection.headerFields.forEach { (name, values) -> if (name.equals("Set-Cookie", true)) values?.forEach { header ->
            val pair = header.substringBefore(';'); val cut = pair.indexOf('='); if (cut in 1..128) {
                val key = pair.substring(0, cut); val value = pair.substring(cut + 1); if (key.matches(Regex("[A-Za-z0-9_-]{1,128}")) && value.length <= 4096 && !value.contains('\n') && !value.contains('\r')) cookies[key] = value
            }
        } }
    }
    private fun readBounded(connection: HttpsURLConnection): String = connection.inputStream.use { input ->
        val out = ByteArrayOutputStream(); val buffer = ByteArray(4096); while (true) { val count = input.read(buffer); if (count < 0) break; if (out.size() + count > BilibiliPolicy.MAX_RESPONSE_BYTES) throw ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE); out.write(buffer, 0, count) }; out.toString(StandardCharsets.UTF_8.name())
    }
    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
    class ProviderException(val code: BilibiliPolicy.ErrorCode) : IOException(code.name)
}
