package com.listen2mobile.bilibili

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class BilibiliPackage : ReactPackage {
    private data class Composition(
        val gateway: BilibiliGateway,
        val session: BilibiliSession,
        val controller: BilibiliMvController,
        val viewManager: BilibiliMvViewManager,
    )
    @Volatile private var composition: Composition? = null

    private fun composition(context: ReactApplicationContext): Composition = composition ?: synchronized(this) {
        composition ?: BilibiliHttpsGateway().let { gateway ->
            val controller = BilibiliMvController(gateway)
            Composition(gateway, BilibiliSession(gateway, BilibiliVault(context), BilibiliQrRenderer()), controller, BilibiliMvViewManager(controller))
        }.also { composition = it }
    }

    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> {
        val shared = composition(context)
        return listOf(BilibiliModule(context, shared.gateway, shared.session, shared.controller, shared.viewManager))
    }
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(composition(context).viewManager)
}
