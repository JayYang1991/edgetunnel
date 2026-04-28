# Telegram 助手工具 (telegram_tool.py)

这是一个基于 Python 和 Telethon 库开发的 Telegram 资源管理工具，支持获取聊天列表、预览消息资源、下载指定资源，并针对大文件提供了并发下载加速功能。

## 🚀 核心功能

- **聊天列表获取**：快速查看最近的对话、群组和频道。
- **资源预览**：在下载前预览指定对话的消息内容及媒体资源（图片、文档、视频）。
- **智能搜索**：支持通过聊天名称关键字模糊搜索目标对话。
- **关键字过滤**：支持按文件名关键字过滤要下载的资源。
- **精确下载**：支持指定具体的消息 ID 进行下载。
- **大文件加速**：针对大于 200MB 的文件自动开启并发下载（10 线程），显著提升下载速度。
- **实时进度**：下载时实时显示百分比、下载量及当前速率。

## 🛠️ 安装准备

1. **获取 Telegram API 凭据**：
   - 访问 [my.telegram.org](https://my.telegram.org) 并登录。
   - 点击 "API development tools"，创建一个应用以获取 `api_id` 和 `api_hash`。

2. **安装依赖**：
   ```bash
   pip install telethon
   ```

3. **设置环境变量**：
   为了安全起见，脚本从环境变量中读取 API 凭据：
   ```bash
   export TG_API_ID='您的_API_ID'
   export TG_API_HASH='您的_API_HASH'
   ```

## 📖 使用指南

### 1. 查看聊天列表
列出最近的 30 条对话及其 ID 和名称。
```bash
python telegram_tool.py list
```

### 2. 预览对话内容
查看指定 ID 的对话中最近的消息和资源。
```bash
# --id: 目标聊天 ID
# --limit: 预览的消息条数（默认 20）
python telegram_tool.py show --id 12345678 --limit 30
```

### 3. 下载资源
这是脚本的核心命令，支持多种模式。

#### A. 基础下载 (按 ID)
下载指定聊天中最近的 5 个资源：
```bash
python telegram_tool.py download --id 12345678 --limit 5
```

#### B. 智能搜索并下载 (按名称关键字)
无需输入 ID，通过聊天名称的部分关键字下载资源：
```bash
# 搜索名称包含 "动漫" 的群组，并下载前 10 个资源
python telegram_tool.py download --name "动漫" --limit 10
```

#### C. 带过滤条件的下载
仅下载文件名中包含特定关键字的资源（如 "1080p"）：
```bash
python telegram_tool.py download -n "电影分享" --filter "1080p" -l 5
```

#### D. 精确下载特定消息
通过 `show` 命令确认 ID 后，指定下载：
```bash
# 下载消息 ID 为 54321 和 54325 的资源
python telegram_tool.py download --id 12345678 --ids 54321 54325
```

#### E. 指定保存路径
```bash
python telegram_tool.py download -n "学习资料" -o "/home/user/downloads/study"
```

## ⚙️ 参数详解

| 参数 | 缩写 | 描述 |
| :--- | :--- | :--- |
| `list` | - | 子命令：列出最近的聊天 |
| `show` | - | 子命令：展示聊天资源列表 |
| `download` | - | 子命令：执行下载任务 |
| `--id` | - | 目标聊天 ID |
| `--name` | `-n` | 目标聊天名称关键字（模糊匹配） |
| `--limit` | `-l` | 数量限制（预览条数或下载个数） |
| `--filter` | `-f` | 文件名过滤关键字 |
| `--ids` | - | 指定下载的消息 ID 列表（空格分隔） |
| `--output` | `-o` | 下载保存路径（默认 `./downloads`） |

## 💡 注意事项

- **首次登录**：第一次运行脚本时，控制台会提示您输入手机号和验证码进行登录。登录信息会保存在本地 `gemini_session.session` 文件中，后续无需重复登录。
- **大文件判定**：脚本会自动识别 200MB 以上的文件并开启加速模式。
- **安全性**：请勿将 `gemini_session.session` 文件分享给他人，这相当于您的 Telegram 登录状态。
