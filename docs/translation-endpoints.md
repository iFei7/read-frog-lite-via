# 免费翻译通道调研与选型（v1.4.0）

调研时间：2026-11-10　实测环境：中国大陆网络（Android Via / 桌面 curl）

## 一、结论先行

| 通道 | 是否需要 Key | 批量能力 | 实测结果 | 定位 |
|---|---|---|---|---|
| Microsoft Edge | 否 | 原生数组，200 条 ≈ 0.79s | 200 / 0.43–0.82s，20 次连打无限流 | **首选**（默认） |
| 有道 aidemo | 否 | 换行拼接，单请求 ≤1000 字符 | 200 / 0.12–0.53s | **主备**（快、稳） |
| MyMemory | 否 | 单条，≤500 字符 | 200 / 1.3–2.4s | 兜底 |
| Google gtx | 否 | 无稳定批量（逐条） | **中国大陆 HTTP 000** | 仅可访问 Google 时可用 |
| DeepSeek 官方 | 是（API Key） | 模型批量 | 正常 | 已有，按需自配 |
| DeepSeek 网页版 | 否 | 无 | 需 PoW + 用户 token | **不实现**，见下文 |
| LibreTranslate / Lingva 公共实例 | 多数要 | — | 502 / 403 / 全部阵亡 | 不采用 |
| 百度 / Bing 网页 | 需要 | — | 百度 errno 1022；Bing 需 Cookie+token 且 302 到 cn.bing.com | 不采用 |
| DeepLX 公共实例 | 声称免费 | — | `api.deeplx.org` 返回的是广告链接（`data` 为论坛地址），非译文 | 不采用 |

## 二、关于参考项目 zotero-deepseek-web-translate

该项目的核心做法是**用浏览器自动化驱动 `chat.deepseek.com` 的网页对话框**：

1. 用户先在浏览器里正常登录 DeepSeek；
2. 插件在后台开一个隐藏页面/标签，把待翻译文本粘贴进输入框、点发送、读回复；
3. 鉴权、PoW（`x-ds-pow-response`）全部由浏览器里的真实会话完成，插件自己不实现签名。

**为什么不能移植到本脚本**：油猴脚本寄生在用户当前页面的上下文里，无法创建并持续持有另一个站点的登录态，也没有可复用的 PoW 计算链。要复刻就得自己实现 PoW（需逆向 WASM）并让用户手工粘贴 token，成本与脆弱性都不可接受。

结论：**DeepSeek 走官方 API（用户自备 Key）**，网页免 Key 通道不做。

## 三、各通道实现要点

### Microsoft Edge（既有）
```
POST https://edge.microsoft.com/translate/translatetext?from=&to=zh-Hans&isEnterpriseClient=false
Content-Type: application/json
["段落1","段落2", ...]
→ [{"translations":[{"text":"..."}]}, ...]
```
- 返回值按序一一对应，原生批量，200 条 0.79s
- 空数组会 400 → 不能空发
- 单条 9800 字符实测通过

### 有道 aidemo（v1.4.0 新增）
```
POST https://aidemo.youdao.com/trans
Content-Type: application/x-www-form-urlencoded
q=<encodeURIComponent(段落1\n段落2)>&from=auto&to=zh-CHS
→ {"errorCode":"0","translation":["译文1\n译文2"]}
```
- 单请求 **≤1000 字符**（1500 字稳定 `errorCode: 411`），脚本按 900 字符预算分片
- `errorCode` **有时字符串 `"0"`、有时数字 `0`** → 必须 `String(code) === "0"`
- 返回保留 `\n` → split 段数与入参一致时按序回填；不一致则整组降级逐条
- 语言码：`zh-CHS`（简中）

### MyMemory（v1.4.0 新增）
```
GET https://api.mymemory.translated.net/get?q=<enc>&langpair=Autodetect|zh-CN
→ {"responseData":{"translatedText":"..."},"responseStatus":200,"quotaFinished":false}
```
- **500 字符硬限**；超长时 HTTP 仍是 200，但 `responseStatus: "403"`、译文是 `QUERY LENGTH LIMIT EXCEEDED...`
  → 必须校验 `responseStatus` 且拦 `LIMIT EXCEEDED`，否则会把英文错误提示当译文渲染
- 会回传 HTML 实体，需 `decodeHtml`
- `quotaFinished: true` 表示当日额度用尽
- 无批量能力，脚本串行请求 + 120ms 间隔

### Google gtx（v1.4.0 新增，可选）
```
GET https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dj=1&ie=UTF-8&sl=auto&tl=zh-CN&q=<enc>
→ {"sentences":[{"trans":"..."},{"trans":"..."}],"src":"en"}
```
- `dj=1` 返回 JSON 对象；不带 `dj=1` 返回嵌套数组 `[[["译文","原文",...]],...]`
- 多句需 `sentences.map(s => s.trans).join("")`
- **无稳定批量**，只能逐条（脚本 3 条一批 + 150ms 间隔）
- 中国大陆不可直连（实测 HTTP 000），仅作代理环境下备用

### auto 降级链
```
Edge → 有道 → MyMemory
```
- 每级失败才进入下一级，Edge 正常时零额外请求
- 用户主动取消（abort）立即终止，不再请求后续通道
- 全失败时抛「所有免费通道均失败：…」并列出各级原因

## 四、工程取舍

1. **不预探测**：`auto` 不做健康检查，避免每次翻译多花一次往返。
2. **不把 Google 放进降级链**：大陆不可达，会让 auto 每次都白等超时。
3. **批量优先、逐条兜底**：有道的批量结果段数不齐时宁可多花钱逐条重发，也不猜对应关系——错译比慢更糟。
4. **缓存按服务隔离**：`translationCacheKey` 含 `cfg.service`，换通道不会串译文。
