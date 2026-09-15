package com.listen2mobile.media

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * The only remote-media shape that may cross the React Native boundary. Transport
 * credentials live in [NativeTransport] inside [MediaLeaseRegistry] and are never
 * copied into this descriptor.
 */
internal data class MediaIdentity(
    val source: String,
    val trackId: String,
    val partId: String?,
    val generation: Long,
) {
    fun isValid(): Boolean = source in SOURCES && trackId.matches(TRACK_ID) &&
        (partId == null || partId.matches(PART_ID)) && generation >= 0L

    private companion object {
        val SOURCES = setOf("bilibili", "netease", "kugou", "qq", "kuwo")
        val TRACK_ID = Regex("[A-Za-z0-9_:-]{1,160}")
        val PART_ID = Regex("[A-Za-z0-9_:-]{1,80}")
    }
}

internal data class MediaRendition(
    val id: String,
    val label: String,
    val mimeType: String,
    val container: String,
    val codec: String,
    val durationMs: Long,
    val sizeBytes: Long?,
) {
    fun isValid(): Boolean = id.matches(Regex("[A-Za-z0-9_.-]{1,80}")) &&
        label.length in 1..80 && mimeType.matches(Regex("audio/[a-z0-9.+-]{1,48}")) &&
        container.matches(Regex("[a-z0-9]{1,16}")) && codec.matches(Regex("[A-Za-z0-9._-]{1,80}")) &&
        durationMs in 1..(24L * 60L * 60L * 1000L) && (sizeBytes == null || sizeBytes in 1..MAX_SIZE_BYTES)

    private companion object { const val MAX_SIZE_BYTES = 20L * 1024L * 1024L * 1024L }
}

internal enum class EntitlementStatus(val action: String) {
    ALLOWED("play"),
    LOGIN_REQUIRED("login"),
    MEMBERSHIP_REQUIRED("membership"),
    REGION_BLOCKED("unavailable"),
    DRM_UNSUPPORTED("unavailable"),
    EXPIRED("retry"),
    DOWNLOAD_FIRST("download"),
    PROVIDER_UNAVAILABLE("retry"),
    CANCELLED("retry"),
}

internal enum class LeaseStatus {
    ACTIVE, UNKNOWN, EXPIRED, CANCELLED, IDENTITY_MISMATCH, ACCOUNT_CHANGED, READ_LIMIT,
}

/** Native-only proof that an immediately preceding provider resolution is still current. */
internal data class CacheAuthorization(
    val leaseId: String,
    val requestId: String,
    val identity: MediaIdentity,
    val accountGeneration: Long,
)

/** Private data only. It must never appear in a bridge result, Redux, logs, or persistence. */
internal data class NativeTransport(
    val url: String,
    val headers: Map<String, String>,
    val candidates: List<String> = emptyList(),
    val localFile: File? = null,
    /** Source is native-proven context, not caller input or a JS-visible field. */
    val source: String = "bilibili",
)

internal data class MediaDescriptor(
    val version: Int,
    val requestId: String,
    val identity: MediaIdentity,
    val selectedRendition: MediaRendition?,
    val playableUri: String?,
    val leaseId: String?,
    val leaseExpiresAt: Long?,
    val entitlement: EntitlementStatus,
) {
    fun isSafeForJs(): Boolean {
        if (version != VERSION || !identity.isValid()) return false
        if (entitlement != EntitlementStatus.ALLOWED) return playableUri == null && leaseId == null
        val rendition = selectedRendition ?: return false
        val uri = playableUri ?: return false
        return (leaseId?.matches(LEASE_ID) == true &&
            uri.matches(Regex("content://[A-Za-z0-9._-]+/lease/$leaseId"))) ||
            (leaseId == null && uri.startsWith("content://"))
    }

    companion object {
        const val VERSION = 1
        private val LEASE_ID = Regex("[a-f0-9]{48}")

        fun downloadFirst(identity: MediaIdentity) = MediaDescriptor(
            VERSION, "", identity, null, null, null, null, EntitlementStatus.DOWNLOAD_FIRST,
        )

        fun verifiedLocal(identity: MediaIdentity, uri: String, mime: String, container: String, codec: String, durationMs: Long) = MediaDescriptor(
            VERSION,
            "local",
            identity,
            MediaRendition("local", "offline", mime, container, codec, durationMs, null),
            uri,
            null,
            null,
            EntitlementStatus.ALLOWED,
        )
    }
}

/**
 * Converts the private descriptor into the exact, transport-free RN shape.
 * Keep this at the bridge boundary so individual providers cannot accidentally
 * publish a URL, header, lease id, or provider response field.
 */
internal fun MediaDescriptor.toWritableMap(
    parts: List<BridgeMediaPart> = emptyList(),
): WritableMap {
    require(entitlement == EntitlementStatus.ALLOWED)
    val rendition = requireNotNull(selectedRendition)
    val uri = requireNotNull(playableUri)
    val expiresAt = requireNotNull(leaseExpiresAt)
    return Arguments.createMap().apply {
        putInt("version", version)
        putString("requestId", requestId)
        putString("source", identity.source)
        putString("semanticTrackId", identity.trackId)
        identity.partId?.let { putString("partId", it) }
        putDouble("generation", identity.generation.toDouble())
        putString("playableUri", uri)
        putString("mimeType", rendition.mimeType)
        putString("container", rendition.container)
        putString("codec", rendition.codec)
        putDouble("durationMs", rendition.durationMs.toDouble())
        rendition.sizeBytes?.let { putDouble("sizeBytes", it.toDouble()) }
        putString("selectedRenditionId", rendition.id)
        putArray("renditions", Arguments.createArray().apply {
            pushMap(Arguments.createMap().apply {
                putString("id", rendition.id)
                putString("label", rendition.label)
                putString("mimeType", rendition.mimeType)
                putString("container", rendition.container)
                putString("codec", rendition.codec)
                putDouble("durationMs", rendition.durationMs.toDouble())
                rendition.sizeBytes?.let { putDouble("sizeBytes", it.toDouble()) }
            })
        })
        if (parts.isNotEmpty()) {
            putArray("parts", Arguments.createArray().apply {
                parts.forEach { part ->
                    pushMap(Arguments.createMap().apply {
                        putString("cid", part.cid)
                        putString("page", part.page)
                        putString("title", part.title)
                        part.durationMs?.let { putDouble("durationMs", it.toDouble()) }
                    })
                }
            })
        }
        putString("entitlementStatus", "allowed")
        putDouble("leaseExpiresAt", expiresAt.toDouble())
    }
}

internal data class BridgeMediaPart(
    val cid: String,
    val page: String,
    val title: String,
    val durationMs: Long?,
)

/** Bounded, process-local lease registry. A restart intentionally invalidates every lease. */
internal class MediaLeaseRegistry(
    private val authority: String,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private data class Lease(
        val requestId: String,
        val identity: MediaIdentity,
        val rendition: MediaRendition,
        val transport: NativeTransport,
        val accountGeneration: Long,
        val expiresAt: Long,
        var reads: Int = 0,
        var cancelled: Boolean = false,
    )

    private val leases = ConcurrentHashMap<String, Lease>()

    fun register(requestId: String, identity: MediaIdentity, rendition: MediaRendition, transport: NativeTransport, accountGeneration: Long): MediaDescriptor {
        require(requestId.matches(REQUEST_ID) && identity.isValid() && rendition.isValid() && accountGeneration >= 0L)
        require(transport.localFile != null || isSafeNativeTransport(transport))
        prune()
        require(leases.size < MAX_LEASES)
        val leaseId = randomLeaseId()
        val expiresAt = clock() + MAX_TTL_MS
        leases[leaseId] = Lease(requestId, identity, rendition, transport, accountGeneration, expiresAt)
        return MediaDescriptor(
            MediaDescriptor.VERSION,
            requestId,
            identity,
            rendition,
            "content://$authority/lease/$leaseId",
            leaseId,
            expiresAt,
            EntitlementStatus.ALLOWED,
        )
    }

    fun validate(leaseId: String?, identity: MediaIdentity, accountGeneration: Long): LeaseStatus {
        if (leaseId == null || !leaseId.matches(LEASE_ID)) return LeaseStatus.UNKNOWN
        val lease = leases[leaseId] ?: return LeaseStatus.UNKNOWN
        if (lease.cancelled) return LeaseStatus.CANCELLED
        if (clock() >= lease.expiresAt) { leases.remove(leaseId, lease); return LeaseStatus.EXPIRED }
        if (lease.identity != identity) return LeaseStatus.IDENTITY_MISMATCH
        if (lease.accountGeneration != accountGeneration) return LeaseStatus.ACCOUNT_CHANGED
        if (lease.reads >= MAX_READS) return LeaseStatus.READ_LIMIT
        return LeaseStatus.ACTIVE
    }

    fun transportFor(leaseId: String?, identity: MediaIdentity, accountGeneration: Long): NativeTransport? {
        if (validate(leaseId, identity, accountGeneration) != LeaseStatus.ACTIVE) return null
        val lease = leases[leaseId] ?: return null
        lease.reads += 1
        return lease.transport
    }

    fun transportForProvider(leaseId: String): NativeTransport? {
        val lease = leases[leaseId] ?: return null
        if (lease.cancelled || clock() >= lease.expiresAt || lease.reads >= MAX_READS) return null
        lease.reads += 1
        return lease.transport
    }

    fun cacheAuthorization(requestId: String, source: String, trackId: String): CacheAuthorization? {
        val lease = leases.values.firstOrNull {
            it.requestId == requestId &&
                it.identity.source == source &&
                it.identity.trackId == trackId &&
                !it.cancelled &&
                clock() < it.expiresAt
        } ?: return null
        val leaseId = leases.entries.firstOrNull { it.value === lease }?.key ?: return null
        return CacheAuthorization(leaseId, requestId, lease.identity, lease.accountGeneration)
    }

    fun isCurrentCacheAuthorization(value: CacheAuthorization): Boolean =
        validate(value.leaseId, value.identity, value.accountGeneration) == LeaseStatus.ACTIVE

    fun cancel(requestId: String) { leases.values.filter { it.requestId == requestId }.forEach { it.cancelled = true } }
    fun invalidateAccount(accountGeneration: Long) { leases.values.filter { it.accountGeneration != accountGeneration }.forEach { it.cancelled = true } }

    private fun prune() { leases.entries.removeIf { (_, value) -> value.cancelled || clock() >= value.expiresAt } }
    private fun randomLeaseId(): String = ByteArray(24).also(SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) }
    private fun isSafeNativeTransport(transport: NativeTransport): Boolean = transport.url.length <= MAX_URL_BYTES &&
        transport.candidates.size <= MAX_CANDIDATES && transport.candidates.all { it.length <= MAX_URL_BYTES } &&
        MediaStreamPolicy.isAllowedTransport(transport)

    companion object {
        const val MAX_TTL_MS = 120_000L
        private const val MAX_LEASES = 128
        private const val MAX_READS = 4_096
        private const val MAX_CANDIDATES = 4
        private const val MAX_URL_BYTES = 4_096
        private val REQUEST_ID = Regex("[A-Za-z0-9_-]{8,96}")
        private val LEASE_ID = Regex("[a-f0-9]{48}")
    }
}

/** Provider singleton bridge; descriptor leases are deliberately not persisted. */
internal object MediaLeaseRegistryHolder {
    @Volatile private var registry: MediaLeaseRegistry? = null
    fun install(value: MediaLeaseRegistry) { registry = value }
    fun current(): MediaLeaseRegistry? = registry
}
