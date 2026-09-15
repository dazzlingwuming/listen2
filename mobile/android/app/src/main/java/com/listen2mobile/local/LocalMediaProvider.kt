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
        val recordId = LocalPlaybackTokens.consume(token) ?: throw FileNotFoundException("not-found")
        val source = LocalPrivateStore(requireNotNull(context)).document(recordId) ?: throw FileNotFoundException("not-found")
        return try {
            requireNotNull(context).contentResolver.openFileDescriptor(source, "r") ?: throw FileNotFoundException("not-found")
        } catch (_: Exception) {
            // Keep the opaque row repairable; neither the raw document identity nor a provider
            // exception crosses this boundary.
            LibraryRepository.open(requireNotNull(context)).markLocalAvailability(recordId, "unreadable")
            throw FileNotFoundException("not-found")
        }
    }
    override fun getType(uri: Uri): String? = null
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
