# GEMINI.md - edgetunnel 2.0 项目指令上下文

## 🚀 项目概览
**edgetunnel** 是一个基于 Cloudflare Workers/Pages 平台的边缘计算隧道解决方案。它旨在提供高性能的流量转发、内置的管理面板以及自动化的订阅分发系统。

- **主要协议**：VLESS, Trojan
- **运行平台**：Cloudflare Workers, Cloudflare Pages
- **核心功能**：流量加解密、可视化后台、多协议订阅生成、优选 IP 支持、SOCKS5/HTTP 链式代理。

## 核心技术栈
- **运行时**：Cloudflare Workers (JavaScript/V8)
- **存储**：Cloudflare KV (用于持久化配置和日志)
- **协议**：WebSocket (用于隧道传输), VLESS, Trojan, SOCKS5, HTTP Proxy
- **工具**：Wrangler (部署工具)

## 📁 关键文件说明
- `_worker.js`: 项目的核心代码，包含所有业务逻辑（协议解析、流量转发、管理面板、订阅生成）。
- `wrangler.toml`: Cloudflare 部署配置文件。
- `README.md`: 详尽的部署指南和环境变量说明。
- `worker_js_analysis.md`: 对 `_worker.js` 内部函数和逻辑的深度分析。
- `config.json`: (如果存在) 默认配置模板。
- `.github/workflows/sync.yml`: 用于自动同步上游仓库的 GitHub Action。

## 🛠 部署与开发
### 环境变量 (环境变量对系统行为有重大影响)
| 变量名 | 描述 |
| :--- | :--- |
| `ADMIN` | 管理面板的登录密码 (必填) |
| `KV` | 绑定的 KV 命名空间 (必填) |
| `UUID` | VLESS 协议的唯一识别码 |
| `PROXYIP` | 优选反代 IP |
| `URL` | 伪装站点的地址 |

### 部署方式
1. **Workers 直接部署**：将 `_worker.js` 源码粘贴至 Workers 编辑器。
2. **Pages 部署**：上传项目压缩包或直接连接 GitHub 仓库。

### 本地开发 (TODO)
目前该项目主要针对云端环境。若需本地调试，通常使用 `wrangler dev`。
- 运行命令：`npx wrangler dev` (需先配置 `wrangler.toml`)

## 💡 交互建议
- **代码修改**：对 `_worker.js` 的修改应保持其单文件架构，注意 Cloudflare Workers 的 1MB 脚本限制。
- **配置调试**：优先检查环境变量设置和 KV 绑定。
- **功能增强**：在添加新功能前，请参考 `worker_js_analysis.md` 了解现有逻辑，避免破坏协议解析和转发流程。
- **语言要求**：回复和规划请使用简体中文。
