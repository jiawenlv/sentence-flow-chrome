# 第三方组件与素材说明

## 扩展发行内容

扩展的 `manifest.json`、`background/`、`content/`、`shared/`、`options/`、演示页面及随项目提供的图标按根目录 [MIT License](LICENSE) 提供。界面使用系统字体，未打包外部字体、图片素材库、模型权重或翻译词典。

`icons/icon.svg` 为项目随附的「句」字形路径图标，PNG 文件用于 Chrome 所需的图标尺寸。`docs/images/` 为项目演示页与测试界面的截图。演示内容用于功能验收，不代表真实媒体网站或第三方合作关系。

## 可选开发工具与外部服务

| 名称 | 用途 | 是否随扩展打包 | 上游许可或说明 |
| --- | --- | --- | --- |
| [Playwright](https://github.com/microsoft/playwright) | 浏览器集成测试 | 否 | [Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE)，由开发者自行安装 |
| Ollama / 用户指定的模型服务 | 接收模型请求 | 否 | 服务软件、模型权重及服务条款由各自提供者管理 |
| 本地 `ollama-openai-bridge` 项目 | 可选 HTTP 桥接与补丁验收 | 否 | 单独安装；补丁不替换或重新许可外部项目 |

文档链接、接口名称及相关名称属于各自权利人。技术参考资料见 [REFERENCES.md](REFERENCES.md)。本项目的 MIT 许可不授予第三方商标、模型权重或外部服务的使用权，也不表示与 Chrome、Ollama 或其他产品存在隶属关系。

若未来引入第三方源码、依赖或素材，应同时更新本文件并保留其必要的许可及归属说明。
