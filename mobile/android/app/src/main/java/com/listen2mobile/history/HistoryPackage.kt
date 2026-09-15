package com.listen2mobile.history

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.listen2mobile.library.LibraryPreferences
import com.listen2mobile.library.LibraryRepository

/** Independent package: history does not piggyback on the library or local-media bridge. */
class HistoryPackage : ReactPackage {
    @Volatile private var module: HistoryModule? = null
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(module ?: synchronized(this) {
        module ?: LibraryRepository.open(context.applicationContext).let { repository ->
            HistoryModule(context, ListeningLedger(repository.historyDatabase()), LibraryPreferences(context.applicationContext))
        }.also { module = it }
    })
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
