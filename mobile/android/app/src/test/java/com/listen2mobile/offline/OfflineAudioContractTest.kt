package com.listen2mobile.offline

import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineAudioContractTest {
    @Test fun semanticSourcesAndClosedRoutesRejectPassiveAndArbitraryDestinations() {
        assertTrue(OfflinePolicy.accepted("netease", "netrack_1"))
        assertTrue(OfflinePolicy.accepted("kugou", "kgtrack_abcdefgh"))
        assertFalse(OfflinePolicy.accepted("bilibili", "bitrack_1"))
        assertFalse(OfflineRoute.KUGOU_MEDIA.permits(java.net.URL("https://example.com/audio.mp3")))
        assertFalse(OfflineRoute.KUGOU_MEDIA.permits(java.net.URL("https://fs.w.kugou.com/audio.mp3")))
        assertFalse(OfflineRoute.KUGOU_MEDIA.permits(java.net.URL("https://webfs.kugou.com/audio.mp3")))
        assertFalse(OfflineRoute.NETEASE_MEDIA.permits(java.net.URL("http://music.163.com/song/media/outer/url?id=1")))
        assertTrue(OfflineRoute.KUGOU_BOOTSTRAP.permits(java.net.URL("https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=abcdefgh")))
    }

    @Test fun boundedBootstrapReadRejectsTheByteAfterTheLimit() {
        assertEquals(4, BoundedRead.bytes(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)), 4).size)
        try {
            BoundedRead.bytes(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4, 5)), 4)
            throw AssertionError("expected bounded read failure")
        } catch (expected: java.io.IOException) {
            assertEquals("BODY_TOO_LARGE", expected.message)
        }
    }

    @Test fun transportAllowsNoMoreThanTwoValidatedRedirects() {
        val first = URL("https://music.163.com/song/media/outer/url?id=1.mp3")
        val second = URL("https://m7.music.126.net/a.mp3")
        val third = URL("https://m8.music.126.net/b.mp3")
        val responses = mutableListOf(
            RedirectConnection(first, 302, second.toString()),
            RedirectConnection(second, 302, third.toString()),
            RedirectConnection(third, 200, null),
        )
        HttpOfflineTransport { responses.removeAt(0) }
            .fetch(first.toString(), OfflineRoute.NETEASE_MEDIA, System.nanoTime() / 1_000_000 + 1_000)
            .close()
        assertTrue(responses.isEmpty())

        val overflow = mutableListOf(
            RedirectConnection(first, 302, second.toString()),
            RedirectConnection(second, 302, third.toString()),
            RedirectConnection(third, 302, second.toString()),
        )
        try {
            HttpOfflineTransport { overflow.removeAt(0) }
                .fetch(first.toString(), OfflineRoute.NETEASE_MEDIA, System.nanoTime() / 1_000_000 + 1_000)
            throw AssertionError("expected redirect rejection")
        } catch (expected: java.io.IOException) {
            assertEquals("REDIRECT_REJECTED", expected.message)
        }
        assertTrue(overflow.isEmpty())

        try {
            HttpOfflineTransport {
                RedirectConnection(first, 302, "https://sharefs.kugou.com/not-a-netease-hop.mp3")
            }.fetch(first.toString(), OfflineRoute.NETEASE_MEDIA, System.nanoTime() / 1_000_000 + 1_000)
            throw AssertionError("expected cross-provider redirect rejection")
        } catch (expected: java.io.IOException) {
            assertEquals("REDIRECT_REJECTED", expected.message)
        }
    }

    @Test fun neteaseAndKugouUseOnlyNativeRoutesAndCommitVerifiedMediaAtomically() {
        val executor = ManualExecutor()
        val transport = FakeTransport().apply {
            neteaseMedia = audio()
            kugouBootstrap = "{\"play_url\":\"https://sharefs.kugou.com/media/abcdefgh.mp3\"}".toByteArray()
            kugouMedia = audio()
        }
        val root = Files.createTempDirectory("offline-contract").toFile()
        val coordinator = coordinator(root, transport, executor)
        coordinator.enqueue("netease", "netrack_1", "title", "artist")
        coordinator.enqueue("kugou", "kgtrack_abcdefgh", "title", "artist")
        assertFalse(File(root, OfflinePolicy.key("netease", "netrack_1")).exists())
        executor.runAll()
        assertEquals(listOf(OfflineRoute.NETEASE_MEDIA, OfflineRoute.KUGOU_BOOTSTRAP, OfflineRoute.KUGOU_MEDIA), transport.routes)
        assertNotNull(coordinator.resolve("netease", "netrack_1"))
        assertNotNull(coordinator.resolve("kugou", "kgtrack_abcdefgh"))
        assertFalse(root.listFiles().orEmpty().any { it.name.endsWith(".part") || it.name.endsWith(".tmp") })
    }

    @Test fun duplicateAdmissionConvergesAndTwoWorkersPlusEightWaitingIsEnforced() {
        val executor = ManualExecutor()
        val coordinator = coordinator(Files.createTempDirectory("offline-contract").toFile(), FakeTransport(), executor)
        val first = coordinator.enqueue("netease", "netrack_1", "t", "a")
        assertEquals(first.operationId, coordinator.enqueue("netease", "netrack_1", "changed", "artist").operationId)
        (2L..10L).forEach { coordinator.enqueue("netease", "netrack_$it", "t", "a") }
        assertEquals(10, coordinator.snapshot().size)
        assertEquals("QUEUE_FULL", coordinator.enqueue("netease", "netrack_11", "t", "a").errorCode)
    }

    @Test fun quotaReservationsAndOversizeHaveStableOutcomes() {
        val executor = ManualExecutor()
        val transport = FakeTransport().apply { neteaseMedia = audio(20) }
        val limits = OfflineLimits(fileBytes = 16, totalBytes = 20, bootstrapBytes = 8)
        val coordinator = OfflineCoordinator(Files.createTempDirectory("offline-contract").toFile(), transport, executor, { 7L }, limits)
        coordinator.enqueue("netease", "netrack_1", "t", "a")
        executor.runAll()
        assertEquals("FILE_TOO_LARGE", coordinator.snapshot().single().errorCode)
        transport.neteaseMedia = audio(12)
        coordinator.retry("netease", "netrack_1")
        coordinator.enqueue("netease", "netrack_2", "t", "a")
        executor.runAll()
        assertTrue(coordinator.snapshot().any { it.errorCode == "CAPACITY_EXCEEDED" })
    }

    @Test fun understatedPositiveContentLengthCannotOverrunQuotaOrPublishReady() {
        val executor = ManualExecutor()
        val transport = FakeTransport().apply { neteaseMedia = audio(12); neteaseContentLength = 4 }
        val coordinator = OfflineCoordinator(
            Files.createTempDirectory("offline-contract").toFile(), transport, executor,
            { 7L }, OfflineLimits(fileBytes = 16, totalBytes = 20, bootstrapBytes = 8),
        )
        coordinator.enqueue("netease", "netrack_1", "t", "a")
        executor.runAll()
        val entry = coordinator.snapshot().single()
        assertEquals(OfflineStatus.FAILED, entry.status)
        assertEquals("PROVIDER_REJECTED", entry.errorCode)
        assertNull(coordinator.resolve("netease", "netrack_1"))
    }

    @Test fun absoluteDeadlineAppliesAcrossProviderAndMediaSteps() {
        var now = 0L
        val executor = ManualExecutor()
        val transport = FakeTransport().apply {
            neteaseMedia = audio()
            afterFetch = { now = 11L }
        }
        val coordinator = OfflineCoordinator(
            Files.createTempDirectory("offline-contract").toFile(), transport, executor,
            { 7L }, OfflineLimits(fileBytes = 32, totalBytes = 32, bootstrapBytes = 8, transferDeadlineMillis = 10), { now },
        )
        coordinator.enqueue("netease", "netrack_1", "t", "a")
        executor.runAll()
        assertEquals("NETWORK", coordinator.snapshot().single().errorCode)
    }

    @Test fun cancellationTombstonesWorkerAndEmitsProgressAndTerminalSnapshots() {
        val executor = ManualExecutor()
        val transport = FakeTransport().apply { neteaseMedia = audio() }
        val coordinator = coordinator(Files.createTempDirectory("offline-contract").toFile(), transport, executor)
        val states = mutableListOf<String>()
        coordinator.setObserver { snapshot -> states += snapshot.singleOrNull()?.status?.wire ?: "empty" }
        val entry = coordinator.enqueue("netease", "netrack_1", "t", "a")
        coordinator.cancel(entry.operationId)
        executor.runAll()
        assertEquals(OfflineStatus.CANCELLED, coordinator.snapshot().single().status)
        assertTrue(states.contains("queued"))
        assertTrue(states.contains("cancelled"))
        assertFalse(states.contains("ready"))
    }

    @Test fun asynchronousProgressAndReadySnapshotsAreOrdered() {
        val executor = ManualExecutor()
        val coordinator = coordinator(
            Files.createTempDirectory("offline-contract").toFile(),
            FakeTransport().apply { neteaseMedia = audio() },
            executor,
        )
        val snapshots = mutableListOf<List<OfflineEntry>>()
        coordinator.setObserver { snapshots += it }
        coordinator.enqueue("netease", "netrack_1", "title", "artist")
        executor.runAll()
        val statuses = snapshots.mapNotNull { it.singleOrNull()?.status }
        assertTrue(statuses.contains(OfflineStatus.QUEUED))
        assertTrue(statuses.contains(OfflineStatus.DOWNLOADING))
        assertEquals(OfflineStatus.READY, statuses.last())
        val entry = snapshots.last().single()
        assertEquals(24L, entry.downloadedBytes)
        assertEquals(24L, entry.totalBytes)
        assertEquals(null, entry.errorCode)
    }

    @Test fun restartUsesValidBackupRepairsStaleArtifactsAndInvalidatesCorruption() {
        val root = Files.createTempDirectory("offline-contract").toFile()
        val executor = ManualExecutor()
        val transport = FakeTransport().apply { neteaseMedia = audio() }
        val original = coordinator(root, transport, executor)
        original.enqueue("netease", "netrack_1", "t", "a")
        executor.runAll()
        File(root, "catalog.previous.json").writeBytes(File(root, "catalog.json").readBytes())
        File(root, "catalog.json").writeText("broken")
        File(root, "abandoned.part").writeText("partial")
        File(root, OfflinePolicy.key("netease", "netrack_2")).writeText("orphan")
        val restored = coordinator(root, FakeTransport(), ManualExecutor())
        assertNotNull(restored.resolve("netease", "netrack_1"))
        assertFalse(File(root, "abandoned.part").exists())
        assertFalse(File(root, OfflinePolicy.key("netease", "netrack_2")).exists())
        File(root, OfflinePolicy.key("netease", "netrack_1")).appendText("corrupt")
        assertNull(restored.resolve("netease", "netrack_1"))
        assertFalse(File(root, OfflinePolicy.key("netease", "netrack_1")).exists())
    }

    private fun coordinator(root: File, transport: FakeTransport, executor: ManualExecutor) = OfflineCoordinator(root, transport, executor, { 100L })
    private class ManualExecutor : OfflineExecutor {
        private val work = mutableListOf<() -> Unit>()
        override fun submit(work: () -> Unit): OfflineTask { this.work += work; return object : OfflineTask { override fun cancel() = Unit } }
        fun runAll() { while (work.isNotEmpty()) work.removeAt(0).invoke() }
    }
    private class FakeTransport : OfflineTransport {
        val routes = mutableListOf<OfflineRoute>()
        var neteaseMedia: ByteArray = audio(); var kugouBootstrap: ByteArray = ByteArray(0); var kugouMedia: ByteArray = audio()
        var neteaseContentLength: Long? = null
        var afterFetch: (() -> Unit)? = null
        override fun fetch(url: String, route: OfflineRoute, deadlineMillis: Long): OfflineResponse {
            routes += route
            val body = when (route) { OfflineRoute.NETEASE_MEDIA -> neteaseMedia; OfflineRoute.KUGOU_BOOTSTRAP -> kugouBootstrap; OfflineRoute.KUGOU_MEDIA -> kugouMedia }
            afterFetch?.invoke()
            val declaredLength = if (route == OfflineRoute.NETEASE_MEDIA) neteaseContentLength ?: body.size.toLong() else body.size.toLong()
            return OfflineResponse(ByteArrayInputStream(body), if (route == OfflineRoute.KUGOU_BOOTSTRAP) "application/json" else "audio/mpeg", declaredLength)
        }
    }

    private class RedirectConnection(url: URL, private val code: Int, private val location: String?) : HttpURLConnection(url) {
        init { contentLength = 24 }
        override fun connect() = Unit
        override fun disconnect() = Unit
        override fun usingProxy() = false
        override fun getResponseCode() = code
        override fun getHeaderField(name: String?) = if (name == "Location") location else null
        override fun getInputStream() = ByteArrayInputStream(audio())
        override fun getContentType() = "audio/mpeg"
    }

    private companion object {
        fun audio(size: Int = 24): ByteArray = ByteArray(size) {
            if (it == 0) 'I'.code.toByte() else if (it == 1) 'D'.code.toByte() else if (it == 2) '3'.code.toByte() else 7
        }
    }
}
