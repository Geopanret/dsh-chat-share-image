# Reply Snapshot — 回复长截图到剪贴板

在 DSH 每条**已完成**的助手回复的按钮区（复制 / 好回答 / 有问题的回答 / … 那一排）新增一个相机按钮。点一下：

- 把这一条回复的**完整内容**（不是当前视口）渲染成 PNG 长图，直接写入系统剪贴板；
- **截图里表格会重新排版**：取消横向滚动和单元格宽度上限，所有列、所有文字都在图里；
- **引用的图片会放大成完整原图**：界面上的 240/360px 小预览，在截图里按原图比例完整显示；
- 代码块、公式、长文完整入图；长 URL / 不可断词会自动换行，不会把画布撑出边界；
- 写完 PNG 会**回读校验尺寸**（自检失败会报错，不会悄悄给出坏图）；
- **超长防呆**：单张图不缩到看不清；超过单张可读高度时自动按段拆成多张，第 1 张进剪贴板，toast 里可以复制下一张或下载全部；超过 6 张上限时明确拒绝并提示分段。

Host 半边是空壳，所有逻辑都在浏览器里；不联网、不上传、零 Host 权限，无需重启 DSH。

## 安装 / 卸载

### 从 GitHub（发布版，推荐）

```bash
dsh plugin --profile desktop add github:Geopanret/dsh-chat-share-image#v0.2.0
```

首次安装走 HMR 生效；之后 `client.js` 改动由 `@deepseek-ai/dsh-client-hmr` 热替换。

### 本机开发（link 到工作区）

```bash
# 在 DSH 会话里执行（示例路径按你的工作区替换）
plugin_manager action=install_bundle target=D:\PLAYGROUND-DSHo\dsh-chat-share-image

# 卸载
plugin_manager action=remove_bundle target=dsh-chat-share-image
```

安装由 `plugin_manager` 写入 profile（`~/.dsh/profiles/desktop`），不要手改 profile 的 `package.json` / `cordis.patch.yml`。

## 它解决什么

AI 回复经常带表格、图片和长文，直接转发会刷屏；截当前屏幕又会丢内容。这个插件把「这一条回复」按适合阅读的纸张重新排版，生成一张完整 PNG：

- 表格不横向滚动、不缺列；
- 引用图从界面小预览变成完整大图；
- 深/浅主题跟随当前页面；
- 剪贴板不可用时可下载 PNG。

## 实现方式

全部逻辑在浏览器侧（`client.js`），Host 半（`index.js`）是空壳：

1. **入口**：在 `conversation.chat.assistant-actions` 注册 `share-image`（order 15，在点赞/点踩之后、上下文跳转之前）；在 `shell.overlay` 注册一个 toast。
2. **定位回复**：由 slot 给的 `messageId`，经 `useChat` 快照找到 `assistant-step` 节点的 key，再按 `[data-chat-node-key]` 找到 DOM 行；找不到时按「同一 Turn 的最后一个 assistant-step」回退。
3. **克隆后先清掉界面布局的“冻结值”**：`getComputedStyle` 会把实时宽高固化成 px；纸张排版会改变内容宽度/高度，因此先对非替换元素清掉 `width/height/min/max`，让内容重新流式排版（否则重排后的表格会和下一段文字重叠）。
4. **截图排版层（paper layout）**：在克隆外套一层 `.dsh-csi-paper`，只对截图生效：
   - 遍历原行里所有滚动/裁剪元素，在克隆里一律展开；
   - 表格：纸张内容宽 = `clamp(max(回复列宽, 表格列数×140), 720, 1800)`，表格 `width:100%`、单元格 `max-width:none`、`white-space:normal`、`overflow-wrap:anywhere`——所有列完整显示、按纸张宽度换行；
   - 全局补 `overflow-wrap:anywhere` / 长 URL `word-break:break-all`；代码/公式保留原行宽（上限 2000px），超限时换行。
5. **引用图片放大**：识别附件缩略图（`button[data-variant]`，240/64/48px 且 `object-fit:cover` 会裁切）和 Markdown 图片预览（`button > img`，界面 `max-height:360px`），替换为完整图，按自然尺寸/纸张宽度显示、不裁切。
6. **资源内联**：同源 `api/file?path=`、`blob:`、`data:` 图片 fetch 后转 data URL；跨域且无 CORS 的图替换成占位块并计数。KaTeX 等 webfont 从同源 `@font-face` 读字体文件后以 data URL 内联。
7. **光栅化与自检**：离屏测量宽高 → SVG `<foreignObject>`（每片 ≤ 20000px 分片）→ canvas 按 2× 清晰度绘制。**SVG 必须以 base64 data URL 交给 `<img>`**：Chromium 里用 blob URL 装载含 `<foreignObject>` 的 SVG 会污染 canvas，`toBlob` 直接抛 SecurityError。输出 PNG 后会解码回读，校验文件非空、PNG 尺寸与 canvas 一致。
8. **超长防呆**：单张图若需要缩到 1× 以下或高度超过 12000 CSS px，就按段切分（每段高度按 2× 设备面积/边长上限计算），每段单独出图；第 1 张写剪贴板，toast 提供「复制第 N 张 / 下载全部 N 张」。段数超过 6 张时拒绝并提示分段，避免一次生成几十张把页面拖死。
9. **剪贴板**：`navigator.clipboard.write([new ClipboardItem({'image/png': promise})])`，在点击的用户激活内发起；失败时退化为先渲染再写，再失败则提供下载/重试。

## 已知限制

- **截图排版 ≠ 界面原样**：表格/图片在截图里按「完整可读」重新排版，与界面滚动预览不同；这是刻意的。
- **超长回复**：会拆成多张 PNG（最多 6 张），第 1 张进剪贴板，其余在 toast 里逐张复制或下载；单张仍受 32767px 边长 / 6400 万像素上限约束。
- **超长代码行**：超过 2000px 宽会自动换行（保留内容，不保留原行宽）。
- **跨域图片**：没有 CORS 头的远程图片无法嵌入 canvas，会显示 `[image: alt]` 占位并计数。
- **只存在于 hover 浮层里的文件引用缩略图**：静态 DOM 里没有图，截图不会主动去取（markdown `![]()` 图片与附件预览已覆盖）。
- **未来 DSH 版本**：回复行定位依赖 `data-turn-tail` / `data-chat-flow-kind` / `data-chat-node-key` 这些内部属性；结构变化时按钮会提示错误而不是崩溃，但需要适配。
- **剪贴板权限**：桌面壳对非 `media` 权限走 Electron 默认策略（允许），浏览器里 `127.0.0.1` 也是安全上下文；若被策略拒绝，会保留「下载 PNG」兜底。

## 验证

```bash
node --check client.js
node test/smoke.mjs
```

2026-11-05 在实时页面实测（agent-browser 拦截 `navigator.clipboard.write` 取 PNG 字节）：

| 场景 | 结果 |
|---|---|
| 普通回复（3 列表格 + 长 URL） | 1584×898 / 1584×1122；表格完整、长 URL 在纸张宽度内自动换行，画布不横向溢出 |
| 真实 5 列表格长回复（6158 CSS px） | 1584×12316；5 列全部单元格可见，顶部/底部无截断 |
| 2 张引用图（1200×400 宽图 + 500×1400 长图） | 1584×3576；宽图放大到纸张宽度，长图完整显示，不裁切 |
| 代码块 + 3 列表格 | 1584×2668；代码块与表格完整 |
| 深色主题 | 深底浅字正确 |
| 超长拆分（合成 14598 CSS px 回复） | 拆成 2 张：1584×24000 + 1584×3708；第 1 张进剪贴板，toast 可复制第 2 张 |
| 超过 6 张上限 | 明确提示「回复过长：需要拆成 45 张（上限 6 张）」并停止，不写坏图 |
| 导出自我校验 | PNG 回读尺寸与 canvas 一致；尺寸不符/空 blob 会报错 |
| 剪贴板 | v1 已用真实点击 + Windows 剪贴板回读；v2 通过拦截确认写出 PNG，写后回读尺寸 |
| 主题 / HMR | 深色主题正确；`client.js` 改动由 HMR 热替换，无需重启 |

## 冲突与回滚

- 只新增两个 slot cell（`share-image`、`chat-share-image-toast`），不替换任何既有 entry；CSS 全部 `dsh-csi-` 前缀，不写全局选择器；不改其他插件目录。
- 回滚：`plugin_manager action=remove_bundle target=dsh-chat-share-image`，刷新页面即可；工作区目录可保留。

## License

MIT
