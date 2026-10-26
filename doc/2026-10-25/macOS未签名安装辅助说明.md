# macOS 未签名安装辅助

2026-10-25。本次获准范围是实现、构建和验证仅针对 Listen1 的安装辅助；本轮未替换真实 `/Applications/Listen1.app`，未改用户配置或系统安全设置。

## 安装入口

每个 Mac DMG 根目录包含 `Listen1.app`、`Install Listen1.command`、`Listen1.integrity.tsv` 和 `INSTALL-LISTEN1.txt`。用户先将 DMG 的 SHA-256 与 Release 公布值核对，再打开 DMG。在终端输入 `bash `，拖入 DMG 中的 `Install Listen1.command`，回车执行。这样不依赖 Finder 直接打开带下载隔离标记的脚本。只有输入 `INSTALL` 才执行安装。`--verify-only` 只读验证源应用，不创建安装目录、不清隔离标记。

本地清单与脚本内固定摘要可检测文件丢失、内容/权限/链接变化，不提供发布者身份认证；若 DMG、清单与脚本一起遭替换，本地摘要无法建立独立信任。不要把这项检查称为代码签名或公证。

## 明确边界

- `build/macInstallHelper.cjs` 在 `afterPack` 后生成外置清单，涵盖包内每个普通文件 SHA-256、目录/文件/链接类型、POSIX 权限与内部相对链接目标；拒绝特殊权限位、控制字符、逃逸链接及错误应用标识/版本/执行文件/架构。清单本身在应用包外，不存在自引用例外。
- 目标机器只需要 macOS 自带 Bash 与系统工具。运行时再次核对包标识 `com.listen1.listen1`、版本、执行文件 `Listen1` 和 `lipo` 架构；同时核对完整条目数量，拒绝添加文件。
- 优先使用可写 `/Applications/Listen1.app`；已有用户目录副本则沿用；只有不存在系统目录副本且系统目录不可写时，才考虑 `~/Applications/Listen1.app`。两个目录同时存在副本、目标为链接、目标属于其他应用或现有系统副本受保护时拒绝。不会创建第二份副本规避权限。
- 正在运行 Listen1 时拒绝，用户自行退出；不杀进程、不请求密码、不使用 sudo。不签名、不公证、不访问钥匙串、不调整 Gatekeeper 或全局 OS 设置。
- 复制到同一目标文件系统的私有临时目录，再验证；唯一属性操作是对已经验证的暂存 `Listen1.app` 执行 `xattr -dr com.apple.quarantine`，保留其他属性，并再次验证文件。源 DMG 和现有安装副本在此之前均不改动。
- 旧应用移入目标目录旁的 `.Listen1-backup.XXXXXXXX/Listen1.app`，新应用用同一文件系统重命名就位。失败时尝试恢复旧应用；恢复失败保留现场并打印备份路径。成功后保留旧应用且打印路径，便于手动恢复。用户的 `Library/Application Support`、歌单、设置和钥匙串均不访问。
- 普通信号触发回滚；断电或 `SIGKILL` 无法保证运行清理，保留目录可用于恢复。系统仍可能对未签名应用提示，未承诺所有 macOS 版本均可直接启动。

## 打包与验证

DMG target 在每次 build 调用中使用独立 options 副本，绑定该架构 `appPath` 旁的三个辅助文件；不修改共享 target 配置，避免并行架构交叉使用清单。此适配基于当前 electron-builder 25.1.8 的 DMG target 接口；升级 builder 后需重跑打包测试和真实 DMG 挂载验证。

定向验证入口：

```sh
node --test app/test/macInstallHelper.test.js
bash -n build/mac-install/install.sh
node --check build/macInstallHelper.cjs
```

2026-10-25 已在 macOS 原生系统工具下通过 18 项测试，覆盖全树完整性、内容/权限/新增条目/链接/版本/清单篡改、链接逃逸、运行中拒绝、重复安装与目标链接拒绝、用户取消、隔离属性限定、其他属性与配置保留、替换及最终验证失败回滚，以及架构 DMG 文件隔离。所有安装测试将生成脚本的路径静态改写到已登记的 `.task-workspaces/macos-daily-theme-20261025/scratch/mac-installer/fixture-*` 内；正式脚本没有测试环境变量或任意目标覆盖入口。测试完成自动删除各 fixture，未触碰真实安装应用。

2026-10-25 根任务已完成最终 x64、arm64、universal DMG 的只读挂载、`--verify-only`、三份辅助文件及摘要核对；各包关键源码与当前版本一致。结果见 [验收记录](每日主题与Mac安装辅助验收.md)。真实下载场景的 Gatekeeper 交互和用户安装仍未在本轮执行。
