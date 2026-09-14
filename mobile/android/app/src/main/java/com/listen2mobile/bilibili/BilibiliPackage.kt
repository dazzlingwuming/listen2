package com.listen2mobile.bilibili

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class BilibiliPackage : ReactPackage {
    private data class Composition(
        val gateway: BilibiliGateway,
        val session: BilibiliSession,
        val controller: BilibiliMvController,
    )
    @Volatile private var composition: Composition? = null

    private fun composition(context: ReactApplicationContext): Composition = composition ?: synchronized(this) {
        composition ?: BilibiliHttpsGateway().let { gateway ->
            Composition(gateway, BilibiliSession(gateway, BilibiliVault(context), BilibiliQrRenderer()), BilibiliMvController(gateway))
        }.also { composition = it }
    }

    override fun createNativeModules(context: ReactApplicationContext): List<BilibiliModule> {
        val shared = composition(context)
        return listOf(BilibiliModule(context, shared.gateway, shared.session, shared.controller))
    }
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(BilibiliMvViewManager(composition(context).controller))
}
