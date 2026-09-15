package com.listen2mobile.netease

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.listen2mobile.media.MediaLeaseRegistry
import com.listen2mobile.media.MediaLeaseRegistryHolder

class NeteasePlaybackPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(NeteasePlaybackModule(context, NeteasePlaybackGateway(), leases(context)))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
    private fun leases(context: ReactApplicationContext): MediaLeaseRegistry = MediaLeaseRegistryHolder.current() ?: MediaLeaseRegistry("${context.packageName}.media").also(MediaLeaseRegistryHolder::install)
}
