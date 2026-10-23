# Android B 站界面预览验证

日期：2026-10-23。代码位于 `codex/android-shell-mvp` 工作树，基于桌面 2.35.2。未修改原工作目录的主分支，未提交、推送或发布正式安装包。

## 设备与构建

- OnePlus PHK110，Android 16，真实设备 USB 调试。
- 安装包：`app/build/outputs/apk/debug/app-debug.apk`，开发签名。
- 包名：`com.dazzlingwuming.listen2.shelltest`，显示名称：Listen2 安卓测试。
- JBR 21、Gradle 8.11.1、compileSdk 35、Build Tools 36.1.0。
- 当前预览 APK SHA-256：`4C301B2DA4026ED3E0A98BC8058E3909EEF36FE086A1590204DA4CBC6B72C3CE`。
- 旧 Listen2 安装和数据均保留。测试版单独安装。

## 自动验证

- Android JVM：207 个测试，0 失败、0 错误。
- 共享前端 `npm test`：23 个测试脚本通过。
- Android 专项：原生播放 UI、播放接管、歌词状态、队列 UI、B 站类型化接口、本地数据 UI，共 6 个脚本通过。
- 新增回归覆盖中文查询单次编码、歌词歌名/歌手/时长匹配、增强 LRC 标签清理、设置启动异步竞争、设置保存后刷新导致按钮持续禁用。
- 显式启用 BilibiliNetworkSmokeTest：读取真实音频 1024 字节，1 项通过。
- `git diff --check` 通过；存在 Windows 行尾规范化提示。

## 真机结果

| 操作 | 实际结果 |
| --- | --- |
| 搜索“周杰伦 青花瓷” | 20 条 B 站结果，首屏封面全部加载，无横向溢出 |
| 播放公开视频 | MediaSession 为 PLAYING，音频持续前进，未出现播放错误 |
| 重新打开应用 | 恢复暂停队列、封面、最近播放和歌词 |
| 恢复队列后直接拖动进度 | 定位至 60000 ms，保持暂停，时长 240000 ms，滑块显示 60000 |
| 自动歌词 | 《青花瓷》匹配到周杰伦版本，44 行，显示状态 synchronized |
| 逐字时间标签 | UI 正文中无 `<mm:ss.xxx>` 或转义后的逐字标签，行时间保留 |
| 歌词高亮和滚动 | 随原生播放进度更新，当前句滚动进入可见区域；暂停后重新打开也能定位 |
| 手动歌词 | 搜索得到真实候选；暂停时选中立即生效，重启后保留；恢复自动匹配有效 |
| 歌词时间校准 | +500 ms 生效且保存，验证后已重置为 0 |
| 主题与配置 | 现代黑/薄荷主题切换成功，保存后控件恢复可用；恢复原薄荷主题 |
| 翻译配置 | DeepSeek Key 和风格表单可打开，未填写密钥、未请求收费翻译 |
| 收藏播放 | 当前 B 站歌曲收藏成功，从收藏可再次播放 |
| 切到手机桌面 | 播放位置从 92499 ms 前进至 146627 ms，约 54 秒后台连续播放，状态保持 PLAYING |

截图保存于工作树 `output/playwright/`：`android-home-final.png`、`android-search-final.png`、`android-library-final.png`、`android-player-final.png`、`android-lyrics-final.png`、`android-preferences-final.png`、`android-translation-final.png`。

## 验证边界

- 当前交付是手机 UI 预览，不是正式发布版。仅 B 站音乐纳入本轮验证。
- 短时间后台播放已验证；锁屏长时间续播、电池优化、多设备和其他 Android 版本尚未完整验收。
- 歌词依赖曲目标题、歌手、时长及外部歌词库。没有可靠匹配时显示明确空状态，可手动搜索；不保证每个视频都有歌词。
- DeepSeek 配置入口可用，但未进行真实付费翻译或用户扫码登录。
- 备份导入导出、长时间下载和完整歌单编辑流程未做真实用户数据验收。
- 导入分支的三个旧静态测试（android_mobile_bilibili_ui、android_provider_capability_matrix、android_whole_product_mobile_surface）原本就与该分支的新注册表/页面结构不一致，不能作为本次已通过项目；上述通过结果仅指明确运行的套件。
