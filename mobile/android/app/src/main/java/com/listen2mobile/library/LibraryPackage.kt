package com.listen2mobile.library

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Holds one application-scoped composition so Activity recreation cannot create another library owner. */
class LibraryPackage : ReactPackage {
    private data class Composition(
        val repository: LibraryRepository,
        val preferences: LibraryPreferences,
        val migration: LegacyLibraryMigration,
    )
    @Volatile private var composition: Composition? = null

    private fun composition(context: ReactApplicationContext): Composition = composition ?: synchronized(this) {
        composition ?: LibraryRepository.open(context.applicationContext).let { repository ->
            val preferences = LibraryPreferences(context.applicationContext)
            Composition(repository, preferences, LegacyLibraryMigration(repository, preferences))
        }.also { composition = it }
    }

    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> {
        val shared = composition(context)
        return listOf(LibraryBridge(context, shared.repository, shared.preferences, shared.migration))
    }
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
