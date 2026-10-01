# 自有 NovelAI 请求层与 V5

本分支移除了原 NovelAI SDK。浏览器直接调用配置的官方 API 或兼容代理，服务端继续只负责部署网页。Token、连接设置、图库的存储方式不变。

## 代码入口

- `lib/nai/protocol.ts`：模型、采样器、事件和图片类型。
- `lib/nai/payload.ts`、`v5.ts`：各代模型的完整生成请求、提示词和参数校验。
- `lib/nai/transport.ts`：鉴权、超时、HTTP 错误、MessagePack/SSE 解码、ZIP/JSON 图片响应。
- `lib/nai/client.ts`：生成、Vibe 编码缓存、角色参考、标签建议、Director、放大和 Enhance。
- `lib/nai/media.ts`：图片转换、参考图适配、PNG 文本与 alpha 隐写参数读取。

只使用通用数据格式库 `@msgpack/msgpack`、`jszip`、`fflate`，没有第三方 NovelAI SDK。

## V5 支持

- Full / Curated，`params_version: 4`，V4 caption 结构，实时预览和多图批次。
- 最多 22 个启用角色（按官网最新模型文档），独立正负提示词、0–1 连续位置、位置开关。
- 透明背景 PNG 和 Auto Text。引号文字来自主提示词与启用角色；手动 `Text:` 优先，自动区块放在末尾。
- CFG、CFG rescale、步数、种子与分辨率校验。V5 固定 Karras；DDIM 改为 Euler Ancestral。
- 当前不发送 Vibe/角色参考图、SMEA、Variety 参数。界面说明能力限制，并保留原有参考图供旧模型使用。
- Enhance 使用当前侧栏模型、正负提示词、角色、参考图和采样参数，选中图片仅提供底图与源尺寸。面板不阻挡侧栏；默认独立调整强度与噪声，展开高级设置后显示 1–5 档幅度，切换显示保留已有值。增强固定生成一张、随机种子，输出尺寸由源图和放大档决定。

V4/V4.5 保留角色提示词和流式响应；V3 使用普通生成接口。V4+ Vibe 先调用 `/ai/encode-vibe`，按连接、图片、模型与提取强度缓存（内存中最多 32 项）。角色参考使用 V4.5，优先于同时设置的 Vibe。

## 网络行为

生成使用 Bearer Token 和 JSON 请求。只有 HTTP 429 会按设置延迟重试；网络错误、5xx、开始后的断流不自动重新提交。停止生成会中止浏览器请求，服务端是否已计费由 NovelAI 决定。已收到的最终图片会尽力保留到本地图库。

## 提示词预设与生成界面

按 2026-09-28 查阅的官方 V5 文档统一预设。质量词可选标准、轻量或关闭；负面词可选强、弱、兽人优先、人物优先或关闭。选项分别位于正负提示词输入框右下角，宽度随当前选项文字变化。悬浮或键盘聚焦会显示完整预设内容，浮层按内容收缩，长内容受最大宽度限制并换行，与选项框水平居中，并独立于侧栏滚动容器，避免被裁切。`lib/nai/presets.ts` 同时供界面和请求构造使用，切换预设不会改写手动输入的文本。V5 透明背景复选框位于正向输入框左下角；角色提示词编辑放在负向提示词下方。主提示词和角色提示词在空白时均不显示示例占位文字。

每个角色使用一个编辑框，左上角选择正向或负向提示词，两份内容独立保存并一同发送。「AI 自动安排位置」开启时关闭 `use_coords` 并收起手动位置网格；关闭时恢复网格和之前保存的坐标。切换位置模式不修改角色提示词或坐标，与官方 [AI's Choice / Custom](https://docs.novelai.net/en/image/multiplecharacters/) 的含义一致。

流式画布使用提交时的分辨率和张数，在可用空间内保持比例完整显示。高级设置中的「流式预览」关闭后使用普通生成接口，生成期间保留上一张图片；没有历史图片时保持空白画布，完成后再切换到新图。生成按钮位置使用持续扫过的细线表示等待，不显示「等待最终图片／仅返回最终图片」。偏好保存在当前浏览器中。

右侧图库按批次单列排列。点击图片或批次仅浏览；只有明确点击「复用参数」或「使用这些参数」才会导入设置。

## 点数估算与提醒

生成按钮直接显示整批 Anlas 点数。连接后、提交前和生成后从 `/user/subscription` 读取订阅状态。V5 的免费判断包括有效 Opus 订阅、`usage.isNegative` 为 false、分辨率不超过 1,048,576 像素以及步数不超过 28；符合条件的批次只减免第一张图片的基础费用。显示为 0% 并不等于额度已透支。订阅有效期优先依据 `expiresAt`，取消续订但尚未到期的账户仍保留权益；旧响应没有到期时间时才使用 `active`。无法获取账户状态时按无免费额度估算，避免误显示 0 点。

从 0 点切换到付费参数后，首次点击生成会弹窗；取消不会提交生成请求。确认绑定弹窗展示的参数，若提交前刷新账户后预计费用升高，会重新确认。连续付费生成不重复提醒，回到 0 点后重新启用提醒；可以在高级设置中关闭。

点数公式现参考 Aaalice_NAI_Launcher，修正了上一版漏掉的 V5 1.5 倍率：先对面积与步数的基础公式向上取整，再乘模型倍率，最后向上取整并应用每张最低 2 点。V5 `832×1216 / 23 步` 付费价为 26 点，`28 步` 为 30 点；免费条件成立时首张仍为 0 点。Vibe 超过四张的附加费按请求计收，编码费只收一次。超过单张 140 点的组合会提示降低尺寸或步数。

按钮不再显示「约」字，悬浮说明仍注明按当前规则计算、最终以 NovelAI 实际扣费为准。这是与参考项目一致的前端计费实现，并非服务端预报价。相关来源及 MIT 许可记录在 `THIRD_PARTY_NOTICES.md`。测试使用本地模拟订阅和图片响应，不消耗真实额度。

Enhance Max 在 V5 且源面积小于 `0.8 × 3,145,728` 时可用，提交源画布尺寸和 `upscaled_enhance:true`。报价按等比例放大至约 3 MP 的目标尺寸计算，不按源图面积享受 Opus 免费抵扣。普通倍率先对齐 64 像素网格，再使用目标面积、当前步数、模型倍率及增强强度计算费用。增强面板、左栏按钮、快捷键、首次付费确认与提交共享同一参数构造。以 `832×1216 / 28 步 / 强度 0.2 / V5` 为例：无免费抵扣时 1× 为 6 点、1.5× 为 14 点、Max 为 18 点；符合 Opus 免费条件时仅 1× 可降为 0 点。

普通增强按官网规则为 V4.5/V5 正向提示词追加 `-2::upscaled, blurry::`，插入位置在手工 `text:` 段之前；Max 不追加。当前侧栏草稿与原图配方均不被改写。切换到不支持 Max 的模型会在报价和提交时回落到可用倍率。

- [官方 V5 质量词预设](https://docs.novelai.net/en/image/qualitytags/)
- [官方 V5 负面词预设](https://docs.novelai.net/en/image/undesiredcontent/)
- [官方订阅说明](https://docs.novelai.net/en/subscription/)
- [Aaalice_NAI_Launcher 点数实现](https://github.com/Aaalice233/Aaalice_NAI_Launcher/blob/main/lib/core/services/anlas_calculator.dart)
- [Aaalice_NAI_Launcher V5 模型计费倍率](https://github.com/Aaalice233/Aaalice_NAI_Launcher/blob/main/lib/core/constants/model_capabilities.dart)

## 验证

`npm test` 通过本地模拟响应检查请求参数、二进制/SSE 分块、错误和取消、ZIP/JSON、Vibe 缓存、PNG 文本及隐写导入。`npm run typecheck`、`npm run lint`、`npm run build` 检查项目。未使用用户 Token 执行真实付费生成，因此实际服务端出图质量、账号权限及额度仍需真实使用验证。

## 协议参考

根据公开接口和参考项目的协议行为独立实现，不复制旧 SDK 实现。

- [NovelAI 官方接口定义](https://image.novelai.net/docs/doc.json)
- [NAIWeaver V5 调研](https://github.com/ststoryweaver/NAIWeaver/blob/master/docs/NOVELAI_V5_RESEARCH_AND_PLAN.md)
- [NAIWeaver 请求构造](https://github.com/ststoryweaver/NAIWeaver/blob/master/lib/core/services/nai_request_builder.dart)

接口能力可能随 NovelAI 更新，后续调整集中在以上请求层文件中。
