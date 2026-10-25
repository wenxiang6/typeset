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
| `PAIBAN_CHROMIUM` | 指定 Chrome/Chromium 可执行文件 |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright 浏览器缓存目录 |

## 工具

| 工具 | 作用 |
| --- | --- |
| `paiban_status` | 页数、元素数、横竖版、每页底部、页脚页码、出界/重叠/消失检查 |
| `paiban_dom` | DOM 完整性；`{rects:true}` 附带每个元素矩形 |
| `paiban_console` | 控制台错误/警告、pageerror；`{clear:true}` 读取后清空 |
| `paiban_screenshot` | 截图并返回图片内容与 `artifacts/smoke/` 路径 |
| `paiban_eval` | 在页面上下文执行 JS，可用 `api`（`window.__paibanApi`） |
| `paiban_orientation` | 切换 `portrait` / `landscape` 并等待重排稳定 |
| `paiban_reset` | 清空本地存档、回到初始模板 |
| `paiban_print_check` | 切打印媒体，检查工具栏/纸张/@page，再恢复 |
| `paiban_run_smoke` | 执行 `pnpm smoke` 全套回归 |

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
