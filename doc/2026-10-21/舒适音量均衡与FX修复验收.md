# 舒适音量均衡与 FX 修复验收

日期：2026-10-21，Asia/Shanghai。目标版本：2.35.6 候选。

状态：实现完成；定向本地门禁 **PASS**，合成原生音频、真实播放链边界与最终安装包模块加载验证通过。尚未替换用户安装的 App，未合并、打标签或发布 Release。

## 用户批准的结果

- 复用设置中原“统一曲目音量”位置，改为一个“舒适音量均衡”开关；保留原有偏好，不增加模式菜单。
- FX 继续选择音色，修复从原声切换其他音色时明显掉量的问题。FX 电平补偿独立于舒适均衡开关。
- 已分析曲目使用档案稳定初始化；尚未分析的在线播放使用有界的实时测量和平滑调整。
- 保留正常音量与静音控制、应用直连能力及原始音频文件。Android 不在范围内。

历史原因与标准研究见[诊断报告](./桌面曲目响度平衡诊断与改进建议.md)。该报告及其复现明确固定历史 v2.35.5 基线，不能作为本轮已修复行为的断言。

## 改动

### 音频链

```text
源音频 ── FX 音色与延迟对齐 ── 舒适增益 / FX 电平补偿 ── 前瞻峰值保护 ── 输出
   └──── 延迟对齐的参考输入 ────────────────┘
```

正常 AudioWorklet 路径移除旧 FX 固定预衰减和 WaveShaper，保留均衡、空间及夜间压缩等音色处理。比较 FX 处理前后的 K 加权能量，平滑补偿固定掉量；各预设以 25ms 线性交叉淡化切换。夜间压缩器的 6ms 延迟与其他音色对齐，避免切换时相消。

舒适目标为 −16 LUFS，增益有 −18 至 +9dB 边界。有效整曲档案用于初始化；未知音频通过门控测量估计，先允许降低过响的输入，积累有效音乐后缓慢提升。安静段不会持续追涨。最终处理使用 4 倍 FIR 峰值检测与 12ms 前瞻；含 FX 对齐总延迟约 18ms。独立计量验证了代表样本，没有声称完整 EBU 合规或任意素材的绝对峰值保证。

用户主动调小音量和静音不会被均衡抵消。原声加舒适关闭时，增益平滑恢复后排空处理缓冲，恢复未限峰波形；非原声仍保留音色电平补偿与峰值保护。处理模块失败时明确显示回退状态，使用旧安全路径；回退不等同于舒适处理已生效。

### 档案和播放器

- 在安全播放边界重新查档，后台分析完成后可在重播生效；不在当前歌曲中途突然替换新档案。
- 响度档案绑定缓存 key、URL、音频内容 SHA256 与分析版本。相同 URL 下内容变化也会重建播放器；同内容的后到档案可刷新复用对象。
- 异步响应、暂停及取消有代际校验，避免旧响应影响其他歌曲；重建时恢复有效播放进度。
- 暂态分析失败最多三次尝试，持久化次数并使用 30/60 秒冷却；依靠查询或启动触发，不常驻轮询。格式不支持或资源超限不对同内容反复重试。

### 设置

classic / modern 两套布局共享一个原生 checkbox 开关语义，六种语言同步。提交时显示进行中，失败恢复原值；引擎未就绪、旁路和回退分别反映真实状态。getter 不做布局或调度操作，旧状态查询不能覆盖较新的开关确认。

## 独立音频验证

环境：macOS arm64，Electron 32.3.2 / Chromium 128.0.6613.186。实际 `OfflineAudioContext`、双输入 `AudioWorkletNode` 与生产 FX 构造器；仅本地合成 PCM，没有连接扬声器、访问真实歌曲或用户会话。

参考计量器：官方 [libebur128](https://github.com/jiixyj/libebur128) v1.2.6，源码提交 `67b33abe1558160ed76ada1322329b0e9e058b02`，用本机 clang 独立编译。两个代表样本先验证旧分析器与参考计量器 LUFS 差 0.0042 / 0.0013，再逐步扩大到最终样本集。

09:33:44–09:35:45 +08 的最终音频集共 52 次原生渲染（包含重复复验），执行均 exit 0。结果适用于下方列出的音频链快照；后续仅资源管理改动的适用性另列。

| 项目                    | 结果与含义                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| 已分析的轻声 / 大声样本 | 两者稳定输出均约 −16.0094 LUFS                                                                            |
| 8 个 FX × 舒适开 / 关   | 16 组，稳定响度相对同素材原声最大差 0.0293 LU                                                             |
| 轻声原声 / 夜间         | 舒适开和关两组，稳定差均 0.0027 LU；未触及补偿下限                                                        |
| 未知首播 48 / 44.1kHz   | 稳定约 −15.99 LUFS；首个此后持续满足 −16±0.5 LU 的独立 3 秒窗口分别为第 6–9 / 7–10 秒，非瞬间一致         |
| 静音后音乐              | 不追涨静音；自音乐出现后逐步适应                                                                          |
| 用户音量 25%            | 输出约 −28.051 LUFS，保留用户约 −12.04dB 调整                                                             |
| 静音                    | 稳定静音区样本峰值 0，增益冻结                                                                            |
| 开关过渡                | 约 80ms 渐变，含延迟/缓冲约 110ms 完成，非断接跳变                                                        |
| 原声关闭透明            | 48kHz 与延迟 18ms 的输入比较，最大样本差 ≤4.83e−6；不声称 bit-perfect                                     |
| 高动态例外              | 输入 −27.434 LUFS / +2.656dBTP，输出 −20.889 LUFS / −1.469dBTP；受增益与限峰预算限制，未强压到 −16        |
| 夜间切换残差            | 100ms RMS 窗口最高 +2.791dB，>2dB 持续 145ms；400ms 最高 +1.506dB。接受有限短时动态，不能承诺所有瞬间等响 |

另以真实 `HTMLMediaElement`、`MediaElementSource` 与不接扬声器的 sink 标定：音量 0.25 时 RMS 比 0.2499，静音时为 0，恢复比 0.9998。这确认源节点已包含用户音量，输出不能再逆向补偿它。

### 音频集源码绑定

| 文件                          | SHA256                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| `audio_visualizer.js`         | `b234a4b6acf95e21bdf9af54d1468f933af0ac20e86e2c7a94b1b088938006ab` |
| `comfort_loudness_core.js`    | `62826839dd1c96dad7862adfc7dfdbbbf47a3632fb128096e91a0f72f0a1d073` |
| `comfort_loudness_worklet.js` | `c9d0b94d914b215549872b73cd8e5145b0b3597fc2c91334b730c1d93577215a` |

资源管理修复已完成：切走时断开旧图并 dispose processor，作废迟到的异步回调；保留每个 HTMLMediaElement 唯一 MediaElementSource，返回时重建其处理器，避免重复认领源节点造成无声。暂停及排空后的全零块走廉价路径。same-Howl seek 清测量窗和缓冲并保留已适应增益，新媒体重新初始化。非 HTML5/浏览器仅观察路径明确返回 unsupported。

最终源码绑定：

| 文件                          | SHA256                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| `audio_visualizer.js`         | `01c5a07f20bb2b5f01bbad4bafbfdcf4a198c3b013295ad85f0cb36837b5b7fa` |
| `comfort_loudness_core.js`    | `a1b8f8a86274be1e8e136227f0da07acdec4be8effcf20e7263357e2ad7c3370` |
| `comfort_loudness_worklet.js` | `8ce57dfc5c5a6fc6c0f3e4d1d4634f6257cef80fc851d4da26f6417e10edfb60` |

known stereo、unknown continuous、FX continuous 三条各比较 1,536,000 个输出样本，与前一计量核心逐样本最大差均为 0。原 52 次持续音频计量对未变数学计算仍适用；这不替代资源边界验证。park / resume、异步旧回调、暂停闲置、dispose、同曲 seek 保留约 −9.98dB 与新曲归初始的聚焦回归通过。真实 Howler HTML5 与生产 hub 定向验证于 09:52:43.859–09:52:50.127 +08 通过 exit 0：A→B→A 只创建两个 MediaElementSource、三个 processor，前两个已 dispose；未知 A 同曲 seek 前后增益均 −5.267506dB；真实 mute 输出峰值 0。known B 的约 1.9 秒局部包络计量为 −15.6488 LUFS / −7.441dBTP，不与整曲或稳态窗口混用。该测试的 destination 代理到零输出收集器与 MediaStreamAudioDestination，未连接实际扬声器。

初次 hub harness 曾因 Howler autoUnlock 重建共享测试 context、及缺失生产播放器当前 Howl 回调 guard 失败。仅修正 harness，并将失败单列排除；通过结果不以这些错误试验替代。park 后返回未知歌曲的新 processor 会重新估计，前几百毫秒不能承诺已校准。

## 定向本地门禁

仓库：`dazzlingwuming/listen2`；分支：`fix/desktop-comfort-loudness-20261021`。起始 HEAD 为 `5318054cf29443575594cf8d3ca7fd3304d6a4e1`。检查时为本轮未提交工作树；没有混入原 checkout 的 Android 工作。Node 定向测试运行环境为 v24.15.0；原生音频运行于 Electron 自带环境。

- `npm run test:comfort-loudness`：直接选择 analyzer/cache/DSP/输出恢复/player/renderer/settings/FX UI 相关文件。09:39:22–09:39:24 +08，39/39 pass、0 skip、exit 0。最终资源/seek 补丁后于 09:51:25–09:51:27 +08 对同一入口复跑，仍 39/39 pass、0 skip、exit 0。初轮因新 worktree 无 `music-metadata` 加载失败，随后用既有且依赖图未变的安装目录通过 `NODE_PATH` 运行，没有新增安装。
- cache 生命周期负责人另跑 21 项缓存/响度检查及五个直接相关播放器脚本，均通过。
- 本轮 JS 语法、六语言 JSON、三份 lock 依赖图一致性、版本展示及 `git diff --check` 已通过；最终资源修复后已补齐 7 个 JS 文件语法、locale、8 处版本/3 份 lock 依赖图与 diff 检查，均 exit 0。
- 历史复现：`node --check doc/2026-10-21/loudness-diagnosis-reproduce.cjs` 与实际运行均 exit 0，明确输出固定基线 SHA。
- Docker 不适用于本轮 Node / Electron 定向检查；未执行全仓、Android 或在线平台测试。ESLint 在现有依赖中不可用，未安装；部分 HTML/CSS/locale 的已有全文件格式漂移未扩大重排。收尾发现 audioCache / player 与两个 test 的本轮新增格式问题，已仅用既有 Prettier 修正；四文件 check / debug-check 均通过，AST 等价。格式后 39/39 定向回归再次通过，0 skip / exit 0（09:59:10–10:00:31 +08 的执行窗口，收据记录于 10:00:31，单次测试耗时 6.388s）。最终选中源码、测试及文档的 Prettier check 全部通过；HTML/CSS/部分 locale 的既有漂移按前述覆盖限制单列。

## 打包与界面

最终候选：[listen1_2.35.6_mac_arm64.dmg](../../dist/comfort-v2.35.6/listen1_2.35.6_mac_arm64.dmg)，100,767,353 bytes，SHA256：

```text
08ef4aa156088fad35f5d6fd87043b66a661baec320e86a434aad5166b7697ef
```

Electron-builder 25.1.8 / Electron 32.3.2；隔离 stage 使用 152 个生产文件及已存在依赖的独立副本，锁文件依赖图未变，不安装或升级依赖。构建 `--mac dmg --arm64 --publish never --config.npmRebuild=false --config.electronVersion=32.3.2` exit 0；指定既有 `electronDist` 与独立缓存/正式输出目录。`hdiutil verify` VALID / exit 0；只读挂载确认版本 2.35.6、arm64，已 detach。

ASAR 16 个关键文件与源码逐项一致，包含上述三个最终 DSP hash，且没有测试条目。DMG 内 ASAR 与解包目录 ASAR 字节一致，ASAR SHA256：

```text
4080b5b59b82a29ccd24609a3321772680b618eb552489672456064f5c6fa924
```

初轮构建缺显式 Electron 版本而失败且无产物；中间一次打包带入测试文件，发现后隔离保留并按生产文件口径重打。两者均不作为候选。格式整理前 ASAR（`5b31bd7370ee6f7619f148660b1bc6e808f380abce98052df6ccbbd007271707`）真实模块加载及 Howler HTML5 / hub case 于 09:54:41.192–09:54:47.323 +08 通过 exit 0：实际从包内加载 worklet；A→B→A 为两个 source / 三个 processor / 两次 dispose，seek 增益 −5.257802dB 保持，mute 输出峰值 0。known 局部输出独立测得 −15.648399 LUFS / −7.440992dBTP。三个包内 DSP hash 与冻结源码完全一致。最后仅格式化 audioCache / player 及两个 test，`Prettier --debug-check` 确认 AST 等价；10:00:42–10:00:58 +08 重打候选后，hub / core / worklet / Howler 与原生验收包逐字节相同，16 文件匹配最终源码。因此原生验证对未变音频输入仍适用，没有将旧 archive 整包 hash 冒称最后 archive。09:55:55 的自有原生 Electron PID 检查为空；UI 预览同样已退出。

CUA 最初因相同 Electron bundle ID 返回绑定/超时错误。仅在登记临时目录复制并 ad-hoc 签名独立 Electron 测试副本，以唯一 bundle ID 后绑定恢复。Classic / Modern 实际 HTML 片段、Angular、CSS 与六语言预览：鼠标切换、保存中禁用/加载、失败恢复关态与内联错误、AX 焦点均通过。空格键在 CUA 中未能可靠触发，键盘实际操作为 **NOT VERIFIED**。该预览的控制器为隔离内存状态，不等同于真实缓存 IPC 或完整生产界面；少量无关统计插值占位符不影响开关检查。

## 限制、恢复与交付状态

- 没有试听真实用户歌曲、采集声卡输出或验证 Windows / macOS x64 等平台；合成计量不能证明所有音乐的主观效果。桌面 Player 使用 `html5:true`；Howler WebAudio 仅有分析观察路径，未宣称舒适处理覆盖所有 Howler 后端。
- 首播需要适应时间，高动态素材可能仍较轻；夜间压缩切换有短时残差。44.1kHz 的分数 DelayNode 插值下原声关闭透明未独立计量。
- 原声加舒适关闭刻意不限制峰值，不纳入开启处理的峰值验收。
- 回退路径使用旧安全增益和 FX 余量，效果可能较弱；设置显示回退，不伪装为正常生效。
- 用户当前 App、用户配置、电脑音量及代理均未更改。候选可先在隔离环境检查；安装替换、合并和 Release 需各自已有明确授权。
- 正式报告与候选独立保存在本工作树，所有自有预览/原生验收进程已退出；登记入口负责清理临时 PCM、profile、stage 和中间 DMG。清理回执由项目权威任务记录保存；不清理其他任务的产物。
