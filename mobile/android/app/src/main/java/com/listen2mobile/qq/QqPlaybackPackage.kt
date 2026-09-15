package com.listen2mobile.qq

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.listen2mobile.media.MediaLeaseRegistry
import com.listen2mobile.media.MediaLeaseRegistryHolder

/** Deliberately not registered in MainApplication; it is a composition point for Plan 05-05 only. */
class QqPlaybackPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(QqPlaybackModule(context, mediaLeases = mediaLeases(context)))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
    private fun mediaLeases(context: ReactApplicationContext): MediaLeaseRegistry =
        MediaLeaseRegistryHolder.current() ?: MediaLeaseRegistry("${context.packageName}.media").also(MediaLeaseRegistryHolder::install)
}
