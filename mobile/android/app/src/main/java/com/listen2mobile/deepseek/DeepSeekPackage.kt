package com.listen2mobile.deepseek

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DeepSeekPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) = listOf(DeepSeekModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
