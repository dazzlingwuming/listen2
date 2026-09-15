package com.listen2mobile.kuwo

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.listen2mobile.media.MediaLeaseRegistry
import com.listen2mobile.media.MediaLeaseRegistryHolder

/** Registered later at the single application composition point. */
class KuwoPlaybackPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(KuwoPlaybackModule(context, mediaLeases = mediaLeases(context)))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
    private fun mediaLeases(context: ReactApplicationContext): MediaLeaseRegistry =
        MediaLeaseRegistryHolder.current() ?: MediaLeaseRegistry("${context.packageName}.media").also(MediaLeaseRegistryHolder::install)
}
