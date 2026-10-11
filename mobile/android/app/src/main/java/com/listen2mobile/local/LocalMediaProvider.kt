package com.listen2mobile.local

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.listen2mobile.library.LibraryRepository
import java.io.FileNotFoundException

/** Non-exported, token-only reader. It is intentionally not a document/browser provider. */
class LocalMediaProvider : ContentProvider() {
    override fun onCreate() = true
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (!LocalMediaPolicy.validReadMode(mode)) throw FileNotFoundException("not-found")
        val token = LocalMediaPolicy.tokenFrom(uri) ?: throw FileNotFoundException("not-found")
        return try {
            LocalPlaybackTokens.open(token, closeRejected = { it: ParcelFileDescriptor -> it.close() }) { recordId ->
                val app = requireNotNull(context)
                val repository = LibraryRepository.open(app)
                val source = LocalPrivateStore(app).document(recordId)
                val descriptor = LocalPlaybackReadPolicy.open(
                    { source != null && repository.localRecord(recordId)?.availability == "available" },
                    { app.contentResolver.persistedUriPermissions.any { it.uri == source && it.isReadPermission } },
                    { app.contentResolver.openFileDescriptor(requireNotNull(source), "r") ?: throw FileNotFoundException("not-found") },
                )
                if (descriptor == null) {
                    runCatching { repository.markLocalAvailability(recordId, "unreadable") }
                    throw FileNotFoundException("not-found")
                }
                descriptor
            } ?: throw FileNotFoundException("not-found")
        } catch (_: Exception) {
            // Never expose a document identity or a resolver exception through RNTP.
            throw FileNotFoundException("not-found")
        }
    }
    override fun getType(uri: Uri): String? = null
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
