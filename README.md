<div align="center">

# 🎨 Open Image Playground

本项目 fork 自 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)，原作者为 CookSleep，遵循 MIT 许可并保留原始版权声明。
当前维护仓库：[liubaicai/open_image_playground](https://github.com/liubaicai/open_image_playground)。

[![GitHub Repo stars](https://img.shields.io/github/stars/liubaicai/open_image_playground?style=flat-square&color=eab308)](https://github.com/liubaicai/open_image_playground/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/liubaicai/open_image_playground?style=flat-square&color=3b82f6)](https://github.com/liubaicai/open_image_playground/network/members)
[![License](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)](https://github.com/liubaicai/open_image_playground/blob/main/LICENSE)
[![React](https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**支持 OpenAI 兼容接口与 OpenRouter 的图片生成、编辑和提示词优化工具**

以画廊为唯一主界面，支持参考图、画板标注、遮罩编辑、模型管理、费用估算和本地历史记录。<br>
同时保留 sub2api、fal.ai 及自定义 HTTP 供应商适配。

[项目仓库](https://github.com/liubaicai/open_image_playground) · [版本发布](https://github.com/liubaicai/open_image_playground/releases) · [更新记录](RELEASE.md) · [问题反馈](https://github.com/liubaicai/open_image_playground/issues)

</div>

## 🚀 快速开始

```bash
git clone https://github.com/liubaicai/open_image_playground.git
cd open_image_playground
npm ci
npm run dev
```

打开终端显示的本地地址，在 **设置 → API 配置** 中添加服务地址、API Key 和模型。需要自部署时见下方[部署与使用](#deploy-and-usage)。客户端安装包与容器镜像以本仓库实际发布内容为准，也可按下文自行构建。

## ✨ 核心特性

### 🎨 强大的图像生成与编辑
- **参考图与遮罩**：应用最多接收 16 张参考图（支持剪贴板和拖拽），实际可发送数量取决于所选服务商和模型，内置遮罩编辑器，自动预处理以符合官方分辨率限制。
- **画板标注**：在空白画布或参考图上用画笔、文字、图形和像素橡皮擦标注修改意图，完成后作为参考图；画板与遮罩编辑器可缩放平移（Alt / Ctrl + 滚轮、Alt + 拖动、双指捏合）。
- **评论标注**：在画板中用评论工具点击图片添加评论，以“@图N 评论”插入提示词，发送时附上评论在图中的位置（如 `(X=52%, Y=41%)`），复用任务时可恢复。
- **批量与迭代**：支持单次多图生成；一键将满意结果转为参考图，无缝开启下一轮修改。
- **多提示词批量提交**：在习惯配置中开启后，可一次粘贴多条提示词（以两个空行分隔），共用参考图和参数；支持排队或并发（默认上限 10），可随时查看进度或停止。
- **流式生成预览**：OpenAI 兼容的 `Images API` 与 `Responses API` 可按接口能力接收中间步骤图；不是所有供应商和模型都支持流式预览。
- **透明背景**：画廊模式下选择 PNG 或 WebP 后可开启，可在 API 配置页为每个配置分别选择 API 原生或本地后处理。

  > - **API 原生**：直接请求模型返回透明通道，需接口和模型支持。接口返回“不支持透明背景”类错误时，应用会提示切换为本地后处理。
  > - **本地后处理**：要求模型使用纯绿或纯洋红背景，结果返回后在浏览器中去除背景色，按所选格式保存。适合图标、贴纸、单主体素材；主体有复杂发丝、半透明材质、强反光或颜色接近背景色时，边缘可能残留或误抠。

### 🧩 模型选择与费用估算
- **统一模型列表**：在 API 配置中分别选择 OpenAI / OpenRouter 的启用模型；画廊下拉列表按供应商分组，选择模型时同时切换对应配置，不需另选配置。多个配置中的同名模型会附带配置名称。
- **OpenRouter 图像模型目录**：读取完整模型目录，筛选输出模态包含 `image` 的模型，再与专用图像 API 的可用目录交叉核对。仅支持图片输入的视觉模型不会因此被当作生图模型。
- **独立适配器**：OpenRouter 通过官方 `/api/v1/images` 请求，模型的分辨率、数量和参考图支持以目录能力为准；主服务保留原有 OpenAI 兼容请求路径。
- **OpenRouter 近似 USD 费用**：尺寸和数量后显示估算，明细列出价格来源和假设。优先采用图像端点的明确计费单位，必要时回退到目录的明确展示单价；不把未标单位的原始 `image_output` 直接解释为每张价格。
- **按 token 计费**：有明确适用的官方图像 token 表时使用该基准，否则按尺寸、画质、提示词、参考图和张数给出启发式预算与区间。未知价格不按免费处理，自动尺寸也只是估算假设；服务商实际账单为准。

### ✨ 提示词优化
- 在 **设置 → 提示词优化** 中独立选择 OpenAI / 兼容服务或 OpenRouter 的文本生成模型，再开启开关，默认关闭。它不改变当前生图模型。
- OpenAI 兼容渠道按应用规则允许 GPT 文本系列直接选择，排除 `gpt-image` 和已知非聊天专用模型；其他无文本能力元数据的模型仍需手动确认。OpenRouter 根据文本输入、文本输出元数据筛选。
- 输入后点击**清空文本左侧的优化按钮**，才会发送当前文本和优化指令；不会自动优化，也不会上传参考图、附件或历史对话。
- 按 **主体对象 → 动作/状态 → 环境/场景 → 构图/视角 → 光影/色彩 → 艺术风格/媒介 → 画质/参数** 七部分细化，允许符合原意的细节扩写，保留语言、身份、数量、指定文字、否定限制和参考图引用。
- 输出可直接继续编辑或撤销。优化不会强制套用写实风格，也不添加不适用于当前接口的 Midjourney 参数；现有图片设置保持不变。
- 支持取消；输入变化、切换配置或关闭功能后，迟到结果不会覆盖新文本。失败保留原文，不自动付费重试；每次优化可能产生额外文本模型费用。

### 🖼️ 仅画廊模式
- 当前界面不提供 Agent 模式或图片评价功能。
- 旧 Agent 对话、草稿和图片继续保留为兼容归档，不自动恢复请求；旧的运行中任务会标记为已归档，不持续显示恢复状态。

### ⚙️ 精细化参数追踪
- **智能尺寸控制**：提供 1K/2K/4K 预设，自定义宽高时自动规整到模型安全范围（16 的倍数、总像素校验等）。
- **实际参数对比**：提取 API 响应中实际生效的尺寸、质量、耗时和**模型改写后的提示词**，与请求参数高亮对比。

### 📁 本地历史管理
- **瀑布流与画廊**：历史任务自动保存，支持按状态过滤、全屏大图预览与快捷下载。
- **多收藏夹管理**：同一任务可归入多个收藏夹；概览页显示封面和任务数，进入后可叠加搜索与状态筛选；支持拖拽排序、重命名、设为默认和按收藏夹打包下载 ZIP。
- **失败任务重试**：重试方式可选新建任务或覆盖原任务（不限失败任务）；覆盖时保留创建时间和收藏，耗时重新计算。
- **快捷批量操作**：桌面端支持拖拽框选、Ctrl/⌘ 连选，移动端支持侧滑多选，便于批量收藏与清理。
- **图片查看与下载**：大图预览支持左右滑动切换，移动端可长按弹出操作菜单，支持快捷下载与批量下载。
- **性能与隐私**：记录和图片保存在本地（网页版为 IndexedDB，客户端为本机数据目录），支持去重与 ZIP 备份。生成时提示词和必要参考图仍会发送到所选模型服务，使用代理时也会经过该代理。

### 🔌 多配置与供应商增强
- **多配置管理**：保存多个 API 配置（供应商、API Key、模型等）并快速切换；可一键复制当前配置到列表底部，配置和供应商列表均可拖拽排序。
- **多模型切换**：模型 ID 可用逗号分隔填写多个（如 `gpt-image-2.5-sunburst, gpt-image-2`），在首页切换，按配置分别记住；预置配置、URL 传参与导入导出均支持此写法。
- **多供应商接入**：内置 OpenAI 兼容接口（`Images API` / `Responses API`）、OpenRouter 图像 API、sub2api（异步）、fal.ai（队列），并可通过 JSON 导入自定义 HTTP 供应商（同步/异步任务）。
- **API 代理**：OpenAI 兼容接口与 fal.ai 均可配置自定义代理；OpenAI 兼容接口还可走同源 `/api-proxy/`，由 Docker 或本地开发服务器转发，绕开浏览器 CORS 限制。
- **Codex CLI 兼容模式**：上游为 Codex CLI 时，按其实际支持的参数发送请求，并把多图生成拆成并发单图。
- **提示词防改写**：Responses API 始终在请求前加入防改写指令；开启 Codex CLI 模式后，Images API 也会加入。
- **智能诊断提示**：检测到接口异常改写或缺少常规参数时，提示开启相应的兼容模式。
- **习惯配置**：提交后清空输入、重启后保留输入、临时复用历史任务的 API 配置、重试方式、关闭提示词防改写、界面字体、系统通知、自动检查更新等。
- **版本更新**：检查本仓库 Releases，未发布版本时显示暂无版本；客户端自动更新还需要实际发布的更新文件和匹配签名。

---

<a id="deploy-and-usage"></a>
## 🚀 部署与使用

Windows 用户可自行构建桌面客户端，或使用本仓库实际发布的安装包；网页版可以部署到 Vercel、GitHub Pages、Cloudflare Workers、Docker 或任意静态文件服务器。

部署时可以通过环境变量 `VITE_DEFAULT_API_URL` 提供**预置配置**：部署端预先加入用户配置列表的 API 配置，格式与用户自建的配置相同，用户打开页面通常只需补充 API Key。

完整写法见 [预置配置](#preset-config)，其余变量见 [环境变量](#env-vars)。

仓库中的 GitHub Actions 工作流分别负责客户端、Vercel、GitHub Pages 和 Docker 镜像，不需要的可在 **Actions** 中选中对应工作流后停用（**Disable workflow**）。

<a id="desktop-client"></a>
<details>
<summary><strong>🖥️ 方式一：Windows 桌面客户端</strong></summary>

客户端的数据保存在本机，不受浏览器存储配额影响；网络请求由原生侧处理，仍需满足目标服务的权限与网络要求。

**安装**

- 若本仓库已发布客户端版本，可在 [Releases](https://github.com/liubaicai/open_image_playground/releases/latest) 中下载以 `_x64-setup.exe` 结尾的安装包。
- 安装前确认发布来源和签名；不要忽略无法验证的系统安全警告。
- 安装到普通文件夹（如 `D:\Apps\Open Image Playground`）。装到 `C:\Program Files` 等需要管理员权限写入的位置会导致无法保存数据。
- 数据默认保存在 `<安装目录>\data` 中，可在“设置 → 数据管理”中更改。

**自行构建**

需要 Rust 和 Tauri 的 Windows 构建环境，见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

- 客户端构建读取 [`src-tauri/.env`](src-tauri/.env)，不读取根目录的 `.env`；可在 `src-tauri/.env.local` 中覆盖。
- 客户端专用变量 `VITE_WEB_APP_URL`：复制导入链接时使用的网页版地址，未设置时改用 `gpt-image-playground://` 链接。
- `tauri:build` 需设置 `TAURI_SIGNING_PRIVATE_KEY`（私钥内容或路径）和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，用于给更新包签名。
- 自行分发时，用 `npx tauri signer generate` 生成自己的密钥，并替换 `src-tauri/tauri.conf.json` 中的 `plugins.updater.pubkey` 和更新地址。
- 推送 `v*` tag 时，若仓库 Secrets 配置了 `TAURI_SIGNING_PRIVATE_KEY`（及其密码），会先构建客户端并上传到 Release，成功后再部署网页版和 Docker 镜像；未配置则跳过客户端，直接部署。

</details>

<details>
<summary><strong>▲ 方式二：Vercel 一键部署（网页版推荐）</strong></summary>

**初始部署**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fliubaicai%2Fopen_image_playground&project-name=open-image-playground&repository-name=open-image-playground)

点击按钮导入仓库，Vercel 会自动构建并部署。

**环境变量（可选）**

在 Vercel 项目的 **Settings → Environment Variables** 中添加，添加或修改后需要重新部署：

```dotenv
VITE_DEFAULT_API_URL=https://api.openai.com/v1
```

**绑定自定义域名（国内直连）**

Vercel 分配的 `.vercel.app` 域名在国内通常无法直接访问，可在 **Settings → Domains** 中绑定自己的域名。

**更新方式**

`vercel.json` 关闭了默认的自动部署。Fork 本仓库后，建议配置 Deploy Hook：

1. 在 Vercel 项目的 **Settings → Git → Deploy Hooks** 中创建名为 `Release` 的 Hook（Branch 填 `main`），复制生成的 URL。
2. 在 Fork 仓库的 **Settings → Secrets and variables → Actions** 中新建 Secret `VERCEL_DEPLOY_HOOK`，填入该 URL。

配置完成后：

- **自动更新**：本仓库发布正式版本（版本号变动）后，在 Fork 页面点击 **Sync fork** 会触发 Vercel 部署；普通提交不会触发。
- **手动触发**：在 **Actions** 中选择 **Deploy to Vercel**，对 `main` 分支执行 **Run workflow**，可立即部署最新代码（包括未发布的提交）。

</details>

<details>
<summary><strong>🌐 方式三：GitHub Pages 部署</strong></summary>

通过 GitHub Actions 工作流构建并发布到 GitHub Pages。

**环境变量（可选）**

在仓库 **Settings → Secrets and variables → Actions** 中，将 `VITE_DEFAULT_API_URL` 添加到 **Secrets**：

```dotenv
VITE_DEFAULT_API_URL=https://api.openai.com/v1
```

其他变量添加到 **Variables**，变量名与 [环境变量](#env-vars) 表一致。

**初始部署**

1. 在仓库 **Settings → Pages** 中，将 **Build and deployment → Source** 设为 **GitHub Actions**。
2. 在 **Actions** 中选择 **Deploy to GitHub Pages**，对 `main` 分支执行 **Run workflow**，完成首次部署。

**更新方式**

- **自动更新**：本仓库发布正式版本（版本号变动）后，在 Fork 页面点击 **Sync fork** 会自动构建并部署；普通提交不会触发。
- **手动触发**：同样执行 **Deploy to GitHub Pages** 工作流，可立即部署最新代码（包括未发布的提交）。

</details>

<details>
<summary><strong>☁️ 方式四：Cloudflare Workers 部署</strong></summary>

通过内置的 Wrangler 配置，将构建产物作为静态资源部署到 Cloudflare Workers。

**环境变量（可选）**

Cloudflare Workers 不会在部署后改写静态文件，变量必须在构建前设置（如写入项目根目录的 `.env.local`）：

```dotenv
VITE_DEFAULT_API_URL=https://api.openai.com/v1
```

**部署**

```bash
npx wrangler login
npm run deploy:cf
```

`deploy:cf` 会先执行 `npm run build`，再通过 `wrangler deploy` 上传 `dist/` 目录。

</details>

<a id="docker-deployment"></a>
<details>
<summary><strong>🐳 方式五：Docker 部署</strong></summary>

从本仓库构建本地镜像，不依赖上游镜像，也不假定 fork 已发布 GHCR 包：

```bash
docker build -f deploy/Dockerfile -t open-image-playground:local .
```

**Docker Compose（推荐：服务端持久化）**

Docker Web 版把配置、API Key、任务历史和生成图片保存在宿主机 `./data` 目录；同一个实例的不同浏览器共享这些数据。Windows/Tauri 客户端仍独立使用本地数据目录。

```bash
# 在仓库根目录配置一个至少 12 位的访问密码
printf 'STORAGE_PASSWORD=请替换成足够长的随机密码\\n' > .env
docker compose up -d --build
```

使用仓库附带的 [compose.yml](compose.yml)，默认端口为 `28080`，用户名 `admin`（可通过 `STORAGE_USERNAME` 设置）。浏览器首次使用共享存储接口时会要求 HTTP Basic 认证。建议只在可信网络或 HTTPS + 访问控制后使用，**不要直接在公网明文 HTTP 暴露**，因为保存的 API Key 对同一实例的已认证访问者可见。

**Docker CLI**

```bash
docker build -f deploy/Dockerfile -t open-image-playground:local .
docker run -d -p 8080:80 \\
  -e STORAGE_PASSWORD='请替换成足够长的随机密码' \\
  -v "$(pwd)/data:/data" \\
  open-image-playground:local
```

容器中必须设置 `STORAGE_PASSWORD`，否则数据服务将拒绝启动。若以前使用的是浏览器存储版本，**请先在旧网页使用「设置 → 数据管理」导出完整 ZIP**，升级部署后在新版网页导入；服务端不会自动读取浏览器中旧的 IndexedDB。升级、删除、重建容器时保留 `./data` 即可保留服务端数据；为防误操作，仍建议定期离线备份 `./data`。多浏览器的任务与配置变化每约 8 秒刷新一次。

**挂载配置文件**

`DEFAULT_API_URL` 指向容器内路径时，宿主机上的 JSON 配置文件需通过 volume 挂载：

```bash
docker run -d -p 8080:80 \
  -v ./gpt-image-config.json:/config/gpt-image-config.json:ro \
  -e DEFAULT_API_URL=/config/gpt-image-config.json \
  open-image-playground:local
```

**Docker 专属变量**

| 变量 | 说明 |
|------|------|
| `ENABLE_API_PROXY=true` | 开启 Nginx 同源代理，请求发往 `/api-proxy/{路径}` 再转发到 `API_PROXY_URL` |
| `API_PROXY_URL` | 代理转发的完整 API 基础地址（不自动补 `/v1`） |
| `LOCK_API_PROXY=true` | 强制开启代理，用户无法关闭；需同时设置 `ENABLE_API_PROXY=true` |
| `HOST` / `PORT` | Nginx 监听地址和端口，默认 `0.0.0.0:80` |

> 开启 API 代理后，任何人都能将你的服务器作为代理来请求目标 API。建议仅在有访问控制（如 IP 白名单）或本地网络中开启。

> 旧版 `API_URL` 已拆分为 `DEFAULT_API_URL` 和 `API_PROXY_URL`，容器启动时自动兼容，无需立即修改。

**隐藏真实 API 地址**

同时开启 `ENABLE_API_PROXY` 和 `LOCK_API_PROXY`，真实地址只写在 `API_PROXY_URL` 中：

- OpenAI 兼容接口：`DEFAULT_API_URL` 留空或填占位地址（如 `https://proxy`）。
- 自定义供应商：预置 JSON 中的 `baseUrl` 留空并设置 `apiProxy: true`（仅支持同步配置）。

```bash
docker run -d -p 8080:80 \
  -e DEFAULT_API_URL= \
  -e API_PROXY_URL=https://real-api.example.com/v1 \
  -e ENABLE_API_PROXY=true \
  -e LOCK_API_PROXY=true \
  open-image-playground:local
```

**更新方式**

拉取所需源码版本后重新执行上述 `docker build`，再重建容器。若自行发布镜像，请使用实际存在的镜像仓库和标签。

</details>

<details>
<summary><strong>💻 方式六：本地开发与静态构建</strong></summary>

**1. 环境变量（可选）**

在项目根目录新建 `.env.local`：

```dotenv
VITE_DEFAULT_API_URL=https://api.openai.com/v1
```

**2. 安装依赖并启动**

```bash
npm ci
npm run dev
```

**3. 本地开发跨域代理（可选）**

本地开发遇到浏览器 CORS 限制时，可开启开发服务器代理：

```bash
cp dev-proxy.config.example.json dev-proxy.config.json
```

- 将 `dev-proxy.config.json` 中的 `target` 设为完整的 API 基础地址。代理不会自动补 `/v1`，OpenAI 兼容接口通常要写到版本前缀，如 `https://api.example.com/v1`。
- 重启开发服务器，在设置中开启 **API 代理**，请求会按 `http://localhost:5173/api-proxy/... -> target/...` 转发。
- 仅在 `npm run dev` 时生效，不影响构建产物。

**4. 本地故障模拟 API（可选）**

复现图片 URL 跨域、接口返回结构异常、原始响应查看等问题时，可启动内置模拟服务：

```powershell
npm run mock:api
```

用法见 [本地故障模拟 API](docs/mock-image-api.md)。

**5. 构建静态产物**

```bash
npm run build
```

产物位于 `dist/`，可部署到任意静态文件服务器（如 Nginx、Netlify）。`npm run build` 会先执行 TypeScript 检查。

```bash
npm test                 # Vitest 完整测试
npm run test:watch       # 开发时监听测试
npm run preview          # 本地预览构建产物
```

需要从仓库打包字体时，可先设置 `VITE_BUILTIN_FONT_SOURCE=local`；例如在 Bash 中运行 `VITE_BUILTIN_FONT_SOURCE=local npm run build`。

</details>

---

<a id="env-vars"></a>
## ⚙️ 环境变量

以下变量适用于所有部署方式。使用时注意：

- 构建时变量需在构建前设置。
- Docker 使用去掉 `VITE_` 前缀的同名变量，在容器启动时读取。
- Docker 和客户端的专用变量见各自的部署方式。

| 构建时变量 | Docker 变量 | 说明 |
|------|------|------|
| `VITE_DEFAULT_API_URL` | `DEFAULT_API_URL` | 预置配置，见下文 |
| `VITE_LOCK_PRESET_CONFIG_PARAMS=true` | `LOCK_PRESET_CONFIG_PARAMS=true` | 锁定预置配置中除 API Key 外的参数，禁止编辑随预置引入的自定义供应商；当前锁定配置引用的供应商解除引用后才能删除 |
| `VITE_PREVENT_PRESET_CONFIG_DELETION=true` | `PREVENT_PRESET_CONFIG_DELETION=true` | 禁止删除预置配置及随预置引入的自定义供应商，不锁定参数，普通配置不受影响 |
| `VITE_SHOW_PRESET_CONFIG_ONLY=true` | `SHOW_PRESET_CONFIG_ONLY=true` | 只允许使用当前预置配置，禁止创建、复制、删除、拖动配置，禁止切换供应商和管理自定义供应商；未开启锁定时参数仍可编辑，API Key 始终可编辑 |
| `VITE_DEFAULT_UI_FONT` | `DEFAULT_UI_FONT` | 默认界面字体：`builtin`（内置，默认）、`system`（系统字体）或本机已安装的字体名称 |
| `VITE_DEFAULT_MONO_FONT` | `DEFAULT_MONO_FONT` | 默认代码字体，取值规则同 `VITE_DEFAULT_UI_FONT` |
| `VITE_BUILTIN_FONT_SOURCE` | `BUILTIN_FONT_SOURCE` | 内置字体来源：`cdn`（默认，公共 CDN）或 `local`（[`fonts/`](fonts) 目录中的文件） |

> 旧变量 `VITE_SHOW_DEFAULT_CONFIG_ONLY`／`SHOW_DEFAULT_CONFIG_ONLY` 仍可使用，等同于对应的 `SHOW_PRESET_CONFIG_ONLY`。

---

<a id="preset-config"></a>
## 📋 预置配置

`VITE_DEFAULT_API_URL` 支持三种写法。

**1. API 地址**

```dotenv
VITE_DEFAULT_API_URL=https://api.openai.com/v1
```

适合只提供一个配置的部署：

- 自动创建 ID 为 `default-openai` 的 OpenAI 兼容预置配置，模型、超时等使用应用默认值。
- 地址末尾带 `/` 时直接拼接接口，不补 `/v1`。
- 之后改用 JSON 或导入链接时，把 `id` 设为 `default-openai` 即可继续更新这个配置。

**2. API 地址 + 查询参数**

```dotenv
VITE_DEFAULT_API_URL=https://api.openai.com/v1?model=gpt-image-2.5-sunburst&apiMode=images
```

在地址后追加参数，预填 Key、模型等字段。可用参数与下文 [URL 传参快速填充](#url-quick-fill) 相同（`profileId` 除外）。

**3. 完整 JSON**

需要预置多个配置或自定义供应商时，按下文 JSON 格式编写，再用以下任一方式提供：

- **仓库内或本地文件（推荐）**：填写相对项目根目录的路径，如 `./gpt-image-config.example.json`。Docker 中填写容器内路径，宿主机文件需挂载到容器内。
- **远程文件**：填写以 `.json` 结尾的 HTTP／HTTPS 地址，只需部署服务器能访问（可位于内网），用户浏览器不必能访问。
- **导入链接**：在自己部署的实例中配置好后，复制配置的导入链接（含 `?settings=` 参数，不勾选“New API 变量配置”）。链接只包含当前选中的配置及其关联的自定义供应商。

```dotenv
VITE_DEFAULT_API_URL=./gpt-image-config.example.json
VITE_DEFAULT_API_URL=https://example.com/gpt-image-config.json
VITE_DEFAULT_API_URL=https://你的域名?settings=%7B%22profiles%22%3A%5B...%5D%7D
```

文件路径和远程地址会在构建、开发服务器启动或容器启动时读取，并内嵌到页面中。

**重新部署时**

- **参数更新**：API 地址、模型、超时等与上次部署快照比较。部署值变化时覆盖一次本地值，之后保留用户修改，直到部署值再次变化。
- **API Key**：始终由用户在本地管理，重新部署不覆盖。
- **排序与删除**：预置配置可拖动；预置配置和预置供应商均可删除，删除后重新部署不会恢复。需要锁定参数或禁止删除时，使用上文的限制变量。
- **下线预置清理**：部署端移除某个预置后，若用户未修改过且无历史任务引用，自动从本地删除；否则转为普通配置保留。
- **失效供应商清理**：随预置引入的自定义供应商不再被任何配置使用、且从未被用户修改时，自动清理。

<a id="preset-config-json"></a>
### JSON 格式

顶层字段：

- **`profiles`**（数组）：预置的 API 配置列表，每项对应用户配置列表中的一个配置。
- **`customProviders`**（可选数组）：自定义供应商定义，见下文 [自定义供应商](#custom-provider-config)。只使用内置供应商（OpenAI 兼容、sub2api（异步）、fal.ai）时可省略。

`profiles` 中每项的字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 定向更新时填写 | 配置标识，见表下说明。 |
| `name` | 是 | 配置名称。 |
| `description` | 否 | 配置说明，支持 Markdown，显示在“当前配置”下方的说明卡片中。 |
| `provider` | 是 | `"openai"`（OpenAI 兼容）、`"sb2api-async"`（sub2api 异步）、`"fal"`（fal.ai），或 `customProviders` 中的供应商 ID。 |
| `baseUrl` | 是 | API 基础地址，末尾 `/` 的规则见表下说明；fal.ai 可留空。 |
| `apiKey` | 否 | API Key。建议省略，由用户自行填写。 |
| `model` | 是 | 模型 ID。多个模型以逗号分隔，默认使用第一个，用户可在首页切换。 |
| `imageGenerationModel` | 否 | Responses API 的 `image_generation` 工具模型，默认 `gpt-image-2.5-sunburst`，也可用 `gpt-image-2.5-flare`；留空时不发送，使用 API 默认值。 |
| `apiMode` | 否 | `"images"` 或 `"responses"`，默认 `"images"`。 |
| `isDefault` | 否 | 有多个配置时为默认项设置 `true`（只能有一个），首次使用时自动选中；只有一个配置时不填。 |
| `timeout` | 否 | 请求超时秒数，默认 600。 |
| `apiProxy` | 否 | 是否走部署端 API 代理，默认 `false`。 |
| `transparentBackgroundMethod` | 否 | 透明背景实现方式：`"api"`（API 原生）或 `"local"`（本地后处理），默认值见表下说明。 |

补充说明：

- **`id`**：之后的链接（查询参数 `profileId`、`settings` 链接）或预置 JSON 携带相同 ID 时，直接更新该配置而非新建。应用内普通分享链接会省略此字段。
- **`baseUrl`**：未以 `/` 结尾时按 OpenAI 规则补齐 `/v1`；以 `/` 结尾时直接基于该地址请求。
- **`transparentBackgroundMethod` 默认值**：OpenAI 兼容和 fal.ai 为 `"api"`；自定义供应商的生成和编辑请求都映射了 `$params.background` 时为 `"api"`，否则为 `"local"`。

### 示例：仅 OpenAI 兼容

```json
{
  "profiles": [
    {
      "id": "my-openai",
      "name": "我的 OpenAI 配置",
      "description": "使用前请阅读 [接口说明](https://example.com/docs)。",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-image-2.5-sunburst"
    }
  ]
}
```

### 示例：OpenAI 兼容 + sub2api + fal.ai 多配置

```json
{
  "profiles": [
    {
      "id": "openai-main",
      "name": "OpenAI",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-image-2.5-sunburst",
      "isDefault": true
    },
    {
      "id": "sub2api-profile",
      "name": "sub2api 异步",
      "provider": "sb2api-async",
      "baseUrl": "https://api.example.com/v1",
      "model": "gpt-image-2.5-sunburst"
    },
    {
      "id": "fal-profile",
      "name": "fal.ai",
      "provider": "fal",
      "baseUrl": "",
      "model": "openai/gpt-image-2"
    }
  ]
}
```

## 🔌 自定义供应商

API 不是标准 OpenAI 格式时，在预置 JSON 的 `customProviders` 中定义请求和响应结构。每个供应商需有唯一的 `id`，由 `profiles` 中的 `provider` 字段引用。

接口不在 `/v1` 路径下时，将 `baseUrl` 设为以 `/` 结尾。例如 `baseUrl` 为 `https://api.example.com/`、`submit.path` 为 `api/image-tasks` 时，实际请求地址为 `https://api.example.com/api/image-tasks`。

**获取供应商定义**

- **AI 生成**：在自己部署实例的 **设置 → API 配置 → 供应商类型 → 创建自定义供应商 → AI 一键生成与导入** 中粘贴第三方 API 文档生成配置，再复制该配置的导入链接作为预置值。
- **手动生成**：将 [自定义供应商 LLM 提示词](docs/custom-provider-llm-prompt.md) 和第三方 API 文档发给任意 LLM，获取完整 JSON。

**完整 JSON 示例（异步任务供应商）**

```json
{
  "customProviders": [
    {
      "id": "custom-example-task",
      "name": "示例异步任务供应商",
      "submit": {
        "path": "images/generations",
        "method": "POST",
        "contentType": "json",
        "body": {
          "model": "$profile.model",
          "prompt": "$prompt",
          "size": "$params.size",
          "quality": "$params.quality",
          "output_format": "$params.output_format",
          "output_compression": "$params.output_compression",
          "n": "$params.n",
          "image_urls": "$inputImages.dataUrls"
        },
        "taskIdPath": "data.0.task_id"
      },
      "poll": {
        "path": "tasks/{task_id}",
        "method": "GET",
        "intervalSeconds": 5,
        "statusPath": "data.status",
        "successValues": ["completed"],
        "failureValues": ["failed", "cancelled"],
        "errorPath": "data.error.message",
        "result": {
          "imageUrlPaths": ["data.result.images.*.url.*"],
          "b64JsonPaths": []
        }
      }
    }
  ],
  "profiles": [
    {
      "id": "example-profile",
      "name": "示例异步任务供应商",
      "provider": "custom-example-task",
      "baseUrl": "https://api.example.com/v1",
      "model": "gpt-image-2.5-sunburst",
      "apiMode": "images"
    }
  ]
}
```

---

<a id="url-quick-fill"></a>
## 🛠️ URL 传参快速填充

通过 URL 查询参数快速填入 OpenAI 兼容配置，适合创建书签或集成分享。

| 参数 | 说明 | 示例 |
|------|------|------|
| `apiUrl` | API Base URL | `?apiUrl=https://api.example.com/v1` |
| `apiKey` | API Key | `?apiKey=sk-xxxx` |
| `model` | 模型 ID，多个模型以逗号分隔，可在首页切换 | `?model=gpt-image-2.5-sunburst,gpt-image-2` |
| `imageGenerationModel` | Responses API 的图像生成工具模型，留空使用 API 默认值 | `?imageGenerationModel=gpt-image-2.5-sunburst` |
| `apiMode` | `images` 或 `responses`，默认 `images` | `?apiMode=responses` |
| `profileName` | 配置名称，默认“URL 参数配置” | `?profileName=我的配置` |
| `reasoningEffort` | Responses API 推理强度 | `?reasoningEffort=high` |
| `codexCli` | Codex CLI 兼容模式 | `?codexCli=true` |
| `streamImages` | 流式传输 | `?streamImages=true` |
| `streamPartialImages` | 中间步骤图像数（需配合 streamImages） | `?streamPartialImages=2` |
| `profileId` | 目标配置 ID；匹配到同 ID 配置时直接更新 | `?profileId=my-service` |
| `transparentBackgroundMethod` | 透明背景实现方式：`api`（原生）或 `local`（本地后处理） | `?transparentBackgroundMethod=local` |

在客户端中，复制带 `apiUrl` 或 `settings` 参数的导入链接后切回客户端，即会提示导入。

集成示例（New API 聊天系统）：

```text
https://your-deployment.example/?apiUrl={address}&model={model}
```

请替换为自己的实际部署地址。避免把 API Key 放入 URL、聊天、截图或公开仓库；URL 可能进入浏览器历史和日志。

---

<a id="announcements"></a>
## 📢 公告卡片

[`public/announcements.json`](public/announcements.json) 定义启动时显示的公告卡片，随应用一起打包。

- **添加公告**：在数组中追加一个对象，媒体文件放在 `public/announcements/` 中。
- **关闭公告**：自行部署时把该文件改为 `[]`。

| 字段 | 说明 |
|------|------|
| `id` | 必填，唯一标识；已读记录按 id 保存，换 id 才会再次提示 |
| `title` | 必填，标题 |
| `content` | 必填，Markdown 正文 |
| `note` | 可选，正文下方的次要说明（纯文本） |
| `when` | 可选，显示条件，缺省时总是显示 |
| `action` | 可选，主按钮 `{ "label": "下载客户端", "url": "https://..." }` |
| `media` | 可选，卡片顶部的媒体 `{ "type": "html" \| "image", "src": "announcements/xxx.html", "aspectRatio": "16/9" }` |

`media.src` 为不以 `/` 开头的相对路径；`html` 页面需引用同目录下的外部 `.css`、`.js` 文件。

`when` 是一个对象，每个键都要满足：

- 值可以是字面量（等于）、数组（等于其中之一）或运算对象 `{ "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in": 值 }`。
- 可用 `all`、`any`、`not` 组合条件。
- 条件写错时该条公告不显示，并在控制台提示。

| 变量 | 取值 |
|------|------|
| `platform` | `"web"` 或 `"client"` |
| `os` | `"windows"`、`"macos"`、`"linux"`、`"android"`、`"ios"` 或 `"other"` |
| `language` | 浏览器语言，如 `"zh-CN"` |
| `version` | 当前应用版本，如 `{ "gte": "0.8.0" }` |
| `imageCount` | 画廊中成功生成的图片数 |
| `taskCount` | 画廊任务数 |
| `standalone` | 网页版是否以 PWA 方式运行 |
| `now` | 当前时间，写带时区的 ISO 时间，如 `{ "lt": "2026-12-01T00:00:00+08:00" }` |

示例：

```json
[
  { "id": "web-windows", "title": "网页版 Windows 用户", "content": "……", "when": { "platform": "web", "os": "windows" } },
  { "id": "power-user", "title": "已生成超过 100 张图片", "content": "……", "when": { "imageCount": { "gt": 100 } } }
]
```

---

## 🔒 本地配置与数据

- 网页设置（包括输入保存的 API Key）随应用配置保存在浏览器本地存储；客户端使用本机存储。不要在不可信的共享设备或实例中保存密钥。
- 提示词优化只保存配置 ID、模型和开关，不另存一份密钥；请求时使用所选配置的现有凭据。
- 公开模型目录和价格查询不携带 OpenRouter Key；生成或优化请求发送到设置中显示的服务地址，OpenAI 兼容请求也可能经过启用的代理。
- 导出配置、备份或生成导入链接时检查是否包含 API Key，分享前移除凭据；本地存储不等于加密保险库。

## 🧱 扩展与上游同步

OpenRouter 的模型目录、参数、价格及适配器集中在 [`src/extensions/imageProviders/`](src/extensions/imageProviders/README.md)；提示词优化集中在 [`src/extensions/promptOptimization/`](src/extensions/promptOptimization/)。合并上游时重点检查设置归一化、统一 API 入口、输入框和 store 的接入点。旧存储键、协议名及归档结构保留兼容，不随产品标题直接替换。

## 💻 技术栈

<div align="center">
  <br>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E" alt="Vite" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS_3-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS 3" /></a>
  <a href="https://zustand.docs.pmnd.rs/"><img src="https://img.shields.io/badge/Zustand-764ABC?style=for-the-badge&logo=react&logoColor=white" alt="Zustand" /></a>
  <br>
  <br>
</div>

## 🔤 字体许可

本项目内置以下两款字体，由 `VITE_BUILTIN_FONT_SOURCE` 决定从公共 CDN 加载还是使用 [`fonts/`](fonts) 目录中的字体文件。完整许可文本位于 [`third-party-licenses/`](third-party-licenses)，也可在应用的“设置 → 关于 → 字体与第三方许可”中查看。

| 字体 | 版权方 | 许可 | 项目地址 | 许可文件 |
|------|------|------|------|------|
| HarmonyOS Sans SC | Huawei Device Co., Ltd. | HarmonyOS Sans Fonts License Agreement | [HarmonyOS 设计资源](https://developer.huawei.com/consumer/cn/design/resource/)，[许可证（License）](https://github.com/openharmony/resources/blob/master/LICENSE_Fonts) | [`third-party-licenses/HarmonyOS-Sans-LICENSE.txt`](third-party-licenses/HarmonyOS-Sans-LICENSE.txt) |
| Maple Mono NF CN | The Maple Mono Project Authors | SIL Open Font License 1.1 | [subframe7536/maple-font](https://github.com/subframe7536/maple-font) | [`third-party-licenses/MapleMono-LICENSE.txt`](third-party-licenses/MapleMono-LICENSE.txt) |

- HarmonyOS Sans SC 为官方未经修改的 TTF 文件（Regular、Medium、Bold）。
- Maple Mono NF CN 取自官方 v7.9 Release 的 Regular 字重，按 OFL 转换为 woff2 格式，未改动字形和名称。

## 📄 许可证 & 致谢

本项目基于 [MIT License](LICENSE) 开源，保留上游作者 CookSleep 的版权与许可声明。

特别致谢：[LINUX DO](https://linux.do)

## ⭐ Star History

<div align="center">
  <a href="https://www.star-history.com/?repos=liubaicai%2Fopen_image_playground&type=date&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liubaicai/open_image_playground&type=date&theme=dark&legend=top-left" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liubaicai/open_image_playground&type=date&legend=top-left" />
      <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liubaicai/open_image_playground&type=date&legend=top-left" />
    </picture>
  </a>
</div>
