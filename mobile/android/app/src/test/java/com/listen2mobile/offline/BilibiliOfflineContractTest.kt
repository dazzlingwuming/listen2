package com.listen2mobile.offline

import com.listen2mobile.media.CacheAuthorization
import com.listen2mobile.media.MediaIdentity
import com.listen2mobile.media.NativeTransport
import com.listen2mobile.media.OfflineEntitlementClass
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class BilibiliOfflineContractTest {
    private val track = "bitrack_v_BV1234567890-123"
    private val now = 1_700_000_000_000L
    private val url = "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/12/34/audio.m4s?deadline=1700000060"

    @Test fun `only exact video part and nonzero native account authority are admitted`() {
        assertEquals("123", BilibiliOfflinePolicy.partId(track))
        listOf("bitrack_1", "bitrack_v_BV1234567890-0", "bitrack_v_BV1234567890-01", "bitrack_v_BV1234567890-123/other").forEach {
            assertFalse(OfflinePolicy.accepted("bilibili", it))
        }
        assertTrue(BilibiliOfflinePolicy.matches(grant(), "bilibili", track))
        assertFalse(BilibiliOfflinePolicy.matches(grant().copy(identity = grant().identity.copy(partId = "124")), "bilibili", track))
        assertFalse(BilibiliOfflinePolicy.matches(grant().copy(accountGeneration = 0L), "bilibili", track))
        assertFalse(BilibiliOfflinePolicy.matches(grant().copy(entitlementClass = OfflineEntitlementClass.ANONYMOUS_FREE), "bilibili", track))
    }

    @Test fun `fixed native DASH transport rejects arbitrary host path headers and expired URL`() {
        val safe = NativeTransport(url, mapOf("Referer" to "https://www.bilibili.com/"))
        assertTrue(BilibiliOfflinePolicy.permits(safe, now))
        listOf(
            safe.copy(url = url.replace("bilivideo.com", "bilivideo.com.evil.example")),
            safe.copy(url = url.replace("audio.m4s", "../audio.m4s")),
            safe.copy(url = url.replace("audio.m4s", "%2e%2e/audio.m4s")),
            safe.copy(url = url.replace("audio.m4s", "video.mp4")),
            safe.copy(url = url.replace("https:", "http:")),
            safe.copy(headers = safe.headers + ("Cookie" to "forbidden")),
            safe.copy(source = "kugou"),
            safe.copy(candidates = listOf(url)),
        ).forEach { assertFalse(BilibiliOfflinePolicy.permits(it, now)) }
        assertFalse(BilibiliOfflinePolicy.permits(safe, now + 60_000L))
    }

    @Test fun `native download sets only fixed Referer rejects redirects and disconnects failures`() {
        val safe = NativeTransport(url, mapOf("Referer" to "https://www.bilibili.com/"))
        val connection = Connection(URL(url), 200)
        BilibiliOfflineTransport({ connection }, { now }).fetch(safe, System.nanoTime() / 1_000_000 + 10_000L).close()
        assertEquals("https://www.bilibili.com/", connection.getRequestProperty("Referer"))
        assertNull(connection.getRequestProperty("Cookie"))
        assertFalse(connection.instanceFollowRedirects)
        assertTrue(connection.disconnected)
        val redirect = Connection(URL(url), 302)
        try {
            BilibiliOfflineTransport({ redirect }, { now }).fetch(safe, System.nanoTime() / 1_000_000 + 10_000L)
            fail("redirect must be terminal")
        } catch (expected: java.io.IOException) { assertEquals("REDIRECT_REJECTED", expected.message) }
        assertTrue(redirect.disconnected)
    }

    @Test fun `Bilibili uses descriptor transport only hashes bytes and restores verified file`() {
        val root = Files.createTempDirectory("bilibili-offline").toFile()
        val executor = ManualExecutor()
        var fetches = 0
        val bytes = mp4()
        val coordinator = OfflineCoordinator(root, executor = executor,
            authorizedBilibiliFetch = { entry, _ -> assertEquals(track, entry.trackId); fetches++; response(bytes) },
            authorizationCurrent = { true })
        coordinator.enqueue("bilibili", track, "video", "artist")
        assertNull(coordinator.resolve("bilibili", track))
        executor.run()
        assertEquals(1, fetches)
        val ready = requireNotNull(coordinator.resolve("bilibili", track))
        assertEquals(OfflinePolicy.digest(bytes), ready.digest)
        assertEquals("audio/mp4", ready.mimeType)
        val metadata = File(root, "catalog.json").readText()
        assertFalse(metadata.contains("https://"))
        assertFalse(metadata.contains("Referer"))
        assertTrue(root.listFiles().orEmpty().none { it.name.endsWith(".part") })
        val restored = OfflineCoordinator(root, executor = ManualExecutor())
        assertNotNull(restored.resolve("bilibili", track))
        // Integrity recovery does not recreate operation authorization or transport.
        assertNull(TransferAuthorizationBook().peek(ready))
    }

    @Test fun `cancel expiry revocation and transfer failure never atomically publish`() {
        for (failure in listOf("cancel", "expire", "revoke-at-eof", "network", "short-body")) {
            val root = Files.createTempDirectory("bilibili-offline-failure").toFile()
            val executor = ManualExecutor()
            var current = true
            val coordinator = OfflineCoordinator(root, executor = executor,
                authorizedBilibiliFetch = { _, _ ->
                    if (failure == "network") throw java.io.IOException("HTTP_FAILED")
                    val input = object : ByteArrayInputStream(mp4()) {
                        override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                            val count = super.read(bytes, offset, length)
                            if (count < 0 && failure == "revoke-at-eof") current = false
                            return count
                        }
                    }
                    OfflineResponse(input, "audio/mp4", if (failure == "short-body") 25L else 24L)
                }, authorizationCurrent = { current })
            val entry = coordinator.enqueue("bilibili", track, "video", "artist")
            if (failure == "cancel") coordinator.cancel(entry.operationId)
            if (failure == "expire") current = false
            executor.run()
            assertNull(coordinator.resolve("bilibili", track))
            assertFalse(File(root, OfflinePolicy.key("bilibili", track)).exists())
            assertTrue(root.listFiles().orEmpty().none { it.name.endsWith(".part") })
        }
    }

    @Test fun `missing account authority is visible and retry can acquire a fresh operation`() {
        val root = Files.createTempDirectory("bilibili-offline-admission").toFile()
        val executor = ManualExecutor()
        val coordinator = OfflineCoordinator(root, executor = executor,
            authorizedBilibiliFetch = { _, _ -> response(mp4()) }, authorizationCurrent = { true })
        coordinator.rejectAdmission("bilibili", track, "video", "artist", "BILIBILI_AUTHORIZATION_REQUIRED")
        val rejected = coordinator.snapshot().single()
        assertEquals(OfflineStatus.FAILED, rejected.status)
        assertEquals("BILIBILI_AUTHORIZATION_REQUIRED", rejected.errorCode)
        assertNotEquals(rejected.operationId, coordinator.retry("bilibili", track)?.operationId)
        executor.run()
        assertNotNull(coordinator.resolve("bilibili", track))
    }

    private fun grant() = CacheAuthorization("a".repeat(48), "request-bilibili-123", MediaIdentity("bilibili", track, "123", 7L), 7L, OfflineEntitlementClass.ACCOUNT_BOUND)
    private fun response(bytes: ByteArray) = OfflineResponse(ByteArrayInputStream(bytes), "audio/mp4", bytes.size.toLong())
    private fun mp4() = ByteArray(24) { index -> if (index in 4..7) "ftyp"[index - 4].code.toByte() else 0 }
    private class Connection(url: URL, private val status: Int) : HttpURLConnection(url) {
        var disconnected = false
        override fun connect() = Unit
        override fun disconnect() { disconnected = true }
        override fun usingProxy() = false
        override fun getResponseCode() = status
        override fun getContentType() = "video/mp4"
        override fun getContentLengthLong() = 24L
        override fun getInputStream() = ByteArrayInputStream(ByteArray(24))
    }
    private class ManualExecutor : OfflineExecutor {
        private val tasks = mutableListOf<() -> Unit>()
        override fun submit(work: () -> Unit): OfflineTask { tasks += work; return object : OfflineTask { override fun cancel() = Unit } }
        fun run() { while (tasks.isNotEmpty()) tasks.removeAt(0).invoke() }
    }
}
