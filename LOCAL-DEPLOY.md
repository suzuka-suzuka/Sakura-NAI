# Sakura NAI 本地启动与部署

完整功能和 Linux 部署说明见 [中文 README](README.md)，英文版见 [English README](README.en.md)。

## Windows 本地生产版

在项目根目录打开 PowerShell：

```powershell
npm exec --yes --package=bun -- bun install --frozen-lockfile
npm run build
.\start-local.cmd
```

启动脚本 `scripts/start-local.ps1` 会复制 Next.js standalone 所需的静态资源，然后仅监听 **127.0.0.1:3000**。浏览器访问 [Sakura NAI](http://127.0.0.1:3000)。关闭终端或按 Ctrl + C 停止服务。

修改代码后，停止旧服务，重新运行 `npm run build` 和 `.\start-local.cmd`。如果构建目录不存在，启动脚本会直接说明缺少生产构建。

## 开发模式

```powershell
npm run dev -- --hostname 127.0.0.1
```

开发模式支持热更新。请先停止占用 3000 端口的生产服务，或追加 `--port 3001` 使用其他端口。

## 连接与已有数据

首次打开时，在连接窗口的「密钥类型」下拉框选择「NovelAI 官方 Key」或「Sakura Key」，再输入相应密钥。Sakura 接口地址读取项目根目录的 `connection.config.json` 中的 `sakura.url`，修改后刷新网页生效，无需重新构建或重启。需要其他接口时选择「自定义接口」，在「高级连接设置」填写地址。语言可在连接窗口或菜单中切换，外观可在菜单中切换。

Token、参数和图库都存储在当前浏览器。请尽量沿用原访问地址：`localhost:3000` 与 `127.0.0.1:3000` 是两个不同的存储空间。升级为 Sakura NAI 后保留历史存储键，无需重新导入图库。

## Linux / Docker

```bash
docker compose up -d --build
docker compose logs -f web
```

默认访问服务器 8080 端口。域名、HTTPS、非 Docker 运行方式和数据流向见 [README](README.md#linux-服务器部署)。

构建阶段需要访问 Google Fonts。服务器提供网页，浏览器直接调用配置的绘图 API。
