# 技术参考资料

以下为实现使用的公开规范和官方文档，核对日期：2026-10-13。链接是参考来源，不表示其发布者参与、赞助或认可本项目，也不表示复制了文档中的代码。

| 资料 | 对应实现 |
| --- | --- |
| [Chrome：跨源网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) | 后台模型请求、网站访问权限、密钥与内容脚本隔离 |
| [Chrome：扩展 Service Worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers) | Manifest V3 后台入口与生命周期处理 |
| [Chrome：storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) | 本机配置、存储访问级别与诊断记录 |
| [ECMA-402：Segmenter Objects](https://tc39.es/ecma402/#segmenter-objects) | 基于 `Intl.Segmenter` 的句子划分 |
| [Ollama：Chat API](https://docs.ollama.com/api/chat) | 原生 `/api/chat` 请求与非流式响应 |
| [Ollama：Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs) | `format: "json"` 与结构化输出约束 |
| [Ollama：OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) | OpenAI 兼容服务及 `response_format` 请求 |
| [Playwright 官方项目](https://github.com/microsoft/playwright) | 可选浏览器集成测试；不是扩展运行时依赖 |

## 参考、依赖与复制代码的区别

扩展源码使用浏览器原生 API，运行时不打包第三方 JavaScript 库、字体、模型或词典。Playwright 仅由开发者自行安装用于测试。可选的桥接补丁及测试依赖外部桥接项目，由使用者单独提供。

当前项目没有需要引用的研究论文，也没有附带论文实验或第三方评测结果。测试范围与复现方式见 [README.md](README.md)；组件和素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
