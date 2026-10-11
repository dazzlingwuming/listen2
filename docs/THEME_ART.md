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
