# Read Frog Lite for Via

面向 Via 浏览器的单文件网页翻译用户脚本（当前 **v1.3.8**），基于上游 [Read Frog](https://github.com/mengxi-ream/read-frog) 二次开发，采用 GPL-3.0-only 发布。

> 本项目基于 [Read Frog](https://github.com/mengxi-ream/read-frog) 进行二次开发。
> This project is a modified work based on Read Frog.

由于 Via 浏览器长期缺少为移动端阅读场景专门设计的翻译脚本，本项目参考 Read Frog 的设计与翻译思路，使用 Vibe Coding 完成了适配 Via 的轻量实现。它专注于手机上的网页阅读与手动翻译体验，不是 Read Frog 官方版本。

## 项目结构

单文件油猴脚本，不做模块化拆分、不引入运行时依赖、不建 CI。仓库只按职责分层：

| 路径 | 说明 |
| --- | --- |
| `src/read-frog-lite-via.user.js` | **唯一可编辑源文件**（定制版，含 `// @version`），所有改动都落在这里 |
| `upstream/read-frog-lite-via-1.2.1.user.js` | 上游 v1.2.1 原版基线，只读参考，用于对比定制改动 |
| `tests/test-four-finger.cjs` | 多指手势回归测试（22 用例），从源码按标记截取真实代码执行 |
| `tests/test-persist.cjs` | 配置持久化回归测试（13 用例），截取配置层在 vm 沙箱里跑 |
| `tests/test-via-port.mjs` | 既有端到端测试（依赖 playwright，未随仓库安装） |
| `scripts/release.cjs` | 零依赖发布脚本：读版本号 → 同步 `rfvia-publish/` |
| `docs/` | 开发指南、分析报告、优化方向记录与 `images/` |
| `rfvia-publish/` | 部署产物：`index.html` 下载页 + 各版本 `.user.js` / `.txt` |
| `package.json` | 只有 `scripts`，无任何依赖字段 |

## 开发流程

```bash
# 1. 只改 src/read-frog-lite-via.user.js
# 2. 语法检查 + 回归测试（必须 22/22 与 13 通过 / 0 失败）
npm run check
npm test
# 3. 同步发布产物（读 @version → 生成 .user.js/.txt → 改 index.html）
npm run release
# 4. 部署：提交 rfvia-publish/ 后由维护者发布到静态托管
git add -A && git commit -m "feat: ..."
```

改版本号只需改 `src/read-frog-lite-via.user.js` 头部的 `// @version`，再执行 `npm run release`；脚本不联网、不读本机其他路径。详细说明（新增翻译服务的完整步骤、调试技巧、常见假红排查）见 [docs/development.md](docs/development.md)。

## 如何新增一个翻译服务

新服务不是改一处就够，下面四处必须联动（缺一处会出现「设置里选得到但翻译报错」或「有响应但缓存串味」）：

1. **服务枚举**：`DEFAULT_CONFIG.service` 默认值 + `normalizeConfig()` 里的 `isOneOf(source.service, [...])` 白名单，加上新的 `service` 取值。
2. **设置面板**：`<select id="service">` 增加 `<option>`；`updateServiceFields()` 里同步 `ai-fields` 显隐、`custom-endpoint-wrap` 显隐与模型下拉候选。
3. **端点解析**：`resolvedEndpoint()` 为新服务返回固定地址（或走 `custom` 的自定义地址补全逻辑）。
4. **翻译分发**：`requestTranslations()` 里的 `providerCall` 按 `cfg.service` 分发，新增分支调用对应的 `xxxTranslate()` 实现（现有两条：`microsoftTranslate()` 与 `aiTranslate()`）；若请求体不走 Chat Completions 格式，需要单独写请求与解析。

补充检查点：`migrateConfig()` 的旧配置迁移（`provider`/`endpoint` → `service`）、缓存键（`translationCacheKey()` 会带上服务标识，避免不同服务共用缓存）、`validateConfig()` 的必填校验。

## 测试桩的两个已知坑

两个 `.cjs` 测试都是「从真实源码截取代码 + 假 DOM」运行，不是重写逻辑，因此桩必须足够像真机：

1. **`El` 桩必须有 `className` 的 setter**。脚本里用 `el.className = "..."` 切换状态，若桩只提供 `classList` 或只读 `className`，赋值会被静默丢弃，激活态判断随之错乱 —— 表现为莫名其妙的假红。
2. **沙箱必须预置 `var config = {}`**。截取的代码块里有 `validateConfig(config)`，若 `config` 未声明会抛 `ReferenceError`，而外层 `try/catch` 会把异常吞掉，测试因此「通过」或「随机失败」，排查成本极高。

## 发布产物

`rfvia-publish/` 是纯静态下载页，结构保持不变：

- `index.html`：卡片式下载页，含 `.user.js` 下载按钮、直链、`.txt` 纯文本入口与 Via 安装步骤。
- `read-frog-lite-via-v<版本>.user.js`：该版本的完整脚本，与 `src/` 逐字节一致。
- `read-frog-lite-via-v<版本>.txt`：同一份脚本的纯文本版（CRLF → LF 归一，便于手机上长按复制）。
- 历史版本文件保留不删，便于回滚与对比。

`npm run release` 会更新 `index.html` 的标题、`.ver` 行与两处 `.user.js`、`.txt` 链接；页面底部的版本说明段落（`.note`）是人工撰写的变更描述，脚本不会自动改写，发版时请手动更新。

## Features

- 为 Via 浏览器和 Android WebView 的移动阅读场景优化
- 页面加载期间尽早显示悬浮球，并兼容限制内联样式的严格 CSP 网站
- 渐进式网页正文翻译，优先处理当前阅读区域，并让批量结果逐条自然显示
- 双语对照与“直接替换原文”模式，可随时切换或恢复原文
- 可为指定网站开启自动翻译，默认仍保持手动触发
- Microsoft 免费翻译、OpenAI、DeepSeek 与 OpenAI Compatible API
- 跨页面本地翻译缓存、批量控制、并发控制、失败段落单独重试
- 限流与服务端错误自动退避重试，点击停止翻译会立即中止
- 长文没有段落数量上限，超长段落切分翻译后无损拼回
- 页面新增或改写的内容会继续跟进：动态加载、折叠展开、切换显示、AI 逐字输出、虚拟列表都不漏译
- 正文智能识别：跳过工具栏、表单、代码与隐藏内容，同时保留导航、页脚与按钮上的可读文字
- 输入框与可编辑区保护：草稿不会被读取、发送或改写
- 可拖动、贴边半隐藏的青蛙悬浮球，以及 Material 风格设置面板

## Installation

1. 下载或复制 [`src/read-frog-lite-via.user.js`](src/read-frog-lite-via.user.js)（或从 `rfvia-publish/` 取对应版本）。
2. 将文件传到 Android 设备，或复制完整脚本内容。
3. 在 Via 中打开“设置 → 脚本”，从本地导入脚本或新建脚本后粘贴保存。
4. 启用脚本并刷新网页。页面右侧会出现半隐藏的青蛙悬浮球。
5. 轻点一次悬浮球将其呼出；再次轻点开始翻译。长按可打开翻译模式、恢复原文与设置等操作。

> Via 的菜单名称可能因版本或语言略有不同；核心步骤是导入并启用用户脚本，然后刷新目标网页。

## Configuration

长按悬浮球，选择“设置”即可配置服务、语言、显示模式、每批段落数与并发数。开启“总是自动翻译此网站”后，脚本会记住当前域名，并在以后访问该域名时自动翻译。

| 服务 | 是否需要 API Key | 说明 |
| --- | --- | --- |
| Microsoft | 否 | 默认免费服务，适合首次使用与日常阅读。 |
| OpenAI | 是 | 使用官方 Chat Completions 接口。 |
| DeepSeek | 是 | 脚本固定使用 `https://api.deepseek.com/chat/completions`。 |
| Custom API | 通常需要 | 兼容 OpenAI Chat Completions 的自定义服务；填写基础地址即可，脚本会补全 `/chat/completions`。 |

对于 OpenAI、DeepSeek 与自定义接口，请填写自己的 API Key 和模型名称。请先使用“测试服务”确认配置可用，再翻译网页。

目标语言为中文等字符体系明确的语言时，脚本会在请求前跳过已经是目标语言的纯文本，以及 URL、邮箱、纯数字、金额与版本号等内容；中外文混合段落仍会发送给翻译服务。AI 批量输出格式异常时会使用受控并行补救，减少逐段等待；遇到限流或服务端错误时按指数退避自动重试，最多 3 次。

## Compatibility

- 设计目标为较新的 Via 浏览器与 Android System WebView。
- 使用构造样式表加载脚本界面和译文样式，以兼容禁止内联样式的严格 CSP 页面。
- 脚本优先使用 Via 提供的 `GM_*` API；在缺少部分 API 的环境中会尝试标准 Web API 作为降级路径，但自定义跨域接口可能无法工作。
- 自定义接口默认要求 HTTPS；仅 `localhost`、`127.0.0.1` 与 Android 模拟器地址 `10.0.2.2` 可使用 HTTP。
- Canvas、PDF 查看器、封闭 Shadow DOM 等不提供普通网页 DOM 正文的页面，可能无法识别可翻译内容；图片内的文字、CSS 伪元素生成的内容与 iframe 内部也不在翻译范围内。

## Privacy

- API Key 保存在 Via 的本地用户脚本存储中，不会由本脚本上传到开发者服务器；它不是加密保险库，请不要在不受信任或多人共用的设备上保存敏感 Key。
- 为减少重复请求，脚本会在本地保存容量受限的原文与译文缓存（最多约 300 条）；缓存键不包含 API Key，清除 Via 的脚本数据即可移除缓存。
- 在你手动翻译网页、为当前网站开启自动翻译或测试服务时，待翻译文本会发送给你选择的翻译服务。
- 使用 Microsoft 服务时，文本会发送到 Microsoft 翻译服务；使用 AI 或自定义服务时，文本会发送到对应 API 提供方。请同时阅读该服务提供方的隐私政策。
- 本脚本不包含统计、遥测、广告或开发者数据收集代码。
- 脚本声明 `GM_xmlhttpRequest` 和 `@connect *`，是为了在 Via 中绕过网页跨域限制，并支持用户自行配置的 OpenAI Compatible API。请只填写可信服务地址，并妥善保管 API Key。

## Credits

感谢 [Read Frog](https://github.com/mengxi-ream/read-frog) 原作者与贡献者提供的开源项目、设计思路和参考实现。

## License

本项目采用 [GPL-3.0-only](LICENSE) 许可证发布。

发布或再分发修改版本时，请保留上游归属与许可证声明，并同时提供对应源码。

## 文档

- [docs/development.md](docs/development.md)：开发指南（结构、新增服务、调试、发布、排查假红）
- [docs/read-frog-lite-via-分析报告.md](docs/read-frog-lite-via-分析报告.md)：代码结构分析
- [docs/read-frog-lite-via-优化方向分析.md](docs/read-frog-lite-via-优化方向分析.md)：优化方向分析
- [docs/read-frog-lite-via-优化方向修订与实施记录.md](docs/read-frog-lite-via-优化方向修订与实施记录.md)：优化实施记录
- [CHANGELOG.md](CHANGELOG.md)：版本变更
