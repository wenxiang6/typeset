# paiban-mcp · 排版编辑器 MCP

一个本地 stdio MCP，让支持 MCP 的 agent 直接检查、操作和回归测试这个前端项目。

## 启动

```bash
pnpm mcp
# 或
node tools/paiban-mcp/server.mjs
```

它会按需自动：
1. 复用或启动 Vite dev server（`http://127.0.0.1:5173`）；
2. 启动 Playwright Chromium（优先使用本机 `ms-playwright` 缓存）；
3. 打开编辑器并清空初始存档。

协议日志只写 stdout（JSON-RPC），运行日志写 stderr。

## 客户端配置

```json
{
  "mcpServers": {
    "paiban": {
      "command": "node",
      "args": ["tools/paiban-mcp/server.mjs"],
      "cwd": "/Users/gongyi/wenxiang/paiban"
    }
  }
}
```

把 `cwd` 换成你项目实际路径即可。Claude Desktop、Cursor、DSH 等客户端都使用类似结构。

环境变量：

| 变量 | 作用 |
| --- | --- |
| `PAIBAN_URL` | 指定已有页面地址（默认 `http://127.0.0.1:5173/`） |
| `PAIBAN_CDP` | 接管已打开的 Chrome，例如 `http://127.0.0.1:9222`（优先于 `PAIBAN_URL`；不清存档、不重载） |
| `PAIBAN_CHROMIUM` | 指定 Chrome/Chromium 可执行文件 |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright 浏览器缓存目录 |

## 工具

| 工具 | 作用 |
| --- | --- |
| `paiban_status` | 页数、元素数、横竖版、每页底部、页脚页码、出界/重叠/消失检查 |
| `paiban_dom` | DOM 完整性；`{rects:true}` 附带每个元素矩形 |
| `paiban_console` | 控制台错误/警告、pageerror、请求失败、4xx/5xx；`{clear:true}` 读取后清空 |
| `paiban_screenshot` | 截图并返回图片内容与 `artifacts/smoke/` 路径 |
| `paiban_pages_shot` | 逐页截图（自动滚动到每页），存 `pages-N.png`，第 1 页内联返回 |
| `paiban_import_word` | 导入本机 Word 原稿：解析 → 生成版面 → 返回页数/组件数/不变量。`orientation: landscape\|portrait` 选导入成横版还是竖版；`merge: auto\|merge\|split` 控制短条目（学习要求/必考能力/易错项）合并还是拆分 |
| `paiban_eval` | 在页面上下文执行 JS，可用 `api`（`window.__paibanApi`） |
| `paiban_orientation` | 切换 `portrait` / `landscape` 并等待重排稳定 |
| `paiban_reset` | 清空本地存档、回到初始模板（CDP 模式下只重载页面，不动存档） |
| `paiban_print_check` | 切打印媒体，检查工具栏/纸张/@page，再恢复 |
| `paiban_run_smoke` | 执行 `pnpm smoke` 全套回归 |
| `validate_layout` | 校验语义版面 JSON（类型白名单 / 必填 / 空块 / 汉字数）。**不起浏览器** |
| `submit_layout` | 语义 JSON → 服务端排版并推送，前端刷新即见；`dryRun:true` 只出报告 |
| `upload_image` | 本机图片 → `local:` 引用 + 宽高比，提交时自动转图片上传落盘 |

## 语义版面（AI 直接排版）

前八个工具是「操作浏览器里的编辑器」；后三个是「直接产出版面」，走纯 Node + HTTP，
不需要 Vite、不需要 Playwright，秒级返回：

```json
{ "name": "validate_layout", "arguments": { "path": "var/issue1/blocks.json" } }
{ "name": "submit_layout", "arguments": { "path": "var/issue1/blocks.json" } }
{ "name": "submit_layout", "arguments": { "layout": { "meta": {...}, "blocks": [...] }, "dryRun": true } }
{ "name": "upload_image", "arguments": { "path": "/Users/me/fig1.png" } }
```

语义 JSON 只描述内容（section/para/note/quiz/tpl…），**不带坐标**；坐标由
`tools/layout/geometry.mjs` 按真实栏宽算出来。完整 schema 见
`~/.workbuddy/skills/paiban-word-to-json/SKILL.md` 或 `tools/layout/schema.mjs`。

## 示例

读状态：

```json
{ "name": "paiban_status", "arguments": {} }
```

切竖版：

```json
{ "name": "paiban_orientation", "arguments": { "value": "portrait" } }
```

执行页面 JS：

```json
{ "name": "paiban_eval", "arguments": { "expression": "return api.doc.pages.map(p => p.els.length)" } }
```

截图：

```json
{ "name": "paiban_screenshot", "arguments": { "name": "debug.png", "fullPage": false } }
```

## 自测

```bash
pnpm mcp:selftest
```

会启动 MCP、走 `initialize → tools/list → status → eval → shutdown`，
验证协议和浏览器链路。
