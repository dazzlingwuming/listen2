package com.listen2mobile.bilibili

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class BilibiliPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) = listOf(BilibiliModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
