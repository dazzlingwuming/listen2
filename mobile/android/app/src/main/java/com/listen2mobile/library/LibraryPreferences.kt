package com.listen2mobile.library

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private val Context.libraryPreferencesStore by preferencesDataStore(name = "listen2_library_flags")

internal data class MigrationStatus(
    val backend: String,
    val phase: String,
    val attemptId: String?,
    val checksum: String?,
    val sourceRetained: Boolean,
    val laterStartValidated: Boolean,
    val cleanupEligible: Boolean,
)

/** DataStore contains only bounded non-sensitive cutover flags; user library data stays in Room. */
internal class LibraryPreferences(private val context: Context) {
    private companion object {
        val BACKEND = stringPreferencesKey("backend")
        val PHASE = stringPreferencesKey("phase")
        val ATTEMPT = stringPreferencesKey("attempt")
        val CHECKSUM = stringPreferencesKey("checksum")
        val SOURCE_RETAINED = booleanPreferencesKey("source_retained")
        val LATER_VALIDATED = booleanPreferencesKey("later_validated")
        val CLEANUP_ELIGIBLE = booleanPreferencesKey("cleanup_eligible")
        val RECORDING_ENABLED = booleanPreferencesKey("history_recording_enabled")
    }

    suspend fun status(): MigrationStatus = context.libraryPreferencesStore.data.first().let { values ->
        MigrationStatus(
            backend = values[BACKEND] ?: "legacy",
            phase = values[PHASE] ?: "idle",
            attemptId = values[ATTEMPT],
            checksum = values[CHECKSUM],
            sourceRetained = values[SOURCE_RETAINED] ?: true,
            laterStartValidated = values[LATER_VALIDATED] ?: false,
            cleanupEligible = values[CLEANUP_ELIGIBLE] ?: false,
        )
    }

    suspend fun markStaging(attemptId: String) {
        context.libraryPreferencesStore.edit { values ->
            values[BACKEND] = "legacy"
            values[PHASE] = "staging"
            values[ATTEMPT] = attemptId
            values[SOURCE_RETAINED] = true
            values[LATER_VALIDATED] = false
            values[CLEANUP_ELIGIBLE] = false
            values.remove(CHECKSUM)
        }
    }

    suspend fun activate(attemptId: String, checksum: String) {
        context.libraryPreferencesStore.edit { values ->
            values[BACKEND] = "room"
            values[PHASE] = "active"
            values[ATTEMPT] = attemptId
            values[CHECKSUM] = checksum
            values[SOURCE_RETAINED] = true
            values[LATER_VALIDATED] = false
            values[CLEANUP_ELIGIBLE] = false
        }
    }

    /** A separate startup must verify Room first; this does not delete or alter the legacy source. */
    suspend fun markLaterStartupValidated() {
        val current = status()
        if (current.backend != "room" || current.phase != "active") return
        context.libraryPreferencesStore.edit { values ->
            values[LATER_VALIDATED] = true
            values[CLEANUP_ELIGIBLE] = true
            values[SOURCE_RETAINED] = true
        }
    }

    /** History keeps only this privacy toggle in DataStore; evidence and aggregates stay in Room. */
    suspend fun recordingEnabled(): Boolean = context.libraryPreferencesStore.data.first()[RECORDING_ENABLED] ?: true
    suspend fun setRecordingEnabled(enabled: Boolean) { context.libraryPreferencesStore.edit { values -> values[RECORDING_ENABLED] = enabled } }
}
