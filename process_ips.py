import os
import subprocess
import glob
import csv
import sys
import collections
import re
import argparse

# --- 配置区 ---
TG_TOOL = "telegram_tool.py"
DOWNLOAD_DIR = "./origin-iplist"
CFST_BIN = "cfst"
FINAL_TXT = "ip_result.txt"

def run_command(cmd, description):
    print(f"==> {description}...")
    try:
        subprocess.run(cmd, shell=True, check=True)
    except subprocess.CalledProcessError:
        print(f"警告: {description} 执行任务中出现错误")

def get_latest_file(pattern):
    files = glob.glob(pattern)
    return max(files, key=os.path.getmtime) if files else None

def parse_source_file(file_path):
    """解析 IP:Port 格式文件，提取纯数字端口并保留原始备注"""
    port_groups = collections.defaultdict(list)
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or ':' not in line:
                    continue
                
                parts = line.split(':', 1)
                ip = parts[0].strip()
                full_port_str = parts[1].strip()
                
                numeric_port_match = re.search(r'^(\d+)', full_port_str)
                if numeric_port_match:
                    numeric_port = numeric_port_match.group(1)
                    port_groups[numeric_port].append((ip, full_port_str))
    except Exception as e:
        print(f"解析原始文件失败: {e}")
    return port_groups

def get_speed_from_row(row):
    """从 CSV 行中智能提取下载速度列的值"""
    keywords = ['速度', 'Speed', 'MB/s']
    for key, value in row.items():
        if any(kw in key for kw in keywords):
            try:
                return float(value)
            except (ValueError, TypeError):
                continue
    return 0.0

def main():
    parser = argparse.ArgumentParser(description="集成测速工具: 从 Telegram 下载并使用 CloudflareST 筛选最优 IP")
    parser.add_argument("--top", "-t", type=int, default=20, help="最终保留的最优 IP 数量 (默认: 20)")
    parser.add_argument("--min-speed", "-s", type=float, default=10.0, help="最小下载速度过滤 (MB/s, 默认: 10.0)")
    args = parser.parse_args()

    # 1. 下载最新文件
    download_cmd = f"{TG_TOOL} download -n 'CF中转' --limit 1 -o {DOWNLOAD_DIR}"
    run_command(download_cmd, "从 Telegram 下载最新的 IP 列表")

    latest_file = get_latest_file(os.path.join(DOWNLOAD_DIR, "*.txt"))
    if not latest_file:
        print("错误: 未找到下载的文件")
        return
    print(f"识别到原始文件: {latest_file}")

    # 2. 解析文件
    groups = parse_source_file(latest_file)
    if not groups:
        print("错误: 原始文件中没有有效的 IP:Port 数据")
        return

    all_results = []

    # 3. 循环对每个端口进行测试
    for port, entries in groups.items():
        print(f"\n--- 正在测试端口 {port} (共 {len(entries)} 个 IP，过滤带宽 < {args.min_speed}MB/s) ---")
        temp_ip_file = f"temp_ips_{port}.txt"
        temp_csv = f"result_{port}.csv"
        
        ip_to_original = {e[0]: e[1] for e in entries}
        
        with open(temp_ip_file, 'w') as f:
            f.write("\n".join(e[0] for e in entries))
        
        # 运行测速命令
        # -sl: 最小下载速度过滤
        cfst_cmd = f"{CFST_BIN} -f {temp_ip_file} -tp {port} -httping -dn 10 -sl {args.min_speed} -o {temp_csv}"
        run_command(cfst_cmd, f"端口 {port} 测速中")

        # 解析测速结果
        if os.path.exists(temp_csv):
            try:
                with open(temp_csv, mode='r', encoding='utf-8-sig') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        ip_addr = row.get('IP 地址') or row.get('IP Address') or list(row.values())[0]
                        speed = get_speed_from_row(row)
                        
                        if ip_addr in ip_to_original:
                            all_results.append({
                                'full_line': f"{ip_addr}:{ip_to_original[ip_addr]}",
                                'speed': speed
                            })
                os.remove(temp_csv)
            except Exception as e:
                print(f"读取端口 {port} 结果失败: {e}")
        
        if os.path.exists(temp_ip_file):
            os.remove(temp_ip_file)

    # 4. 排序并挑选
    all_results.sort(key=lambda x: x['speed'], reverse=True)
    top_count = min(len(all_results), args.top)
    top_results = all_results[:top_count]

    # 5. 保存并打印结果
    if top_results:
        with open(FINAL_TXT, 'w') as f:
            for item in top_results:
                f.write(f"{item['full_line']}\n")
        print(f"\n✨ 测速完成！(已过滤低带宽) 最优前 {len(top_results)} 个 IP 已保存至 {FINAL_TXT}")
        for i, item in enumerate(top_results):
            print(f"  [{i+1:>2}] {item['full_line']:<30} - {item['speed']:.2f} MB/s")
    else:
        print(f"\n未能在任何端口测得满足 > {args.min_speed}MB/s 条件的结果。")

if __name__ == "__main__":
    main()
