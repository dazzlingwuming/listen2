# Listen2 Android · B 站版

下载 [Android 2.35.6 预览版 APK](https://github.com/dazzlingwuming/listen2/releases/tag/v2.35.6-android.1)。支持 Android 8.0 及以上，下载后安装。

共享桌面 2.35.6 的主题与页面，使用 Media3 原生服务播放音频。音乐入口仅提供哔哩哔哩。

- B 站搜索、分 P、登录入口、原生后台播放与系统媒体控制。
- 歌单搜索、播放全部、队列选择；顺序、单曲循环和每轮不重复的随机播放。
- 自动和手动歌词、歌词与翻译保存、歌词页时间校准、DeepSeek 翻译及原生密钥存储。
- 桌面 JSON 歌单导入导出、GitHub Gist 双向同步。
- 13 个内置主题及图片配色；新版首页、音乐库、播放器、队列和设置。

发布包名为 `com.dazzlingwuming.listen2.android`，名称 Listen2，与此前测试包 `com.dazzlingwuming.listen2.shelltest` 并行安装。测试包数据保留，可先导出 JSON，再导入发布版。

## 构建

需要 JDK 17/21、Android SDK Platform 35、Build Tools 36.1.0；仓库自带 Gradle 8.11.1。

```powershell
# 设置 JAVA_HOME 和 ANDROID_HOME 后，在仓库根目录执行：
.\android\gradlew.bat -p android --no-daemon :app:testDebugUnitTest :app:assembleDebug
# Windows 发布构建：
.\android\build-release.ps1
```

共享页面自动复制进 APK，无需 npm 打包。发布包在 `android/app/build/outputs/apk/release/app-release.apk`。

发布脚本复用 `%LOCALAPPDATA%\Listen2\signing` 的固定签名，首次运行自动创建；口令由当前 Windows 用户的 DPAPI 加密。请私下备份签名及恢复凭据，不要上传仓库。其他环境可通过 `LISTEN2_KEYSTORE`、`LISTEN2_KEYSTORE_PASSWORD`、`LISTEN2_KEY_ALIAS` 提供同一签名。

验证结果见 [VALIDATION.md](VALIDATION.md)。当前为 B 站预览版，其他音乐平台、MV 与桌面音效不在本次范围内。
