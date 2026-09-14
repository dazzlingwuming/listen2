package com.listen2mobile.bilibili

import android.graphics.Bitmap
import android.util.Base64
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter

internal interface BilibiliQrRendererContract { fun render(value: String): String }

internal class BilibiliQrRenderer : BilibiliQrRendererContract {
    override fun render(value: String): String {
        require(value.length <= 2048)
        val matrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 384, 384)
        val bitmap = Bitmap.createBitmap(384, 384, Bitmap.Config.ARGB_8888)
        for (x in 0 until 384) for (y in 0 until 384) bitmap.setPixel(x, y, if (matrix[x, y]) 0xff000000.toInt() else 0xffffffff.toInt())
        val output = java.io.ByteArrayOutputStream()
        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) throw IllegalStateException("qr-render-failed")
        val png = output.toByteArray()
        require(png.size <= 128 * 1024)
        return "data:image/png;base64," + Base64.encodeToString(png, Base64.NO_WRAP)
    }
}
