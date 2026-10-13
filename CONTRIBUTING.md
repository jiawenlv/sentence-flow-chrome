# 参与开发

先阅读 [README.md](README.md) 的开发与验证说明。扩展无需构建，单元测试使用 `npm test`；修改页面扫描、请求或交互逻辑时，运行 `npm run test:e2e`。

提交问题时说明扩展版本、Chrome 版本、操作步骤、预期与实际结果。可附诊断日志，但请先检查其中的网站 origin 和错误信息是否适合公开，不要提交 API Key、私人网页文本或浏览器配置文件。

修改需保留原文节点和交互，严格校验完整模型响应，并支持停止、取消与重新开启。新增外部依赖或素材时更新 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

`dist/`、`artifacts/`、依赖目录、本机配置和诊断导出文件不纳入源码提交。公开发行包通过 `python3 tools/package.py` 生成，更新发布说明时同步检查版本与隐私描述。
