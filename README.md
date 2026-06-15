# DiffSync（异同）

> 基于 Tauri 2 的跨平台桌面配置同步工具，通过 SSH/SFTP 安全连接远程服务器，支持本地与远端配置文件的差异比对、双向同步、格式校验及版本备份。

---

## 📋 项目介绍

**DiffSync（异同）** 是一款面向运维人员和开发者的桌面端配置管理工具。它通过 **Monaco Editor** 提供 side-by-side 差异比对视图，让你可以直观地对比本地与远端配置文件，并在推送前进行格式校验。

项目采用 **Tauri 2** 框架构建，前端使用 React 19 + TypeScript，后端使用 Rust，具备原生桌面性能与系统级文件访问能力。

### 核心设计理念

- **直连同步**：本地直达远程，无中间代理，覆盖前需确认链路及格式。
- **安全第一**：生产环境默认启用安全锁，推送前需要解锁 + 二次确认。
- **格式感知**：支持 JSON、YAML、TOML、INI、XML 等常见配置格式的语法校验。
- **备份护航**：每次推送自动备份远端文件至本地，保留最近 5 份。
- **连接复用**：SSH Session 连接池缓存 2 分钟，减少重复握手开销。

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 (Rust) |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 8 |
| CSS 框架 | TailwindCSS 4 |
| 差异编辑器 | Monaco Editor (@monaco-editor/react) |
| SSH 通信 | ssh2 (libssh2)，支持密码/私钥/SSH Agent 认证 |
| 配置解析 | serde_json, toml, yaml-rust2, rust-ini, quick-xml |

---

## ✨ 功能清单

### 项目管理
- [x] 创建/删除项目，按项目组织配置环境
- [x] 支持添加多个环境（开发/预发/生产等）

### 环境管理
- [x] 环境 CRUD（创建、编辑、克隆、删除）
- [x] 区分生产环境（🔴）与开发环境（🟢）
- [x] 本地配置路径浏览选择
- [x] 远程文件路径与文件名独立配置

### SSH 远程连接
- [x] 密码认证 & SSH 私钥认证
- [x] SSH Agent 自动检测与密钥注入（解决 macOS GUI 应用 SSH_AUTH_SOCK 丢失）
- [x] RSA / Ed25519 / ECDSA 等多种密钥类型支持
- [x] 连接测试功能（配置环境时即时验证）
- [x] Host Key 指纹校验（known_hosts 管理）
- [x] 主机密钥变更检测与提示（支持接受新密钥）
- [x] SSH Session 连接池缓存（2 分钟 TTL，减少重复握手）

### 差异比对（Diff Editor）
- [x] Monaco Editor 双栏 side-by-side 差异视图
- [x] 自动识别配置语言语法高亮（YAML / JSON / TOML / INI / XML）
- [x] 差异行数统计（+ 新增行 / - 删除行）
- [x] 状态栏显示语言类型与换行符格式（LF / CRLF）
- [x] 本地端可编辑（默认只读，可在设置中开启）

### 配置同步
- [x] **本地保存**：将编辑器左侧内容写入本地文件
- [x] **远端推送**：将编辑器右侧内容推送至远程服务器
- [x] **一键初始化**：远程无配置文件时，自动复制本地内容到右侧编辑器
- [x] 推送前自动格式校验（JSON / YAML / TOML / INI / XML）
- [x] 推送时自动保留原换行符格式（LF / CRLF）
- [x] 单文件大小限制 5MB

### 生产环境保护
- [x] 生产环境安全锁（默认启用，可关闭）
- [x] 解锁后自动倒计时回锁（1-60 分钟可配）
- [x] 生产环境推送二次确认弹窗（始终生效，不受锁开关影响）
- [x] 未保存修改切换环境时的提醒弹窗

### 云端备份
- [x] 推送前自动备份远端原始文件至本地
- [x] 保留最近 5 份备份（自动清理旧备份）
- [x] 备份文件名格式：`<文件名>.YYYYMMDD_HHMMSS.bak`
- [x] 备份列表浏览（按时间倒序）
- [x] 备份内容差异比对（远端 ↔ 备份）
- [x] 一键恢复备份至远端
- [x] 删除指定备份

### 设置面板
- [x] 查看数据存储目录
- [x] 生产安全锁开关
- [x] 自动回锁时间配置（1-60 分钟）
- [x] 本地文件编辑权限开关

### 其他特性
- [x] Toast 通知系统（错误 8s / 成功 4s / 警告 4s，最多同时显示 3 条）
- [x] macOS 菜单栏（DiffSync / 编辑）+ Cmd+, 快捷键打开设置
- [x] 数据持久化存储（项目、环境、凭据均存于本地文件）
- [x] 凭据安全存储（文件权限 0600，密码用 zeroize 零化内存）
- [x] 启动时安全与性能指引弹窗
- [x] 全屏加载遮罩（远程操作时显示）

---

## 📁 项目目录结构

```
diff-sync/
├── index.html                        # HTML 入口
├── package.json                      # 前端依赖与脚本
├── tsconfig.json                     # TypeScript 配置
├── vite.config.ts                    # Vite 构建配置
├── .gitignore                        # Git 忽略规则
│
├── src/                              # ── 前端源码 ──
│   ├── main.tsx                      # React 入口，挂载 App
│   ├── App.tsx                       # 主应用组件（状态管理、布局、业务逻辑）
│   ├── index.css                     # 全局样式（TailwindCSS + 自定义主题）
│   ├── vite-env.d.ts                 # Vite 类型声明
│   │
│   ├── types/
│   │   └── index.ts                  # 类型定义（AppStorage, Project, Environment,
│   │                                 #   SSHConfig, BackupRecord 等）+ 辅助函数
│   │
│   ├── utils/
│   │   └── formatHelper.ts          # 工具函数（换行符标准化、语言识别、错误解析）
│   │
│   ├── components/
│   │   ├── ProjectList.tsx           # 左侧项目/环境列表
│   │   ├── ProjectModal.tsx          # 创建项目弹窗
│   │   ├── EnvironmentModal.tsx       # 添加/编辑环境弹窗（含 SSH 配置）
│   │   ├── StatusBar.tsx            # 底部状态栏
│   │   ├── Toast.tsx                # Toast 通知系统
│   │   └── SettingsModal.tsx        # 设置弹窗
│   │
│   └── services/
│       ├── tauriFs.ts               # 本地文件读写服务（调用 Rust 后端）
│       └── tauriDialog.ts           # 系统文件选择对话框
│
├── src-tauri/                        # ── Rust/Tauri 后端源码 ──
│   ├── Cargo.toml                    # Rust 依赖配置
│   ├── Cargo.lock                    # Rust 依赖锁定
│   ├── tauri.conf.json               # Tauri 应用配置（窗口、打包、安全策略）
│   ├── build.rs                      # Tauri 构建脚本
│   │
│   ├── capabilities/
│   │   └── default.json             # 权限声明（文件系统读写、对话框）
│   │
│   ├── icons/                        # 应用图标
│   │   ├── icon.png
│   │   ├── 32x32.png
│   │   ├── 128x128.png
│   │   └── 128x128@2x.png
│   │
│   └── src/
│       ├── main.rs                   # Rust 入口（不显示终端窗口）
│       ├── lib.rs                    # Tauri 插件注册、菜单栏、命令注册
│       ├── sftp_cmd.rs               # 核心业务逻辑（SSH 连接、SFTP 读写、
│       │                             #   格式校验、备份管理、凭据存储、连接池）
│       ├── error.rs                  # 统一错误类型（带错误码序列化）
│       └── known_hosts.rs            # SSH Host Key 校验与管理
│
├── dist/                             # 前端构建产物
└── node_modules/                     # 前端依赖
```

---

## 🚀 部署文档

### 环境要求

| 工具 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | ≥ 18 | 前端运行时与包管理 |
| npm | ≥ 9 | 随 Node.js 一同安装 |
| Rust | ≥ 1.77 | Rust 编译工具链 |
| Cargo | ≥ 1.77 | Rust 包管理器 |
| 系统库 | — | macOS: Xcode Command Line Tools；Linux: `libwebkit2gtk-4.1`, `libgtk-3`, `libayatana-appindicator3` 等；Windows: WebView2 |

> 安装 Rust：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### 1. 从 Git 下载后安装依赖

```bash
# 克隆仓库
git clone <your-repo-url> diff-sync
cd diff-sync

# 安装前端依赖
npm install

# Rust 依赖会在首次构建时自动下载编译
# 如需提前拉取，可执行：
cd src-tauri && cargo fetch && cd ..
```

### 2. 开发环境启动命令

```bash
# 启动 Tauri 开发模式（同时启动 Vite 热更新 + Rust 后端）
npm run tauri dev
```

> 首次启动会编译 Rust 依赖，可能需要几分钟。后续启动会使用增量编译，速度较快。
>
> 前端开发服务器运行在 `http://localhost:1420`，HMR WebSocket 端口为 `1421`。

仅启动前端（不需要后端时）：

```bash
npm run dev        # Vite 开发服务器
npm run preview    # 预览构建产物
```

### 3. 生产环境打包命令

```bash
# 打包当前平台的应用
npm run tauri build
```

> 构建产物位于 `src-tauri/target/release/bundle/`，包含：
> - **macOS**: `.dmg` 磁盘映像
> - **Windows**: `.msi` / `.nsis` 安装包
> - **Linux**: `.deb` / `.rpm` / AppImage

#### 构建配置说明

`src-tauri/tauri.conf.json` 中的关键配置：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `build.devUrl` | `http://localhost:1420` | 开发模式前端地址 |
| `build.frontendDist` | `../dist` | 生产模式前端构建产物目录 |
| `build.beforeDevCommand` | `npm run dev` | 开发模式前置命令 |
| `build.beforeBuildCommand` | `npm run build` | 打包前构建前端命令 |
| `bundle.targets` | `all` | 打包所有格式 |
| `app.windows[0].title` | `DiffSync` | 应用窗口标题 |
| `app.windows[0].width/height` | `1200×750` | 默认窗口尺寸（最小 1200×550） |

#### Release 构建优化

`Cargo.toml` 中已配置 release profile：

```toml
[profile.release]
panic = "abort"        # 减小二进制体积
codegen-units = 1      # 更好的优化
lto = true             # 链接时优化
opt-level = "s"        # 优化体积
```

---

## 🔧 开发说明

### 前端脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | TypeScript 检查 + Vite 生产构建 |
| `npm run preview` | 预览构建产物 |
| `npm run tauri dev` | Tauri 开发模式 |
| `npm run tauri build` | Tauri 生产打包 |

### Rust 代码结构

- **`lib.rs`** — 应用入口，注册 Tauri 插件、菜单栏、命令处理器
- **`sftp_cmd.rs`** — 核心业务：SSH 连接管理、SFTP 文件操作、凭据存储、备份管理、格式校验、SessionPool 连接池
- **`error.rs`** — 统一错误类型 `AppError`，支持序列化为 `{code, message}` JSON
- **`known_hosts.rs`** — OpenSSH 格式 known_hosts 文件的读写与 Host Key 校验

### 架构约定

- 所有 SSH 操作通过 `establish_ssh_session()` 统一建立连接，支持 SessionPool 缓存
- 凭据（密码、私钥密码）通过 `EnvCredential` 存储，文件权限 `0600`
- 密码在内存中使用 `zeroize` crate 确保用后清零
- 前端状态通过 `useState` + `useEffect` 管理，通过 `invoke()` 调用 Rust 命令
- 数据持久化：项目/环境数据存于 `projects.json`，凭据存于 `credentials.json`，备份存于 `backups/<env_id>/`

---

## 📝 License

Internal use.
