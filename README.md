# pi-balance

在 [Pi](https://pi.dev) 中查看 DeepSeek 账户余额的轻量扩展。

输入 `/balance`，即可查看可用余额、赠金和充值余额，无需离开终端。界面跟随 Pi 主题，支持手动刷新，不依赖当前使用的模型。

## 安装

```sh
pi install git:github.com/huxeon/pi-balance
```

安装后，在 Pi 中执行 `/reload` 或重新启动。

需要 Node.js 22.19+，基于 Pi 1.4.0 开发和测试。

## 配置

复用 Pi 中已有的 DeepSeek API Key，无需额外配置文件。如果尚未配置，在 Pi 中执行：

```text
/login deepseek
```

也可以在启动 Pi 前设置 `DEEPSEEK_API_KEY` 环境变量。即使当前使用其他提供商的模型，也可以查询 DeepSeek 余额。

## 使用

```text
/balance
```

也支持 `/balance deepseek`。

```text
────────────────────────────────────────────────────────────

 DeepSeek balance

 110.00 CNY
 Granted 10.00 · Topped up 100.00

 enter/r refresh  escape/ctrl+c close

────────────────────────────────────────────────────────────
```

- **刷新**：按 `Enter` 或 `r`。
- **关闭**：按 `Esc` 或 `Ctrl+C`；加载中关闭会取消查询。
- **自定义快捷键**：确认和关闭键遵循 Pi 设置，面板提示同步更新。
- **多币种**：分别展示接口返回的 CNY、USD 余额，不做汇率换算。
- **查询失败**：在面板中显示提示，可按刷新键重试。

余额仅在打开面板或手动刷新时查询，不会后台轮询，也不会保存余额历史。请求发送至 [DeepSeek 官方余额接口](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)，API Key 不会显示在界面中。

RPC 模式下以文本通知展示结果；无 UI 模式下不执行查询。

## 本地开发

```sh
git clone https://github.com/huxeon/pi-balance.git
cd pi-balance
npm ci --ignore-scripts
npm run check
npm test
```

测试使用模拟数据，无需真实 API Key，也不会发出实际余额请求。

临时加载本地代码：

```sh
pi -e ./extensions/index.ts
```
