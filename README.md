# pi-balance

在 [Pi](https://pi.dev) 中查看当前模型所属提供商的余额或订阅额度。

- **DeepSeek**：查看总余额、赠金和充值余额（CNY / USD）。
- **OpenAI Codex**：查看 ChatGPT 套餐、各额度窗口的剩余百分比和重置时间；有可用 credits 时单独展示。

## 安装

```sh
pi install git:github.com/huxeon/pi-balance
```

安装后，在 Pi 中执行 `/reload` 或重新启动。需要 Node.js 22.19+，基于 Pi 1.4.0 开发和测试。

## 配置与使用

用 `/model` 选中 DeepSeek 或 OpenAI Codex 的模型，然后执行：

```text
/balance
```

命令不带参数，只查询**当前模型的提供商**。如果尚未选中模型，或当前提供商不受支持（例如 `openai`，不是 `openai-codex`），会显示提示，不发起请求。

扩展复用 Pi 中已有的登录凭据，无需额外配置文件：

- **DeepSeek**：在 Pi 中运行 `/login deepseek`，或在启动前设置 `DEEPSEEK_API_KEY`。
- **OpenAI Codex**：在 Pi 中运行 `/login openai-codex`，使用 ChatGPT OAuth 登录；不支持用 OpenAI API Key 查询 Codex 订阅额度。

### DeepSeek

```text
────────────────────────────────────────────────────────────

 DeepSeek balance

 110.00 CNY
 Granted 10.00 · Topped up 100.00

 enter/r refresh  escape/ctrl+c close

────────────────────────────────────────────────────────────
```

### OpenAI Codex

```text
────────────────────────────────────────────────────────────

 Codex usage · Plus

 5-hour  ████████░░   82% left   Resets today at 13:10
 Weekly  █████████░   97% left   Resets Nov 25 at 08:11

 enter/r refresh  escape/ctrl+c close

────────────────────────────────────────────────────────────
```

Codex 按接口返回的时长命名额度窗口，重置时间用本地时区。窄终端不显示进度条。Credits 和订阅额度分开显示，不按货币换算。

- **刷新**：按 `Enter` 或 `r`；失败后可重试。
- **关闭**：按 `Esc` 或 `Ctrl+C`；加载中关闭会取消查询。
- **自定义快捷键**：确认和关闭键遵循 Pi 设置，面板提示同步更新。

仅在打开面板或手动刷新时发起查询，不会后台轮询，也不保存历史。DeepSeek 使用[官方余额接口](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)；Codex 使用 [Codex CLI 同款额度接口](https://github.com/openai/codex/pull/10973) `https://chatgpt.com/backend-api/wham/usage`，该接口不是公开稳定的 API。凭据不会显示在界面中。

RPC 模式以文本通知展示结果；无 UI 模式不执行查询。

## 本地开发

```sh
git clone https://github.com/huxeon/pi-balance.git
cd pi-balance
npm ci --ignore-scripts
npm run check
npm test
```

测试使用模拟数据，无需真实凭据，也不会发出实际余额请求。临时加载本地代码：

```sh
pi -e ./index.ts
```
