# Meta 素材上传与广告发布工具源码包

本目录为独立工具的源码归档，不会自动部署，也没有将工具合并到 AI 决策中心运行时。

- 来源仓库：https://github.com/luonooodan-star/meta-creative-vault
- 来源提交：`ed70470b61cbb36bae20109d00714654dfc089d4`
- 归档日期：2026-10-22
- 文件：`meta-asset-uploader-ed70470.tar.gz`
- SHA-256：`339f9a9d8dff5d2b036dbcc34cef1c67b9ccdc12d6ff30b42429266eb90ddab6`

包含已提交的源码、依赖锁文件、数据库结构和测试，包括多文件夹选择与按文件夹串行上传功能。未包含 `.env.local`、Token、HTTPS 证书、运行数据库、上传素材、浏览器历史、依赖目录、编译产物、Git 历史以及原托管项目的 `.openai` 配置。

## 使用注意

请解压到新的空目录，不要直接覆盖正在使用的公司电脑目录。

```sh
tar -xzf meta-asset-uploader-ed70470.tar.gz
cd meta-asset-uploader
npm ci
```

运行前须在目标机器配置环境变量、数据库绑定及局域网 HTTPS 证书，参照包内 README 与现有部署配置。环境密钥应在目标机器单独配置，不能提交 GitHub。

源码包不是用户数据备份；历史记录、数据库和浏览器本地数据不会随此包迁移。此次归档没有重新进行真实 Meta 上传验证。
