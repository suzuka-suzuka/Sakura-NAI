# Sakura NAI 品牌素材

以五瓣樱花为主体，花瓣的缺口与浅金色花蕊构成统一标志。正文与交互使用樱花粉、暖紫和柔白配色，深浅主题共用同一朵樱花。

| 文件 | 用途 |
| --- | --- |
| `sakura-mark.svg` | 128 × 128 透明背景樱花标志 |
| `sakura-wordmark-dark.svg` | 深色背景用横向字标 |
| `sakura-wordmark-light.svg` | 浅色背景用横向字标 |
| `sakura-icon.svg` / `sakura-icon.png` | 512 × 512 页签与应用图标 |
| `sakura-banner.svg` / `sakura-banner.png` | 1280 × 640 README 与分享横幅 |

SVG 是可编辑的源文件，PNG 由同名 SVG 渲染。图标和横幅在 `app/layout.tsx` 中引用，界面字标统一由 `components/brand-logo.tsx` 渲染。

配色：

- 花瓣渐变：`#f9c3d6` → `#db7098`
- 深色主题：暖紫底 `#15121b`，樱粉强调色 `#f3a5bd`
- 浅色主题：柔白底 `#fff8fb`，深樱粉强调色 `#a93867`
- 花蕊：`#fff0d9`

品牌素材随项目采用 MIT 许可。原项目及第三方代码的许可说明保留在根目录 `LICENSE` 和 `THIRD_PARTY_NOTICES.md` 中。
