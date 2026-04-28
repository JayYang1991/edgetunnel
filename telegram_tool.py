#!/home/jason/miniconda3/bin/python3
import os
import argparse
import asyncio
import time
from telethon import TelegramClient, utils
from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto

# --- API 配置 ---
# 请设置环境变量 TG_API_ID 和 TG_API_HASH
API_ID = os.getenv('TG_API_ID')
API_HASH = os.getenv('TG_API_HASH')
SESSION_NAME = '/home/jason/user_data/config/telegram/my_tg_session'

# 检查配置的函数
def check_config():
    if not API_ID or not API_HASH:
        print("\n错误: 未检测到 API 配置！")
        print("请先设置环境变量:")
        print("  export TG_API_ID='您的_API_ID'")
        print("  export TG_API_HASH='您的_API_HASH'")
        print("\n或者在运行命令前指定:")
        print("  TG_API_ID=xxx TG_API_HASH=yyy python telegram_tool.py list")
        return False
    return True

# 阈值与并发配置
BIG_FILE_THRESHOLD = 200 * 1024 * 1024
FILE_CONCURRENCY = 3  # 限制同时下载的文件数，避免连接重置

class DownloadProgress:
    def __init__(self, filename, total_tasks=1):
        self.filename = filename
        self.start_time = time.time()
        self.last_update = 0
        self.total_tasks = total_tasks
        self.call_count = 0 

    def callback(self, current, total):
        self.show_progress(current, total)

    def show_progress(self, current, total):
        self.call_count += 1
        
        # 确保关键节点总是显示
        is_important = (current >= total or self.call_count <= 1)
        
        if self.total_tasks > 1 and not is_important:
            # 根据任务数动态调整刷新率
            if self.call_count % min(self.total_tasks, 5) != 0:
                return

        now = time.time()
        # 频率防抖
        if not is_important and now - self.last_update < 0.5:
            return
        
        self.last_update = now
        elapsed = now - self.start_time
        speed = current / elapsed if elapsed > 0 else 0
        percentage = current * 100 / total if total > 0 else 0
        
        speed_str = self.format_size(speed) + "/s"
        current_str = self.format_size(current)
        total_str = self.format_size(total)
        
        if self.total_tasks == 1:
            print(f"\r{percentage:5.1f}% | {current_str:>9} / {total_str:<9} | {speed_str:>10} | {self.filename[:30]}", end="", flush=True)
            if current >= total: print()
        else:
            # 并发模式下显示简化的进度行
            print(f"[{percentage:5.1f}%] {speed_str:>10} | {self.filename[:30]}")

    @staticmethod
    def format_size(size):
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024:
                return f"{size:.2f}{unit}"
            size /= 1024
        return f"{size:.2f}TB"

async def parallel_download(client, message, save_path, progress):
    """大文件分块并发下载实现"""
    file_size = message.file.size
    chunk_size = 512 * 1024
    concurrency = 4  # 降低单文件内部并发，确保总连接数可控
    
    with open(save_path, 'wb') as f:
        f.truncate(file_size)
    
    f = open(save_path, 'r+b')
    semaphore = asyncio.Semaphore(concurrency)
    downloaded_bytes = 0
    lock = asyncio.Lock()

    async def download_chunk(offset, limit):
        nonlocal downloaded_bytes
        async with semaphore:
            # 增加块级重试机制
            for attempt in range(3):
                try:
                    async for chunk in client.iter_download(message, offset=offset, limit=limit, request_size=limit):
                        if chunk:
                            async with lock:
                                f.seek(offset)
                                f.write(chunk)
                                downloaded_bytes += len(chunk)
                                progress.show_progress(downloaded_bytes, file_size)
                            return
                except Exception as e:
                    if attempt == 2: raise e
                    await asyncio.sleep(1)

    tasks = [download_chunk(o, min(chunk_size, file_size - o)) for o in range(0, file_size, chunk_size)]
    
    try:
        await asyncio.gather(*tasks)
    except Exception as e:
        # 并发失败则回退到原生下载
        await client.download_media(message, save_path, progress_callback=progress.callback)
    finally:
        f.close()

async def download_task(client, message, output_path, semaphore, task_id, total_tasks):
    """单个文件下载任务调度与重试"""
    async with semaphore:
        _, file_name = await get_media_info(message)
        # 清理文件名非法字符，防止路径错误导致连接重置
        file_name = "".join([c for c in file_name if c not in '/\\:*?"<>|']).strip()
        
        save_file = os.path.join(output_path, file_name)
        if os.path.exists(save_file):
            save_file = os.path.join(output_path, f"{message.id}_{file_name}")

        print(f"[{task_id}/{total_tasks}] 准备下载: {file_name}")
        
        for attempt in range(2):
            try:
                progress = DownloadProgress(file_name, total_tasks=total_tasks)
                file_size = message.file.size or 0
                if file_size > BIG_FILE_THRESHOLD:
                    await parallel_download(client, message, save_file, progress)
                else:
                    await client.download_media(message, save_file, progress_callback=progress.callback)
                return True
            except Exception as e:
                if attempt == 0:
                    print(f"\n[{task_id}] 下载中断，正在尝试重连重试... ({e})")
                    await asyncio.sleep(3)
                else:
                    print(f"\n[{task_id}] 下载彻底失败: {file_name} ({e})")
                    return False

async def download_files(client, chat_id, chat_name, limit, output_path, msg_ids=None, file_filter=None):
    """主下载调度逻辑"""
    abs_output_path = os.path.abspath(output_path)
    if not os.path.exists(abs_output_path):
        os.makedirs(abs_output_path)

    entity = None
    if chat_id:
        try:
            entity = await client.get_entity(chat_id)
        except Exception as e:
            print(f"错误: 无法获取 ID 为 {chat_id} 的聊天 ({e})")
            return
    elif chat_name:
        print(f"正在搜索包含关键字 '{chat_name}' 的聊天...")
        matches = []
        async for dialog in client.iter_dialogs():
            if chat_name.lower() in dialog.title.lower():
                matches.append(dialog)
        
        if not matches:
            print(f"错误: 未找到包含关键字 '{chat_name}' 的聊天。")
            return
        
        if len(matches) > 1:
            print(f"发现 {len(matches)} 个匹配项，默认选择第一个: '{matches[0].title}'")
        
        entity = matches[0].entity
    else:
        print("错误: 请提供 ID 或名称")
        return

    # 1. 收集消息
    pending_messages = []
    if msg_ids:
        print(f"正在收集指定的资源...")
        msgs = await client.get_messages(entity, ids=msg_ids)
        pending_messages = [m for m in (msgs if isinstance(msgs, list) else [msgs]) if m and m.media]
    else:
        filter_str = f" (过滤: '{file_filter}')" if file_filter else ""
        print(f"正在收集最近匹配的 {limit} 个资源{filter_str}...")
        async for message in client.iter_messages(entity, limit=500):
            if message.media:
                _, file_name = await get_media_info(message)
                if file_filter and file_filter.lower() not in file_name.lower():
                    continue
                pending_messages.append(message)
                if len(pending_messages) >= limit:
                    break

    if not pending_messages:
        print("未发现匹配资源")
        return

    print(f"正在启动并行下载 (最大并发文件数: {FILE_CONCURRENCY})...")
    
    # 2. 调度执行
    sem = asyncio.Semaphore(FILE_CONCURRENCY)
    tasks = []
    for i, msg in enumerate(pending_messages):
        tasks.append(download_task(client, msg, abs_output_path, sem, i+1, len(pending_messages)))
    
    results = await asyncio.gather(*tasks)
    success_count = sum(1 for r in results if r)
    
    print(f"\n全部完成！成功下载 {success_count}/{len(pending_messages)} 个文件。")
    print(f"保存路径: {abs_output_path}")

async def list_chats(client):
    """获取并显示最近的对话列表"""
    print("\n正在获取聊天列表...")
    print(f"{'Chat ID':<15} | {'Title'}")
    print("-" * 50)
    async for dialog in client.iter_dialogs(limit=30):
        print(f"{dialog.id:<15} | {dialog.title}")
    print("-" * 50)

async def get_media_info(message):
    """提取消息中的媒体类型和文件名"""
    if not message.media:
        return "Text", message.text.replace('\n', ' ')[:30] if message.text else ""
    
    media_type = "Unknown"
    file_name = "N/A"
    
    if isinstance(message.media, MessageMediaPhoto):
        media_type = "Photo"
        file_name = f"photo_{message.id}.jpg"
    elif isinstance(message.media, MessageMediaDocument):
        media_type = "Document"
        for attr in message.media.document.attributes:
            if hasattr(attr, 'file_name'):
                file_name = attr.file_name
                break
        if file_name == "N/A":
            file_name = f"doc_{message.id}"
            
    return media_type, file_name

async def show_messages(client, chat_id, limit):
    """展示指定聊天的消息和资源列表"""
    try:
        entity = await client.get_entity(chat_id)
    except Exception as e:
        print(f"错误: 无法获取 ID 为 {chat_id} 的聊天 ({e})")
        return

    print(f"\n正在获取 '{entity.title}' 的消息列表 (最近 {limit} 条):")
    print(f"{'ID':<10} | {'Time (UTC)':<19} | {'Type':<10} | {'Content/File'}")
    print("-" * 80)

    async for message in client.iter_messages(entity, limit=limit):
        m_type, m_info = await get_media_info(message)
        time_str = message.date.strftime("%Y-%m-%d %H:%M:%S")
        print(f"{message.id:<10} | {time_str:<19} | {m_type:<10} | {m_info}")
    
    print("-" * 80)

async def main():
    parser = argparse.ArgumentParser(description="Telegram 助手: 列表获取、预览与下载")
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # List 命令
    subparsers.add_parser("list", help="显示最近的聊天对话列表")

    # Show 命令
    show_parser = subparsers.add_parser("show", help="展示指定聊天的消息和资源列表")
    show_parser.add_argument("--id", type=int, required=True, help="目标聊天的 ID")
    show_parser.add_argument("--limit", "-l", type=int, default=20, help="展示的消息数量 (默认: 20)")

    # Download 命令
    dl_parser = subparsers.add_parser("download", help="下载指定聊天的文件")
    dl_parser.add_argument("--id", type=int, help="目标聊天的 ID")
    dl_parser.add_argument("--name", "-n", type=str, help="目标聊天的完整名称")
    dl_parser.add_argument("--filter", "-f", type=str, help="资源文件名过滤关键字 (不区分大小写)")
    dl_parser.add_argument("--limit", "-l", type=int, default=10, help="下载文件数量限制 (默认: 10)")
    dl_parser.add_argument("--ids", type=int, nargs="+", help="指定要下载的消息 ID 列表")
    dl_parser.add_argument("--output", "-o", type=str, default="./downloads", help="下载保存路径")

    args = parser.parse_args()

    if not check_config():
        return

    # 初始化 Client 时增加自动重连和无限重试
    client = TelegramClient(
        SESSION_NAME, 
        API_ID, 
        API_HASH,
        connection_retries=None, # 无限重试连接
        retry_delay=2            # 重试间隔
    )
    
    async with client:
        if args.command == "list":
            await list_chats(client)
        elif args.command == "show":
            await show_messages(client, args.id, args.limit)
        elif args.command == "download":
            await download_files(client, args.id, args.name, args.limit, args.output, args.ids, args.filter)
        else:
            parser.print_help()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n用户中止操作")
