# Figma-DL

[![npm version](https://img.shields.io/npm/v/figma-dl.svg)](https://www.npmjs.com/package/figma-dl)

Figma 图片下载工具 - 绕过 MCP 官方工具的 bug，直接调用 Figma API。

## 安装

```bash
# 全局安装
npm install -g figma-dl

# 或使用 npx 直接运行（无需安装）
npx figma-dl --help
```

## CLI 使用

```bash
# 设置 API Key（一次性，替换为你的 Key）
set FIGMA_API_KEY=<YOUR_FIGMA_API_KEY>

# 下载 PNG（默认 2x）
figma-dl -f otEuB83cLByEVzqDwg3T4r -n "3228-9855,3228-10044" -o ./images

# 下载 SVG
figma-dl -f otEuB83cLByEVzqDwg3T4r -n "3228-9855" -o ./images --format svg

# 指定缩放比例
figma-dl -f otEuB83cLByEVzqDwg3T4r -n "3228-9855" -o ./images --scale 3
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `-f, --file-key` | ✅ | Figma 文件 Key（从 URL 提取） |
| `-n, --node-ids` | ✅ | 节点 ID，逗号分隔 |
| `-o, --output` | ✅ | 输出目录 |
| `--format` | | 格式：png（默认）或 svg |
| `--scale` | | PNG 缩放：1-4（默认 2） |
| `--api-key` | | API Key（或用环境变量） |

## MCP 服务器

在 Windsurf 的 `mcp_config.json` 中添加：

```json
{
  "mcpServers": {
    "figma-dl": {
      "command": "node",
      "args": ["<YOUR_PATH>/.tools/figma-dl/src/mcp-server.js"],
      "env": {
        "FIGMA_API_KEY": "<YOUR_FIGMA_API_KEY>"
      }
    }
  }
}
```

将 `<YOUR_PATH>` 替换为实际安装路径，`<YOUR_FIGMA_API_KEY>` 替换为你的 Figma API Key。

### MCP 工具

**`download_images`** - 下载 Figma 图片

参数：
- `fileKey` (string): Figma 文件 Key
- `nodeIds` (string[]): 节点 ID 数组
- `outputDir` (string): 输出目录
- `format` (string): png 或 svg，默认 png
- `scale` (number): 1-4，默认 2

## 为什么需要这个工具？

官方 `figma-developer-mcp` 的 `download_figma_images` 功能有 bug，经常卡死。
这个工具直接调用 Figma REST API，稳定可靠。

## API Key

从 Figma 获取：Settings → Account → Personal access tokens
