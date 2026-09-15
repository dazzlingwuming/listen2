package com.listen2mobile.bilibili

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.listen2mobile.media.MediaLeaseRegistry
import com.listen2mobile.media.MediaLeaseRegistryHolder

class BilibiliPackage : ReactPackage {
    private data class Composition(
        val gateway: BilibiliGateway,
        val session: BilibiliSession,
        val controller: BilibiliMvController,
        val viewManager: BilibiliMvViewManager,
        val mediaLeases: MediaLeaseRegistry,
    )
    @Volatile private var composition: Composition? = null

    private fun composition(context: ReactApplicationContext): Composition = composition ?: synchronized(this) {
        composition ?: BilibiliHttpsGateway().let { gateway ->
            val controller = BilibiliMvController(gateway)
            val leases = MediaLeaseRegistry("${context.packageName}.media")
            MediaLeaseRegistryHolder.install(leases)
            Composition(gateway, BilibiliSession(gateway, BilibiliVault(context), BilibiliQrRenderer()), controller, BilibiliMvViewManager(controller), leases)
        }.also { composition = it }
    }

    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> {
        val shared = composition(context)
        return listOf(BilibiliModule(context, shared.gateway, shared.session, shared.controller, shared.viewManager, shared.mediaLeases))
    }
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(composition(context).viewManager)
}
