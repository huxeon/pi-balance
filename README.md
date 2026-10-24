# pi-balance

Pi 的账户余额查看扩展，仅支持 **DeepSeek**。不依赖当前使用的模型或 Provider。

## 安装

需要 Pi（按 1.4.0 API 开发）和 Node.js 22.19+。

在本项目目录运行：

```powershell
pi install .
```

在已打开的 Pi 中执行 `/reload`，或重新启动 Pi。

也可以仅临时加载，不修改 Pi 设置：

```powershell
pi -e ./src/index.ts
```

使用本地路径安装时，保留此项目目录；Pi 直接引用此目录，不会复制代码。扩展运行时无额外第三方依赖，无需预先执行 npm install。

## 配置 API Key

直接复用当前 Pi 实例的凭据解析接口，无需单独的余额配置文件：

```typescript
const apiKey = await ctx.modelRegistry.getApiKeyForProvider("deepseek");
```

扩展不自行读取 auth.json、环境变量或实现凭据优先级，完全交由 Pi 处理。已在 Pi 中配置 DeepSeek 时，无需再次配置。

可任选一种常用方式：

1. 在 Pi 中执行 `/login deepseek`，将凭据保存到 Pi 的 auth.json。
2. 启动 Pi 前设置环境变量（PowerShell）：

   ```powershell
   $env:DEEPSEEK_API_KEY = "sk-your-deepseek-api-key"
   pi
   ```

Pi 默认凭据文件为 `~/.pi/agent/auth.json`，可通过 `PI_CODING_AGENT_DIR` 更改 agent 目录；路径解析同样由 Pi 负责。若手动编辑，**保留其他 Provider 的凭据，不要用示例覆盖整个文件**。格式参见 `auth.example.json`：

```json
{
  "deepseek": {
    "type": "api_key",
    "key": "sk-your-deepseek-api-key"
  }
}
```

- 凭据来源及优先级遵循 Pi 当前的 DeepSeek Provider 配置，包括 auth.json、`DEEPSEEK_API_KEY` 等来源；不再对来源额外设限。
- Pi 支持的 `!` 命令凭据也由 Pi 解析和缓存，扩展不自行执行或缓存凭据命令。
- 每次查询调用 Pi 的解析接口，不在扩展中缓存密钥；文件重载及凭据缓存行为遵循 Pi。
- 无可用凭据时提示配置，不发出余额请求。
- 请求超时固定为 10 秒，不向 auth.json 添加扩展设置，也不会修改凭据文件。
- 不再使用旧的 balance.json。
- auth.json 是明文凭据，请限制文件访问权限，勿提交到 Git、发送给模型或粘贴进对话。Linux/macOS 可执行 `chmod 600 ~/.pi/agent/auth.json`，Windows 请通过文件安全设置限制访问者。

## 使用

在 Pi 输入：

```text
/balance
/balance deepseek
```

终端中打开遵循 Pi 内置对话框常见约定的交互面板（主题色边框、左对齐标题、内容留白及分组快捷键提示）：

```text
────────────────────────────────────────────────────────────

 DeepSeek balance

 110.00 CNY
 Granted 10.00 · Topped up 100.00

 enter/r refresh  escape/ctrl+c close

────────────────────────────────────────────────────────────
```

- 打开后立即显示加载状态，查询完成后在原面板更新结果，不刷通知。
- `Enter` 或 `r` 刷新；`Esc` 返回。确认/返回键遵循 Pi 的快捷键设置，底部提示同步变化。
- 加载中返回会取消余额请求；重复刷新不会发起并发请求。
- 查询失败直接在面板内显示，可刷新重试，不再显示旧余额。
- 使用单个左对齐标题 DeepSeek balance，不添加右侧装饰标签；边框与内容之间适当留白。
- 颜色复用当前 Pi 主题：边框 `border`、标题 `accent`、金额 `text`、次要信息 `muted`、按键 `dim`、错误 `error`、警告 `warning`，不写死颜色值。
- 总余额数字加粗、币种弱化，赠金和充值以一行次要文字展示；多币种分别显示，窄终端自动换行。
- 底部展示确认键或 `r` 刷新，以及关闭键；按键使用暗色、操作名称使用次要色，各操作以双空格分组，不使用圆点分隔。键位提示遵循 Pi 设置，刷新键去重，禁用关闭键时不展示空提示。
- 正常时不显示账户状态，仅在账户不可用时显示提醒。

- 同时支持官方返回的 CNY、USD 余额，不做汇率换算。
- 保留接口返回的金额字符串，避免浮点数舍入。
- 余额是快照，手动刷新才会更新；不显示时间或状态栏余额。
- 查询按需触发：启动、模型调用后均不会自动查询，没有轮询。
- 重复执行时只允许一个查询；退出、reload 或切换会话时取消未完成查询。
- 面板、命令描述和所有运行时提示统一使用英文，与 Pi 内置界面保持一致。
- TUI 使用交互面板；RPC 客户端不支持自定义终端面板，回退为文本通知。结果不写入模型对话或会话消息；print/JSON 无 UI 模式不执行查询。未提供模型可调用工具。

## API 与安全

按照 [DeepSeek 查询余额官方文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance) 调用：

```http
GET https://api.deepseek.com/user/balance
Accept: application/json
Authorization: Bearer <API Key>
```

端点固定为官方 HTTPS 地址，不支持自定义 URL，不跟随重定向。错误信息不会回显 API Key、请求头、原始配置内容或远端错误体。扩展不会保存余额历史或输出凭据日志。与其他 Pi 扩展一样，扩展在 Pi 进程内运行，不提供对其他扩展或模型文件读取工具的凭据隔离。

## 开发与测试

```powershell
npm ci --ignore-scripts
npm run check
npm test
```

测试使用 mock，不需要真实 API Key，也不会向 DeepSeek 发请求。

```text
src/index.ts         Pi 命令注册、凭据解析、面板接入及会话清理
src/ui.ts            内置对话框风格面板、刷新及窄屏布局
src/balance.ts       DeepSeek 请求、响应校验及格式化
test/               自动化测试
auth.example.json    auth.json 格式示例（无真实密钥，不要覆盖已有凭据）
```
