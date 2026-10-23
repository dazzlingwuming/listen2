# Listen2 Android · B 站试用版

基于桌面版 2.35.2 的共享页面，使用 WebView 加载随 APK 打包的 HTML/CSS/JS，使用 Media3 原生服务播放音频。界面和主题继续复用现有应用；后台播放、系统媒体控制由 Android 负责。

本轮范围只有 B 站：中文搜索、视频分 P、音频播放、暂停/继续、跳转进度和后台/锁屏播放。其他来源没有纳入本轮验收，Android 搜索入口只显示哔哩哔哩。MV、桌面音效等不属于本试用版承诺。

当前为界面预览版本，尚未发布正式安装包。手机首页、搜索、音乐库、播放器、设置使用统一布局；播放页提供封面和歌词切换、自动滚动、字号和时间校准。B 站音乐优先匹配 LRCLIB 歌词，并保留原有歌词匹配回退；歌词来源不会增加音乐搜索平台。增强 LRC 的逐字时间标签参与解析，不显示在正文中。支持手动搜索、更换歌词和恢复自动匹配。

## 安装

产物：`app/build/outputs/apk/debug/app-debug.apk`。

应用名称为“Listen2 安卓测试”，包名 `com.dazzlingwuming.listen2.shelltest`。它与已有的 Listen2 正式版、旧 debug 版分别安装，保留各自数据。本包使用开发签名，适合直接试用；正式发布仍需配置发布签名。

## 构建

需要 JDK 17 或 21、Android SDK Platform 35 和 Build Tools 36.1.0。仓库自带 Gradle 8.11.1 wrapper。不要使用系统默认的 JDK 24 构建这套 Gradle。

在仓库根目录的 PowerShell 中运行：

```powershell
# JAVA_HOME 指向 JDK 17/21；Android Studio 自带的 JBR 21 也可使用。
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\android\gradlew.bat -p android --no-daemon :app:testDebugUnitTest :app:assembleDebug
```

共享页面改动会由 `syncListen1Assets` 自动复制进 APK，无需额外 npm 打包。

## 验证

```powershell
npm --prefix app/listen1_chrome_extension test
node app/listen1_chrome_extension/test/android_native_playback_ui.test.js
```

设备测试 `BilibiliNetworkSmokeTest` 默认跳过；显式传入公开视频的 `biliBvid` 和 `biliCid` 后，才请求 B 站并读取少量音频验证网络。它不输出 Cookie 或签名播放地址。

手工验收：搜中文歌名，打开结果并选择分 P，播放，暂停后确认进度停止，拖动进度，回桌面和锁屏后确认继续播放，使用系统媒体按钮暂停和继续。

## 本轮修复

- 补齐当前桌面页面使用的脚本，避免 APK 缺资源。
- 中文搜索只编码一次，避免搜歌返回无关结果。
- 为原生音频请求设置网页播放器请求头，修复 B 站 CDN 对移动浏览器标识返回 403 的问题。
- 接受 B 站接口签发的 bilivideo.com / bilivideo.cn 地址及 MCDN HTTPS 端口，保留原始签名；失败时有限切换同次清单内的备用地址。
- 修复分 P 标题、时长、首页当前歌曲和进度条子作用域传值。
- 恢复暂停队列时同时恢复歌词标识，拖动进度会先准备原生播放器，避免进度、时长丢失。
- 修复封面 HTTP 地址升级和防盗链请求，恢复封面与最近播放。
- 修复设置面板被隐藏、启动能力状态被页面刷新丢弃，以及设置保存后按钮持续禁用的问题。
- 主题、歌词字号、显示翻译和每首歌曲的时间校准可保存；翻译配置保留现有原生密钥存储。

验证结果见同目录 `VALIDATION.md`。APK 编译成功不能替代真机播放验证。
