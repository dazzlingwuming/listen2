package com.listen2mobile

import android.app.PictureInPictureParams
import android.annotation.TargetApi
import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.listen2mobile.bilibili.BilibiliMvController
import com.listen2mobile.bilibili.BilibiliMvPolicy

class MainActivity : ReactActivity() {
  private var mvController: BilibiliMvController? = null
  private var activeMvHandle: String? = null
  private var fullscreenMv = false
  private var pendingMvSnapshot: BilibiliMvController.SemanticSnapshot? = null
  private var pipListener: ((String, Boolean) -> Unit)? = null

  /** Called only by the allow-listed Bilibili module; no JS supplied URL or orientation enters here. */
  internal fun bindMvController(controller: BilibiliMvController) {
    mvController = controller
  }
  internal fun setMvPipListener(listener: (String, Boolean) -> Unit) { pipListener = listener }

  internal fun takePendingMvSnapshot(bvid: String, cid: Long): BilibiliMvController.SemanticSnapshot? {
    val snapshot = pendingMvSnapshot ?: return null
    return snapshot.takeIf { it.bvid == bvid && it.cid == cid }?.also { pendingMvSnapshot = null }
  }

  fun discardPendingMvSnapshot() { pendingMvSnapshot = null }

  /** A process-recovery payload is semantic-only and can be consumed once by the root navigator. */
  internal fun consumePendingMvSnapshot(): BilibiliMvController.SemanticSnapshot? =
    pendingMvSnapshot?.also { pendingMvSnapshot = null }

  fun enterMvFullscreen(handle: String): Boolean {
    if (!isActiveMvHandle(handle)) return false
    activeMvHandle = handle
    fullscreenMv = true
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.hide(WindowInsets.Type.systemBars())
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
    }
    return true
  }

  fun exitMvFullscreen(handle: String): Boolean {
    if (!isActiveMvHandle(handle)) return false
    restoreMvWindow()
    return true
  }

  fun enterMvPip(handle: String): Boolean {
    if (!isActiveMvHandle(handle) || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    activeMvHandle = handle
    return enterPictureInPictureMode(PictureInPictureParams.Builder().build())
  }

  @TargetApi(Build.VERSION_CODES.O)
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: android.content.res.Configuration) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    activeMvHandle?.let { pipListener?.invoke(it, isInPictureInPictureMode) }
    if (!isInPictureInPictureMode && fullscreenMv) restoreMvWindow()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    mvController?.semanticSnapshot()?.let { snapshot ->
      if (safeSnapshot(snapshot.bvid, snapshot.cid, snapshot.qualityId, snapshot.positionMs, snapshot.playIntent) != null) {
        outState.putString(MV_BVID, snapshot.bvid)
        outState.putLong(MV_CID, snapshot.cid)
        outState.putString(MV_QUALITY, snapshot.qualityId)
        outState.putLong(MV_POSITION, snapshot.positionMs)
        outState.putBoolean(MV_PLAY_INTENT, snapshot.playIntent)
      }
    }
    super.onSaveInstanceState(outState)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    pendingMvSnapshot = savedInstanceState?.let { state ->
      val bvid = state.getString(MV_BVID)
      val quality = state.getString(MV_QUALITY)
      val cid = state.getLong(MV_CID, 0L)
      val position = state.getLong(MV_POSITION, -1L)
      if (bvid != null && quality != null && safeSnapshot(bvid, cid, quality, position, state.getBoolean(MV_PLAY_INTENT, false)) != null)
        BilibiliMvController.SemanticSnapshot(bvid, cid, quality, position, state.getBoolean(MV_PLAY_INTENT, false))
      else null
    }
  }

  private fun isActiveMvHandle(handle: String) = handle.isNotBlank() && mvController?.isActiveHandle(handle) == true
  private fun safeSnapshot(bvid: String?, cid: Long, quality: String?, position: Long, playIntent: Boolean) =
    BilibiliMvPolicy.safeSnapshot(bvid, cid, quality, position, playIntent)

  private fun restoreMvWindow() {
    fullscreenMv = false
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.show(WindowInsets.Type.systemBars())
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
    }
  }

  private companion object {
    const val MV_BVID = "listen2.mv.bvid"
    const val MV_CID = "listen2.mv.cid"
    const val MV_QUALITY = "listen2.mv.quality"
    const val MV_POSITION = "listen2.mv.position"
    const val MV_PLAY_INTENT = "listen2.mv.playIntent"
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Listen2Mobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
