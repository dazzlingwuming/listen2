package com.listen2mobile.deepseek

import android.app.Activity
import android.os.Bundle
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Non-exported native-only password surface; no key crosses the React Native bridge. */
class DeepSeekKeyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        val input = EditText(this).apply {
            hint = "DeepSeek API key"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
        val message = TextView(this).apply { text = "仅保存在此设备的安全存储中。" }
        val save = Button(this).apply {
            text = "保存"
            setOnClickListener {
                val status = DeepSeekVault(this@DeepSeekKeyActivity).saveFromNativeEntry(input.text.toString())
                input.text?.clear()
                setResult(
                    if (status.state == DeepSeekVault.State.Configured && status.errorCode == null)
                        RESULT_OK
                    else RESULT_CANCELED,
                )
                finish()
            }
        }
        val cancel = Button(this).apply {
            text = "取消，不保存"
            setOnClickListener {
                input.text?.clear()
                setResult(RESULT_CANCELED)
                finish()
            }
        }
        setContentView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 48, 48, 48); addView(message); addView(input); addView(save); addView(cancel) })
    }
}
