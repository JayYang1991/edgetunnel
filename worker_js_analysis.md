# _worker.js 代码功能及动态配置分析

该脚本是一个典型的基于 Cloudflare Workers 部署的涵盖代理传输（VLESS/Trojan）、多端订阅分发及伪装站点的代理节点服务端代码。

以下是 `_worker.js` 中所有主要函数的详细功能说明及其支持的动态配置。

---

## 一、 函数功能说明

### 1. 主入口及核心请求处理
- **`fetch(request, env, ctx)`** (默认导出)
  - **功能**：主入口函数。拦截所有流量，检查是否为 WebSocket 升级请求。
    - 如果是普通的 HTTP 访问，进行管理面板界面 (`/login`, `/admin/`等) 和订阅页面 (`/sub`) 的路由解析及身份认证。
    - 如果是代理连接（即含有 Upgrade 头的请求），则将请求交给 `处理WS请求` 处理。
    - 不符合的 HTTP 请求均被反代至第三方站点或伪装成 `nginx`/`1101` 错误页面以躲避探测。
- **`处理WS请求(request, yourUUID)`**
  - **功能**：处理代理客户端发来的 WebSocket 连接。通过读取前置数据流（Early Data），分别通过 `解析木马请求` 或 `解析魏烈思请求` 来判定这是一个 Trojan 还是 VLESS 请求，并执行相应的流量代理逻辑。此外还会阻断测速站点的请求。

### 2. 协议解析相关
- **`解析木马请求(buffer, passwordPlainText)`**
  - **功能**：解析 Trojan(木马) 协议的请求数据流。校验 SHA224 密码、识别地址类型 (IPv4/IPv6/域名)、提炼目标主机与端口，并剥离实际的数据体。
- **`解析魏烈思请求(chunk, token)`**
  - **功能**：解析 VLESS(魏烈思) 协议的数据流。验证 UUID（匹配传入的 Token），解析指令(TCP/UDP)、分析请求的目标地址和端口及协议版本头。
- **`sha224(s)`**
  - **功能**：实现 SHA224 算法，专用于对 Trojan 代理连接传入的密码进行散列计算并校验真实性。

### 3. 流量转发与连接处理
- **`forwardataTCP(host, portNum, rawData, ws, respHeader, remoteConnWrapper, yourUUID)`**
  - **功能**：解析目标地址后，发起 TCP 连接进行数据转发。它具有强大的反代功能：可根据白名单或全局配置决定是否经过 SOCKS5/HTTP 链式代理转发目标数据，或采用普通的 `proxyip` 伪装IP池直连。并包括连接失败重试其它代理节点的“兜底”功能。
- **`forwardataudp(udpChunk, webSocket, respHeader)`**
  - **功能**：处理 UDP 请求流量。由于环境限制，这里的 UDP 目前固定实现为向 Google DNS (`8.8.4.4:53`) 发起查询代理（DNS 泄露防护的基础实现）。
- **`socks5Connect`** / **`httpConnect`**
  - **功能**：按照 SOCKS5 / HTTP 协议握手规范，利用 `cloudflare:sockets` (API 的 `connect`) 连接到第二层前置代理服务器，支持基础授权。
- **`connectStreams(remoteSocket, webSocket, headerData, retryFunc)`**
  - **功能**：桥连目标服务器 `remoteSocket` 的读取流和对客户端的 `webSocket` 发送流。将目标网站发回的数据推送给客户端。
- **`makeReadableStr(socket, earlyDataHeader)`**
  - **功能**：将 WebSocket 接收到的 message 转换为 ReadableStream，便于使用 pipeTo 进行数据流式处理。

### 4. 订阅分发与配置重写
- **`读取config_JSON(env, hostname, userID, 重置配置)`**
  - **功能**：从环境变量及 `KV` 中获取系统配置的综合初始化函数。它会补全配置缺失字段，包括 CF 配置用量检查、路径隐蔽方案（如路径动态伪装参数拼接）、自动生成基于用户身份的 ECH 或 TLS 分片参数链路 `LINK` 提供给下发端口。
- **`Clash订阅配置文件热补丁`** / **`Singbox订阅配置文件热补丁`** / **`Surge订阅配置文件热补丁`**
  - **功能**：利用正则表达式及 JSON/YAML 解析，对上述三种客户端的订阅配置或转换接口生成的外部配置进行“热补丁修改”。主要用于向模板中注入如 `ECH` 启停、指纹识别 `utls` 覆盖、动态规则组注入、跳过证书验证等高级参数。
- **`批量替换域名(内容, hosts, 每组数量)`**
  - **功能**：由于可以设置多个域名，它能将订阅节点文件中的默认域名占位均匀地替换成随机下发或轮询的不同代理备用域名来保证可用性。
- **`随机使用通配符(h)`** 和 **`随机路径(完整节点路径)`**
  - **功能**：当代理服务器域名中使用了泛域名时（如 `*.domain.com`），将其随机转换为真实子网域名；生成多段如 `/api/login/`、`/static/video/` 一样不易被审计拦截的常见随机路径组。
- **`获取优选订阅生成器数据`** / **`请求优选API`** / **`生成随机IP`**
  - **功能**：这三组函数共同实现了该项目的核心特色——“优选 IP 获取”。从外部托管 URL 爬取或利用 ASN 算出的 Cloudflare CIDR (如移动/联通/电信对应的 CF 网段) 随机抓取 IP 作为优选节点数据响应给订阅下载方。

### 5. 控制面板及功能辅助
- **`getCloudflareUsage(Email, GlobalAPIKey, AccountID, APIToken)`**
  - **功能**：利用 Cloudflare GraphQL API 结合你在面板中提供的账户令牌，动态查询当前的页面和Workers请求用量并展示在控制台中，以防用度超出。
- **`解析地址端口(proxyIP, 目标域名, UUID)`**
  - **功能**：解析形如 `ip:port` 的反代代理IP。更高级的是，如果识别到了 `*.william` 格式或仅给域名，将主动利用 `DoH查询` 获取其 `TXT`, `A` 或 `AAAA` DNS 记录得到最终使用的代理 IP。包含解析后的缓存与随机种子洗牌（打乱顺序）。
- **`反代参数获取(request)`**
  - **功能**：从每次访问的 URL 路径和 Query Search（`?proxyip=` 等）中提炼动态参数（如提取该次请求要求走 SOCKS5 或其它上游代理）。
- **`DoH查询`** / **`getECH(host)`**
  - **功能**：DNS over HTTPS 客户端的纯 JS 实现，向指定的 DNS(如 Google、Cloudflare) 获取特定域名的 `A`/`AAAA`/`TXT` 或者 `HTTPS` 记录（用于生成 Encrypted Client Hello 以突破 SNI 封锁认证）。
- **`请求日志记录`** / **`sendMessage`**
  - **功能**：根据访问请求的 `IP`, `ASN`, 请求时间判断并过滤后写入 KV 并在设置生效时通过 `TgBot API` 推送警告。
- **`SOCKS5可用性验证`**
  - **功能**：通过面板接口对填写的 SOCKS5 进行模拟发包探活（访问一个固定服务器测试通断及延迟），辅助用户排错。
- **`nginx()`** / **`html1101(host, 访问IP)`**
  - **功能**：纯渲染用，输出伪装错误站点以打消主动探测疑虑。

---

## 二、 支持的动态配置

本 Worker 脚本的实现非常注重可动态化，配置源主要由三部分组成：

### 1. 环境变量配置 (`env` API 传入)
支持在 Cloudflare 后台或 `.dev.vars` 直接调控的基础行为：
*   **认证权限标识**：
    *   `UUID` / `uuid`：VLESS/Trojan的代理凭证和UUID。
    *   `ADMIN` / `PASSWORD` / `KEY`：管理面板免密登入验证密钥。默认密钥提醒修改。
*   **网络和反代**：
    *   `HOST`：支持配置包含多个反向主机名的字符串，利用逗号分割，下发给不同节点的客户端。
    *   `PROXYIP`：支持填入指定的边缘路由 IP、白名单 SOCKS5 或者使用 `xxx.william` 走 TXT 记录代理，用避免出口被阻断。
    *   `GO2SOCKS5`：可设定强制使用 SOCKS5 出站的域名匹配白名单（数组）。
*   **应用层行为**：
    *   `KV`：需绑定 KV 命名空间。以用来持续存储从控制面板提交的下述动态配置。
    *   `URL`：设置伪装网站。填入如 `nginx` 或 `1101` 使用内置硬编码，填其它链接就会自动将其反代为当前网站掩人耳目。
    *   `PATH`：自定义 VLESS 连接的主路径（如不指定则为 `/`）。
    *   `BEST_SUB` / `OFF_LOG`：提供“仅作为订阅发生器使用”和“全局关闭 KV 日志读写降低成本”的开关。

### 2. KV 持久化储存配置 (`config.json`/`tg.json`/`cf.json`)
由云端面板或系统自我修正自动修改的持久化文件，影响生成配置的呈现：
*   `协议类型` (默认为 vless)，及 `传输协议` (默认 ws)。
*   `跳过证书验证`、`启用0RTT`、`随机路径`。
*   `ECH` 开启设定与相关的 DNS 测向参数 (`ECHConfig.SNI`)。
*   `优选订阅生成`：支持选定使用本地 IP 预热库 (`ADD.txt`)、支持设定下发指纹校验随机数大小、支持外部测速平台提取，甚至配置第三方订阅转换平台 `SUBAPI` 接口和 Emoji 是否开启等。
*   **反向代理矩阵控制**：`config_JSON.反代.SOCKS5` 结构，控制 SOCKS 全局生效能力、填入节点账号密码、更新特定 SOCKS 白名单。
*   **TG 与 CF 控制面板配置**：用来热插拔修改推送所用机器人 Token 及 Cloudflare 计费面板数据的 ApiKey 信息。

### 3. 动态 URL Request 请求控制
在单个访问建立时可实现实时局部复写配置：
*   `?proxyip=` 或路径形式 `/proxyip=xxxx`：可以让指定这条连接通过其设定的外挂 IP 服务器代理跳出。
*   `?socks5=` 或 `?http=` / `/socks5://` / `/ghttp=xxxx`：支持在连接上以 Query 查询甚至拼接进直链路径的方式，热复写强制某次特定的数据流经过指定的上游节点以构建代理链。这属于请求级的动态重写生命周期。
