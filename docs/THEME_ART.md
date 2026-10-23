# Listen2 主题素材记录

六张原画由本次会话使用内置 imagegen 工具生成，没有引用既有动漫 IP、下载第三方角色或调用付费 CLI API。WebP 转码保留角色透明通道。应用资源位于 `app/listen1_chrome_extension/images/themes/`，六张主要图片共约 1.3MB；五张 preview 图片由真实应用界面截图缩小得到。

## 生成提示词

角色共同约束：`Use case: stylized-concept. Original anime illustration asset for desktop music player, portrait 2:3 composition. Refined Japanese illustration, fine clean lines and soft painterly shading, waist-up three-quarter portrait, relaxed pose listening to music, fully clothed, cute and tasteful. Entire hair and shoulders within frame, transparent padding. No text, no watermark, no UI, no existing fictional character.` 樱花角色另指定双手放松地拿小音乐播放器。

| 文件 | 角色提示 |
| --- | --- |
| sakura-character.webp | pink-haired young adult woman, soft pink over-ear headphones, cream knitted cardigan, friendly smile, gentle rose and cream palette |
| mint-character.webp | brown-haired young adult woman, mint green casual jacket, headphones around her neck, calm cheerful expression, muted mint and ivory palette |
| night-character.webp | silver-haired young adult woman, lavender over-ear headphones, oversized navy hoodie, serene expression, midnight blue and lavender palette |

背景共同约束：`Use case: illustration-story. Landscape 3:2 static background for a music app. Fine Japanese anime background painting, delicate atmospheric illustration, calm luminous detail on right third, left two-thirds quiet low-detail tonal area. No characters, no writing, no UI, no watermark. Tasteful, peaceful, cohesive restrained colors.`

| 文件 | 场景提示 |
| --- | --- |
| sakura-scene.webp | warm ivory sunlit bedroom window opening onto flowering cherry trees, a wooden desk in the right foreground with a cup and headphones, soft rose and cream |
| mint-scene.webp | peaceful summer school courtyard after classes, leafy trees and a bench on the right, distant train crossing, pale mint green and ivory daylight |
| night-scene.webp | cozy midnight radio listening room with a large window overlooking quiet blue city lights, small radio on the right, muted navy and lavender |

角色 PNG 原始尺寸为 1024×1536，场景为 1536×1024；均以 quality 86 / method 6 转为 WebP，没有对图片进行生成式二次编辑。项目内素材随项目交付，未对生成图像作排他性版权声明。

## 2026-10-23 · Listen2 Selects 扩展

新增八套主题：黑胶沙龙、银翼工作室、假日离线、酸性声场、午夜终端、沙丘来信、深海蓝调、暮色紫霞，与原有五套共计十三套。现有主题选择和角色开关继续保留；选择主题不会重建播放器。

视觉方向：把模拟唱片、工业录音设备、复古桌面、荧光海报、终端文字与摄影风景做成不同的听歌空间。首页负责呈现主题，播放页突出封面和歌词，主题馆负责预览与切换。预览悬停、设备的轻微转动和黑胶播放状态动画共享现有的动态预算；系统减少动态偏好优先。

设计参考：[Teenage Engineering TP–7](https://teenage.engineering/products/tp-7)、[Poolsuite](https://poolsuite.net/)、[Spicetify themes](https://github.com/spicetify/spicetify-themes)。参考材质、排版与复古界面的方向；没有复制其代码、标志或产品照片。五种设备 / 图形造型由本项目的 HTML/CSS 绘制。

三张新场景通过内置 `image_gen` 工具生成，原图为 1536 × 1024；只作 WebP 转码（quality 86 / method 6），合计约 414 KiB。素材保存在项目内，无运行时图片服务依赖：

- [沙丘场景](../app/listen1_chrome_extension/images/themes/dune-scene.webp)
- [海浪场景](../app/listen1_chrome_extension/images/themes/ocean-scene.webp)
- [暮色场景](../app/listen1_chrome_extension/images/themes/aurora-scene.webp)

以下为使用的完整提示词（built-in 模式，未使用 CLI/API fallback）。

### dune

```text
Use case: photorealistic-natural. Asset type: full-width backdrop for an art-directed desktop music player theme named Dune, image only. Primary request: an extraordinarily beautiful cinematic fine-art photograph of sweeping terracotta and apricot sand dunes at sunset, one huge pale sun just above the right horizon. Sensuous minimal sculptural sand ridges, deep rust shadows, luminous dusty peach sky. Composition: landscape 1536x1024, sculptural dune peaks on the right half, the left third is quiet dark rust with generous negative space for interface text overlaid later. Analog medium-format film photography, subtle fine grain, calm warm light, tactile sand. No people, no plants, no buildings, no text, no letters, no logos, no watermarks, no UI. Full bleed single scene.
```

### ocean

```text
Use case: photorealistic-natural. Asset type: full-width backdrop for an art-directed desktop music player theme named Deep Blue, image only. Primary request: an exceptionally beautiful moody aerial fine-art photograph of a sweeping ocean wave, midnight cobalt ocean and luminous white sea foam. A single sculptural wave curls diagonally on the right two-thirds, with translucent cyan water at its crest. The left third is still very dark navy water with low detail and clean negative space for text overlaid later. Landscape 1536x1024 composition, rich inky blue, tactile film texture, dramatic but quiet, premium album cover aesthetic. No people, no boats, no coast buildings, no text, no logo, no watermark, no UI. Full bleed single scene.
```

### aurora

```text
Use case: photorealistic-natural. Asset type: full-width backdrop for an art-directed desktop music player theme named Violet Hour, image only. Primary request: a breathtaking cinematic fine-art landscape of a solitary lavender-colored mountain ridge above a sea of mist at the blue hour, dusky lilac and deep plum shadows, pale pink moon glowing above the far right ridge. Layered purple mountain silhouettes recede into airy pink fog, subtle rose light near the horizon, quiet dreamlike atmosphere with real photographic detail and fine analog grain. Landscape 1536x1024, ridge and moon occupy the right half, left third low-detail dark aubergine negative space for interface text overlaid later. Restrained light, never neon, polished editorial photography. No people, no buildings, no text, no logos, no watermark, no UI. Full bleed single scene.
```

八张新增 `*-preview.webp` 来自实际应用截图，包含用于视觉验证的本地封面、测试歌单与自写歌词，不代表网络音源内容。没有将测试歌单、测试音频或歌词写入应用的生产初始数据。预览与测试用场景均使用本项目已有素材和本次生成素材。
