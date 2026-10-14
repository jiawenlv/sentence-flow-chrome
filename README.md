# 句流 · Sentence Flow

整段理解，双语对照。一个使用你自己的模型服务、优先保留段落上下文的 Chrome 扩展。

- 设置统一使用 OpenAI 兼容的 Chat Completions 接口，支持 oMLX、本地服务及在线服务。
- 保留原文、链接、加粗和页面交互，点击工具栏图标即可翻译或恢复原文。
- 随滚动处理动态内容，跨刷新复用同一网站的成功译文缓存。
- 服务失败时说明原因，提供查看配置、重试和可导出的本机诊断日志。
- 原生 JavaScript / HTML / CSS，无需构建、无扩展运行时第三方依赖。

![句流双语翻译示例](docs/images/article.png)

目前通过「加载已解压的扩展程序」安装，尚未发布到 Chrome Web Store。产品名称为「句流 · Sentence Flow」；GitHub 仓库可使用 `sentence-flow-chrome`，本地文件夹不需要改名。

## 快速开始

1. 下载或克隆源码；或者解压项目发布的 ZIP。
2. Chrome 打开 `chrome://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择含有 `manifest.json` 的项目根目录或 `dist/sentence-flow`。
4. 右键句流图标 →「选项」，填写模型配置，先「测试连接」再「保存设置」。
5. 打开普通 HTTP(S) 网页，点击句流图标开始翻译，再点一次停止并恢复原文。快捷键为 **Alt+T**，macOS 为 **Option+T**。

更新后在扩展管理页重新加载句流，并刷新已经打开的网页。修改配置后，关闭并重新开启翻译；失败页面也可直接点击「重试翻译」。

## 模型接口配置

设置页统一使用 OpenAI 兼容接口，支持本地或在线服务。填写 Base URL 或完整的 /chat/completions 地址。

例如 oMLX：服务地址填 `http://127.0.0.1:11434/v1`，模型填服务提供的完整模型 ID，API Key 按服务配置填写。完整地址 `http://127.0.0.1:11434/v1/chat/completions` 也可直接使用，不会补全 /api/chat。

原有 Ollama 配置在打开设置页时会转为兼容接口表单；请测试连接并保存。Ollama 服务需要支持 OpenAI 兼容接口。首次加载本地模型较慢时，可将超时提高到 180 秒。

兼容接口须返回 choices[0].message.content，模型须支持按提示返回完整 JSON 译文。暂不支持 Anthropic / Gemini 原生接口或独立 Azure 部署协议。

## 阅读与缓存

默认按完整段落请求翻译，正文译文显示在对应段落之后，保留原有节点和事件。相邻句子及行内链接、加粗文字一起送入模型，避免为了逐句展示而切断上下文。标题、控件、独立链接和布局单元分别处理；倒计时、纯数字、代码和可编辑区域会跳过。

默认优先翻译视口附近内容，滚动、展开和动态加载时继续。「正文与列表优先」覆盖正文和内容面板，略过静态侧栏；「整个页面」也包含侧栏。导航和菜单由独立开关控制。

| 角标 | 含义 |
| --- | --- |
| `…` | 正在翻译，或等待滚动继续 |
| `✓` | 已收集的句子全部完成 |
| `·` | 已开启，暂时没有待译文字 |
| `!` | 发生错误；悬停查看原因，网页内可查看配置或重试 |

缓存按网站 origin、目标语言、服务、模型和内容类型隔离。正文保留 30 天，导航等固定文案保留 180 天；最多 4,000 条、约 12 MiB。同站相同文案复用成功缓存，相同并发请求合并。失败结果不缓存。设置页可查看统计和清空缓存。右键网页或句流图标 →「清除当前页面翻译缓存」，会恢复原文，下一次点击图标重新翻译；其他页面复用的相同句子缓存也会清除。

同一时间最多两个模型请求，每批最多 12 个文本块 / 6,000 字符（Hy-MT 最多 4 个完整文本块）。停止翻译会取消当前页面不再需要的请求；其他标签页仍需要的共享请求继续执行。不同子域名、协议或端口不共享缓存。

## 故障排查与日志

- **点击后出现 `!`**：悬停图标或查看网页右下角的错误提示，按说明检查配置后重试。
- **无法连接本地 `11435`**：确认 OpenAI 兼容桥接也已启动，检查 `http://127.0.0.1:11435/health`；服务类型应选择「在线大模型」。
- **服务管理命令误报已运行**：可能是过期 PID 被系统复用。本项目附带可选的桥接修复补丁，见下文。
- **暂时没有译文**：检查目标语言、翻译范围和导航开关；中文为主的内容在中文目标下默认跳过。
- **网页脚本版本过旧**：重新加载扩展后刷新网页。
- **快捷键无效**：在 `chrome://extensions/shortcuts` 检查冲突或修改快捷键。

选项页 →「诊断日志」可查看、导出或清空最近 300 条记录。记录保存在浏览器本机，本机日志服务运行时，同时写入 `~/.ljwsoftware/sentence-flow/diagnostics.jsonl`，不记录网页原文、译文、请求体或 API Key；地址仅保留 origin。重现问题后点击「刷新日志」。

`toolbar.click` 说明点击已到达后台；`page.ready` 可核对脚本版本；`model.network.error` 表示未连上服务；`model.response` 记录 HTTP 状态；`translation.error` / `operation.error` 记录失败原因。如果后台未能启动，在 `chrome://extensions` 查看句流的「错误」或 service worker 控制台。

使用可选 `ollama-service translate` 桥接时，运行 `ollama-service translate logs` 查看服务日志；日志位于该桥接项目的 `.translate-service/server.log`。

## 隐私与权限

扩展需要 HTTP(S) 网站访问权限，以加载内容脚本并连接你配置的模型服务。仅在主动开启翻译后扫描网页文本；API 请求在扩展后台执行，网页与内容脚本不能读取配置密钥。

API Key、缓存和诊断日志保存在浏览器本机。在线服务会接收你提交的待译文字；本地模型服务在其配置地址处理文字。项目不包含遥测、广告、账号同步或独立云端后端。完整说明见 [PRIVACY.md](PRIVACY.md)。

## 已知边界

- 需要 Chrome 116 或更新版本；其他 Chromium 浏览器未经完整验证。
- 暂不支持浏览器内置页、Chrome 商店、PDF、图片文字、iframe、Shadow DOM 和文件 URL。
- 隐藏内容、代码、输入与编辑区域、`translate=no` 区域会跳过；少数强控制 DOM 的页面可能需要恢复原文并刷新。
- 超过 6,000 字符的极长段落才分块，优先在句末切分；单个异常超长段落有收集上限。段落中的控件、换行和独立布局仍按实际边界处理。
- 译文质量、响应速度、使用额度和费用取决于模型及服务。

## 开发与验证

扩展本身无需安装依赖或执行构建。单元测试需要 Node.js 20.11+，打包需要 Python 3。

```sh
npm test
python3 tools/package.py
```

打包结果是 `dist/sentence-flow/` 和对应版本 ZIP。浏览器集成测试需要 Playwright 与可用 Chromium：

```sh
npm install --no-save playwright
npx playwright install chromium
npm run test:e2e

# 可选：使用已安装、支持加载扩展的测试浏览器
CHROME_EXECUTABLE="/path/to/chrome-for-testing" npm run test:e2e
```

也可用 `PLAYWRIGHT_MODULE` 指定已安装 Playwright 的模块路径。测试使用临时浏览器配置和本机模拟模型服务，不调用真实模型或真实 API Key；覆盖翻译、缓存、动态内容、取消、工具栏、错误恢复、设置与日志。截图生成于忽略提交的 `artifacts/`。

手动验收：运行 `python3 -m http.server 8765 --bind 127.0.0.1`，打开 `http://127.0.0.1:8765/demo/article.html`。

### 可选桥接修复

`tools/` 内的补丁用于独立的 `ollama-openai-bridge` 项目，不是扩展运行依赖，也不会自动修改外部项目或重启服务。

- `ollama-server-cancellation.patch`：将 HTTP 断开传给上游，包括非流式请求。
- `ollama-service-pid.patch`：核对 Node 进程及精确脚本路径，避免过期 PID 误判；停止失败时阻止继续启动。

```sh
# 在临时副本验证补丁；目标源码已修复时追加 --verify
node tests/bridge-cancellation.mjs /path/to/ollama-server
node tests/service-manager-pid.mjs /path/to/ollama-server
```

## 项目结构

```text
background/       请求、并发、缓存、诊断日志与工具栏状态
content/          文本抽取、译文插入与动态页面处理
shared/           分句、配置校验与通用样式
options/          设置、诊断、版权与隐私页面
demo/             手动和自动验收页面
tests/            单元测试与浏览器集成测试
tools/            打包工具及可选桥接补丁
docs/images/      README 展示图片
```

## 开源许可与参考资料

本项目采用 [MIT License](LICENSE)，版权声明为 `Copyright (c) 2026 Sentence Flow contributors`。设置页底部可打开「关于 · 版权与许可」，查看完整许可及隐私说明。

技术参考资料与实现对应关系见 [REFERENCES.md](REFERENCES.md)，依赖和素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。参考链接用于说明接口和标准来源；本项目不宣称附带学术论文或第三方认证。历史变化见 [CHANGELOG.md](CHANGELOG.md)。

### 本机文件日志（可选）

运行 `uv run --no-project python tools/diagnostics-server.py`，启动仅监听 `127.0.0.1:18766` 的诊断接收服务。扩展重新加载后会将脱敏的诊断元数据同时发送给它；未启动服务时仍保留浏览器内日志，不影响翻译。文件位于 `~/.ljwsoftware/sentence-flow/diagnostics.jsonl`，达到 5 MiB 后轮换为 `diagnostics.previous.jsonl`，只保留一个轮换文件。服务不会记录网页原文、译文、请求体或 API Key。

Hy-MT 系列优先使用最多 4 个完整段落或独立文本块 / 6,000 字符的纯文本批量翻译，以分隔符对应结果。分隔符或数量校验失败时，仅该批次回退到逐段请求；每个小批次完成即可显示。模型无需生成 JSON 编号和结构，由插件负责组装返回结果。通用模型继续使用批量 JSON 请求。提示词参考 [Hy-MT2 官方模型说明](https://huggingface.co/tencent/Hy-MT2-7B)。
