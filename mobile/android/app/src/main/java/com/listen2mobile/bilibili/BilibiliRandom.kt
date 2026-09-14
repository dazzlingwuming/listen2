package com.listen2mobile.bilibili

import java.security.SecureRandom

/** Pure JVM-safe entropy encoding; avoids Android/JDK Base64 API-level differences. */
internal object BilibiliRandom {
    private val hex = "0123456789abcdef".toCharArray()

    fun randomHex(size: Int, random: SecureRandom = SecureRandom()): String {
        require(size in 1..48)
        return lowercaseHex(ByteArray(size).also(random::nextBytes))
    }

    fun lowercaseHex(bytes: ByteArray): String {
        require(bytes.isNotEmpty() && bytes.size <= 48)
        val output = CharArray(bytes.size * 2)
        bytes.forEachIndexed { index, value ->
            val unsigned = value.toInt() and 0xff
            output[index * 2] = hex[unsigned ushr 4]
            output[index * 2 + 1] = hex[unsigned and 0x0f]
        }
        return String(output)
    }
}
