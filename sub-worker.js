/**
 * edgetunnel 优选订阅管理 Worker
 * 功能：
 * 1. /sub 接口：返回加密的节点列表（合并远程与本地 KV 优选 IP）。
 * 2. /admin 接口：美观的管理后台，用于编辑本地优选 IP。
 * 3. /api/update 接口：支持 PUT 请求配合 Token 自动更新。
 */

// 默认配置
const DEFAULT_SUB_SOURCE = 'https://sub.cmliussss.net';
const USER_AGENT = 'v2rayN/edgetunnel (https://github.com/cmliu/edgetunnel)';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 1. 订阅接口 /sub
        if (path === '/sub') {
            return await handleSubRequest(request, env);
        }

        // 2. 私有更新接口 /api/update (支持 PUT)
        if (path === '/api/update') {
            return await handleApiUpdate(request, env);
        }

        // 3. 管理后台 /admin
        if (path === '/admin' || path === '/login') {
            return await handleAdminRequest(request, env);
        }

        // 4. 默认返回
        return new Response('Not Found', { status: 404 });
    }
};

/**
 * 处理订阅请求
 */
async function handleSubRequest(request, env) {
    const { searchParams } = new URL(request.url);
    const host = searchParams.get('host');
    const uuid = searchParams.get('uuid');

    if (!host || !uuid) {
        return new Response('Missing host or uuid parameter', { status: 400 });
    }

    // 1. 获取远程优选 IP
    let remoteSource = env.SUB_SOURCE || DEFAULT_SUB_SOURCE;

    // 如果是默认源或 sub.cmliussss.net，构造完整的 sub 链接
    if (remoteSource.includes('sub.cmliussss.net')) {
        const baseUrl = remoteSource.endsWith('/sub') ? remoteSource : `${remoteSource.replace(/\/$/, '')}/sub`;
        remoteSource = `${baseUrl}?host=${host}&uuid=${uuid}`;
    } else if (remoteSource.includes('github.com') && !remoteSource.includes('raw.githubusercontent.com') && !remoteSource.includes('/raw/')) {
        remoteSource = remoteSource.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/') + '/main/ADD.txt';
    }

    let remoteContent = '';
    try {
        const res = await fetch(remoteSource, {
            headers: { 'User-Agent': USER_AGENT }
        });
        if (res.ok) {
            let text = await res.text();
            // 如果内容是 base64，则解码
            if (isValidBase64(text)) {
                remoteContent = base64Decode(text);
            } else {
                remoteContent = text;
            }
        }
    } catch (e) {
        console.error('Fetch remote IPs failed:', e);
    }

    // 2. 获取 KV 本地优选 IP
    let localIps = '';
    if (env.KV) {
        localIps = await env.KV.get('ADD.txt') || '';
    }

    // 3. 合并并解析所有行
    // 远程源可能返回 VLESS 链接或 IP:PORT 格式
    const remoteLines = splitLines(remoteContent);
    const localLines = splitLines(localIps);

    const allIps = new Set();
    const otherNodes = [];

    // 解析远程内容
    for (const line of remoteLines) {
        if (line.startsWith('vless://')) {
            // 如果是 VLESS 链接，提取其中的地址和端口部分，以便后续统一重新生成（或直接保留）
            // 这里我们选择提取 IP:PORT 部分并去重，备注部分也尽量保留
            const match = line.match(/@([^?#]+)/);
            if (match) {
                const addressPort = match[1];
                const remarkMatch = line.match(/#(.+)$/);
                const remark = remarkMatch ? decodeURIComponent(remarkMatch[1]) : '';
                allIps.add(`${addressPort}#${remark}`);
            } else {
                otherNodes.push(line);
            }
        } else if (line.includes(':')) {
            allIps.add(line);
        }
    }

    // 解析本地内容
    for (const line of localLines) {
        if (line.includes(':')) allIps.add(line);
    }

    // 4. 统一生成节点列表 (VLESS 格式)
    const nodes = Array.from(allIps).map(line => {
        if (!line.trim()) return null;
        // 格式：ip:port#remark 或 ip:port
        const [addressPort, ...remarkParts] = line.split('#');
        const remark = remarkParts.join('#') || '優选节点';

        // 确保地址和端口有效
        if (!addressPort.includes(':')) return null;

        const [address, port] = addressPort.split(':');
        // 构建 VLESS 链接
        // vless://uuid@address:port?encryption=none&security=tls&sni=host&fp=chrome&type=ws&host=host&path=%2F#remark
        return `vless://${uuid}@${address.trim()}:${port.trim()}?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F#${encodeURIComponent(remark.trim())}`;
    }).filter(Boolean);

    const result = nodes.join('\n');
    return new Response(btoa(result), {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

/**
 * 处理 API 更新 (PUT)
 */
async function handleApiUpdate(request, env) {
    if (request.method !== 'PUT') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    // Token 验证 (强制必选)
    const url = new URL(request.url);
    const token = request.headers.get('Authorization') || url.searchParams.get('token');
    const mode = url.searchParams.get('mode');

    if (!env.TOKEN) {
        return new Response('Unauthorized: TOKEN environment variable not set', { status: 401 });
    }
    if (token !== env.TOKEN) {
        return new Response('Unauthorized: Invalid token', { status: 401 });
    }

    let content = '';
    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('multipart/form-data')) {
        // 支持文件上传格式 (例如 curl -F "file=@ADD.txt")
        const formData = await request.formData();
        const file = formData.get('file');
        if (file && typeof file !== 'string') {
            content = await file.text();
        } else if (typeof file === 'string') {
            content = file;
        }
    } else {
        // 默认支持原始文本流 (例如 curl --data-binary @ADD.txt)
        content = await request.text();
    }

    if (env.KV) {
        const invalidLines = validateProxyList(content);
        if (invalidLines.length > 0) {
            return new Response('Invalid format in lines:\n' + invalidLines.join('\n'), { status: 400 });
        }

        let finalContent = content;
        if (mode === 'append') {
            const existing = await env.KV.get('ADD.txt') || '';
            finalContent = existing + (existing && !existing.endsWith('\n') ? '\n' : '') + content;
        }
        await env.KV.put('ADD.txt', finalContent);
        return new Response('Updated successfully (' + (mode === 'append' ? 'Appended' : 'Overwritten') + ')', { status: 200 });
    } else {
        return new Response('KV not bound', { status: 500 });
    }
}

/**
 * 处理后台管理
 */
async function handleAdminRequest(request, env) {
    const adminPassword = env.ADMIN;
    if (!adminPassword) {
        return new Response('ADMIN password not set in environment variables', { status: 500 });
    }

    // 检查 Cookie 鉴权
    const cookie = request.headers.get('Cookie') || '';
    const isAuth = cookie.includes(`auth=${adminPassword}`);

    if (request.method === 'POST') {
        const formData = await request.formData();
        const password = formData.get('password');
        const action = formData.get('action');

        if (action === 'login') {
            if (password === adminPassword) {
                return new Response('Login success', {
                    status: 302,
                    headers: {
                        'Set-Cookie': `auth=${adminPassword}; HttpOnly; Path=/; Max-Age=86400`,
                        'Location': '/admin'
                    }
                });
            } else {
                return new Response('Invalid password', { status: 401 });
            }
        }

        if (isAuth && action === 'save') {
            const content = formData.get('content');
            const mode = formData.get('mode');

            if (env.KV) {
                const invalidLines = validateProxyList(content);
                if (invalidLines.length > 0) {
                    return new Response('节点格式错误:\n' + invalidLines.join('\n'), { status: 400 });
                }

                let finalContent = content;
                if (mode === 'append') {
                    const existing = await env.KV.get('ADD.txt') || '';
                    finalContent = existing + (existing && !existing.endsWith('\n') ? '\n' : '') + content;
                }
                await env.KV.put('ADD.txt', finalContent);
                return new Response('Saved successfully', { status: 200 });
            }
        }
    }

    if (!isAuth) {
        return new Response(renderLoginPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    const currentIps = env.KV ? await env.KV.get('ADD.txt') || '' : 'KV not bound';
    return new Response(renderAdminPage(currentIps), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function splitLines(str) {
    return str.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('//'));
}

/**
 * 校验节点清单格式
 * @returns {string[]} 返回错误行信息列表，若为空则校验通过
 */
function validateProxyList(content) {
    const lines = splitLines(content);
    const invalidLines = [];
    for (const line of lines) {
        // 允许链接格式 (vless://, trojan://, ss://, etc.)
        if (/^[a-z0-9-]+:\/\//i.test(line)) {
            continue;
        }

        // 处理 "地址:端口#备注" 格式
        const [addressPort] = line.split('#');
        if (!addressPort.includes(':')) {
            invalidLines.push(`"${line}" (缺少端口，需为 地址:端口 格式)`);
            continue;
        }

        const parts = addressPort.split(':');
        const portStr = parts[parts.length - 1].trim();
        const port = parseInt(portStr);

        if (isNaN(port) || port <= 0 || port > 65535) {
            invalidLines.push(`"${line}" (端口无效: ${portStr})`);
        }
    }
    return invalidLines;
}

function isValidBase64(str) {
    if (typeof str !== 'string') return false;
    const cleanStr = str.replace(/\s/g, '');
    if (cleanStr.length === 0 || cleanStr.length % 4 !== 0) return false;
    const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
    if (!base64Regex.test(cleanStr)) return false;
    try {
        atob(cleanStr);
        return true;
    } catch {
        return false;
    }
}

function base64Decode(str) {
    const bytes = new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

// --- UI Templates ---

function renderLoginPage() {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录 - edgetunnel 管理后台</title>
    <style>
        :root {
            --primary: #6366f1;
            --bg: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.7);
        }
        body {
            margin: 0;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            background: var(--bg);
            background-image: radial-gradient(circle at 50% -20%, #312e81, #0f172a);
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        .card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 2.5rem;
            border-radius: 1.5rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            width: 100%;
            max-width: 400px;
            animation: fadeIn 0.6s ease-out;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        h1 { margin-top: 0; font-size: 1.5rem; font-weight: 700; text-align: center; margin-bottom: 2rem; background: linear-gradient(to right, #818cf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        input {
            width: 100%;
            padding: 0.8rem 1rem;
            margin-bottom: 1.5rem;
            border-radius: 0.75rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(15, 23, 42, 0.6);
            color: white;
            box-sizing: border-box;
            transition: all 0.3s;
        }
        input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.2); }
        button {
            width: 100%;
            padding: 0.8rem;
            border-radius: 0.75rem;
            border: none;
            background: var(--primary);
            color: white;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        button:hover { background: #4f46e5; transform: translateY(-1px); }
        button:active { transform: translateY(0); }
    </style>
</head>
<body>
    <div class="card">
        <h1>管理后台登录</h1>
        <form method="POST" action="/admin">
            <input type="hidden" name="action" value="login">
            <input type="password" name="password" placeholder="请输入 ADMIN 密码" required autofocus>
            <button type="submit">立即登录</button>
        </form>
    </div>
</body>
</html>`;
}

function renderAdminPage(currentContent) {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理后台 - edgetunnel</title>
    <style>
        :root {
            --primary: #6366f1;
            --success: #22c55e;
            --bg: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.7);
        }
        body {
            margin: 0;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            background: var(--bg);
            background-image: radial-gradient(circle at 0% 0%, #1e1b4b, transparent), radial-gradient(circle at 100% 100%, #1e1b4b, transparent);
            min-height: 100vh;
            color: white;
            padding: 2rem;
            box-sizing: border-box;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
        }
        h1 { margin: 0; font-size: 1.5rem; font-weight: 700; background: linear-gradient(to right, #818cf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 2rem;
            border-radius: 1.5rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
        }
        .label-group {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .label { color: #94a3b8; font-size: 0.9rem; }
        .mode-selector {
            display: flex;
            background: rgba(15, 23, 42, 0.6);
            padding: 0.25rem;
            border-radius: 0.75rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .mode-option {
            padding: 0.4rem 1rem;
            border-radius: 0.5rem;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
            user-select: none;
        }
        .mode-option.active {
            background: var(--primary);
            color: white;
        }
        textarea {
            width: 100%;
            height: 400px;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 1rem;
            color: #e2e8f0;
            padding: 1rem;
            font-family: 'Fira Code', 'Monaco', monospace;
            font-size: 0.9rem;
            line-height: 1.5;
            resize: vertical;
            box-sizing: border-box;
            transition: all 0.3s;
        }
        textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.2); }
        .actions {
            margin-top: 1.5rem;
            display: flex;
            gap: 1rem;
            justify-content: flex-end;
            align-items: center;
        }
        .hint { color: #64748b; font-size: 0.8rem; flex-grow: 1; }
        .btn {
            padding: 0.7rem 1.5rem;
            border-radius: 0.75rem;
            border: none;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .btn-primary { background: var(--primary); color: white; }
        .btn-primary:hover { background: #4f46e5; box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.4); }
        .btn-outline { background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: #cbd5e1; }
        .btn-outline:hover { background: rgba(255, 255, 255, 0.05); }
        #toast {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            padding: 1rem 2rem;
            border-radius: 1rem;
            background: var(--success);
            color: white;
            font-weight: 600;
            box-shadow: 0 10px 15px -3px rgba(34, 197, 94, 0.4);
            transform: translateY(100px);
            transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            opacity: 0;
            z-index: 1000;
        }
        #toast.show { transform: translateY(0); opacity: 1; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>edgetunnel 优选 IP 管理</h1>
            <button class="btn btn-outline" onclick="location.href='/login'">退出</button>
        </header>
        <div class="card">
            <div class="label-group">
                <span class="label">自定义优选 IP 列表 (格式: 地址:端口#备注)</span>
                <div class="mode-selector" id="modeSelector">
                    <div class="mode-option active" data-mode="overwrite" onclick="setMode('overwrite')">覆盖模式</div>
                    <div class="mode-option" data-mode="append" onclick="setMode('append')">追加模式</div>
                </div>
            </div>
            <textarea id="content" placeholder="例如: 1.1.1.1:443#Cloudflare">${currentContent}</textarea>
            <div class="actions">
                <div class="hint" id="modeHint">当前模式：覆盖现有列表</div>
                <button class="btn btn-primary" id="saveBtn" onclick="save()">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
                    保存更改
                </button>
            </div>
        </div>
    </div>
    <div id="toast">保存成功！</div>

    <script>
        let currentMode = 'overwrite';
        const initialContent = document.getElementById('content').value;

        function setMode(mode) {
            currentMode = mode;
            document.querySelectorAll('.mode-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.mode === mode);
            });
            const hint = document.getElementById('modeHint');
            const textarea = document.getElementById('content');
            if (mode === 'append') {
                hint.innerText = '当前模式：将输入的内容追加到现有列表末尾';
                textarea.placeholder = '输入要追加的 IP 列表...';
                // 如果是追加模式且内容是当前获取的内容，清空它以便用户输入新的内容
                if (textarea.value.trim() === initialContent.trim()) {
                    textarea.value = '';
                }
            } else {
                hint.innerText = '当前模式：用输入的内容覆盖现有列表';
                textarea.placeholder = '例如: 1.1.1.1:443#Cloudflare';
                if (textarea.value.trim() === '') {
                    textarea.value = initialContent;
                }
            }
        }

        async function save() {
            const content = document.getElementById('content').value;
            const btn = document.getElementById('saveBtn');
            btn.disabled = true;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '正在保存...';

            try {
                const formData = new FormData();
                formData.append('action', 'save');
                formData.append('content', content);
                formData.append('mode', currentMode);

                const res = await fetch('/admin', {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) {
                    showToast(currentMode === 'append' ? '追加成功！' : '保存成功！');
                    if (currentMode === 'append') {
                        // 追加成功后建议刷新或切换回覆盖模式查看结果
                        setTimeout(() => location.reload(), 1500);
                    }
                } else {
                    const errorMsg = await res.text();
                    showToast(errorMsg, true);
                }
            } catch (e) {
                showToast('保存出错: ' + e.message, true);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }

        function showToast(msg, isError = false) {
            const toast = document.getElementById('toast');
            toast.innerText = msg;
            toast.style.background = isError ? '#ef4444' : 'var(--success)';
            toast.style.boxShadow = isError ? '0 10px 15px -3px rgba(239, 68, 68, 0.4)' : '0 10px 15px -3px rgba(34, 197, 94, 0.4)';
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 5000);
        }
    </script>
</body>
</html>`;
}
