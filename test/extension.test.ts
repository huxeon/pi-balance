import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import type { BalancePanel } from "../src/ui.ts";
import extension from "../index.ts";

function harness(resolveKey: (provider: string) => Promise<string | undefined>) {
  const notices: string[] = [];
  const severities: (string | undefined)[] = [];
  const statuses: (string | undefined)[] = [];
  let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let shutdown!: () => void;
  const pi = {
    registerCommand(name: string, options: { handler: typeof handler }) {
      assert.equal(name, "balance");
      handler = options.handler;
    },
    on(event: string, callback: () => void) {
      assert.equal(event, "session_shutdown");
      shutdown = callback;
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    mode: "rpc",
    model: { provider: "deepseek" },
    modelRegistry: { getApiKeyForProvider: resolveKey },
    ui: {
      notify(message: string, severity?: string) {
        notices.push(message);
        severities.push(severity);
      },
      setStatus(key: string, text: string | undefined) {
        assert.equal(key, "pi-balance");
        statuses.push(text);
      },
    },
  } as unknown as ExtensionCommandContext;
  extension(pi);
  return { notices, severities, statuses, ctx, run: (args = "") => handler(args, ctx), handler, shutdown: () => shutdown() };
}

test("Pi 接入：每次通过当前 modelRegistry 解析 DeepSeek 凭据，防重复及会话取消", async () => {
  const previousFetch = globalThis.fetch;
  let key = "sk-first";
  let resolutions = 0;
  const h = harness(async provider => {
    assert.equal(provider, "deepseek");
    resolutions++;
    return key;
  });
  let requests = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      requests++;
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${key}`);
      return Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "10.00", granted_balance: "0.00", topped_up_balance: "10.00" }] });
    };
    await h.run();
    assert.match(h.notices.pop()!, /Total: 10.00/);
    key = "sk-updated";
    await h.run();
    assert.equal(requests, 2);
    assert.equal(resolutions, 2);
    globalThis.fetch = async () => new Response("sk-secret-remote-error", { status: 401 });
    await h.run();
    assert.match(h.notices.at(-1)!, /Authentication failed/);
    assert.ok(!h.notices.at(-1)!.includes("sk-secret"));
    assert.equal(h.statuses.at(-1), undefined);

    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      started();
    });
    const pending = h.run();
    await ready;
    await h.run();
    assert.match(h.notices.at(-1)!, /already open/);
    const count = h.notices.length;
    h.shutdown();
    h.shutdown();
    await pending;
    assert.equal(h.notices.length, count, "取消后不得通知旧会话");
    const before = resolutions;
    await h.handler("", { ...h.ctx, hasUI: false });
    assert.equal(h.notices.length, count);
    assert.equal(resolutions, before);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("切换模型后只查当前提供商，未选模型或不支持时不读凭据、不发请求", async () => {
  const previousFetch = globalThis.fetch;
  const providers: string[] = [];
  const requests: string[] = [];
  const token = `header.${Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
  })).toString("base64url")}.signature`;
  const h = harness(async provider => {
    providers.push(provider);
    return provider === "deepseek" ? "sk-deepseek-test" : token;
  });
  const ctxWithProvider = (provider: string): ExtensionCommandContext =>
    ({ ...h.ctx, model: { ...h.ctx.model!, provider } });
  try {
    globalThis.fetch = async (url, init) => {
      requests.push(String(url));
      if (String(url) === "https://api.deepseek.com/user/balance") {
        return Response.json({ is_available: true, balance_infos: [] });
      }
      assert.equal(new Headers(init?.headers).get("ChatGPT-Account-Id"), "test-account");
      return Response.json({ plan_type: "plus", rate_limit: {
        primary_window: { used_percent: 18, limit_window_seconds: 18000 },
      } });
    };
    await h.handler("", { ...h.ctx, model: undefined });
    assert.match(h.notices.at(-1)!, /No model selected/);
    assert.equal(h.severities.at(-1), "error");
    await h.handler("", ctxWithProvider("openai"));
    assert.match(h.notices.at(-1)!, /not supported.*"openai"/);
    assert.equal(h.severities.at(-1), "error");
    await h.run("openai-codex");
    assert.match(h.notices.at(-1)!, /Usage: \/balance/);
    assert.deepEqual(providers, []);
    assert.deepEqual(requests, []);

    await h.run();
    assert.match(h.notices.at(-1)!, /DeepSeek account/);
    await h.handler("", ctxWithProvider("openai-codex"));
    assert.match(h.notices.at(-1)!, /Codex usage · Plus\n5-hour: 82% left/);
    assert.equal(h.severities.at(-1), "info");
    assert.deepEqual(providers, ["deepseek", "openai-codex"]);
    assert.deepEqual(requests, [
      "https://api.deepseek.com/user/balance", "https://chatgpt.com/backend-api/wham/usage",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("TUI 命令直接打开交互面板，不发送结果通知，结束会话关闭面板", async () => {
  const previousFetch = globalThis.fetch;
  const h = harness(async () => "sk-tui-test");
  let panel!: BalancePanel;
  let renders = 0;
  const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as unknown as Theme;
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  const ctx = {
    ...h.ctx,
    mode: "tui",
    ui: {
      ...h.ctx.ui,
      custom: async (factory: (tui: { requestRender: () => void }, theme: Theme, keys: KeybindingsManager, done: () => void) => BalancePanel) =>
        new Promise<void>(done => {
          panel = factory({ requestRender: () => { renders++; } }, theme, keybindings, done);
        }),
    },
  } as unknown as ExtensionCommandContext;
  try {
    globalThis.fetch = async () => Response.json({ is_available: true, balance_infos: [] });
    const pending = h.handler("", ctx);
    assert.match(panel.render(80).join("\n"), /Loading balance/);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.match(panel.render(80).join("\n"), /No balance details available/);
    assert.deepEqual(h.notices, []);
    assert.ok(renders >= 2);
    h.shutdown();
    await pending;
    assert.deepEqual(h.notices, []);
  } finally {
    h.shutdown();
    globalThis.fetch = previousFetch;
  }
});

test("TUI 创建期间防重复；会话结束后迟到的工厂不得查询凭据", async () => {
  const h = harness(async () => { assert.fail("旧会话不得解析凭据"); });
  let open!: () => void;
  let creations = 0;
  const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as unknown as Theme;
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  const ctx = {
    ...h.ctx,
    mode: "tui",
    ui: {
      ...h.ctx.ui,
      custom: async (factory: (tui: { requestRender: () => void }, theme: Theme, keys: KeybindingsManager, done: () => void) => BalancePanel) =>
        new Promise<void>(done => {
          creations++;
          open = () => { factory({ requestRender: () => {} }, theme, keybindings, done); };
        }),
    },
  } as unknown as ExtensionCommandContext;
  const pending = h.handler("", ctx);
  await h.handler("", ctx);
  assert.equal(creations, 1);
  assert.match(h.notices.at(-1)!, /already open/);
  h.shutdown();
  open();
  await pending;
  assert.equal(h.notices.length, 1);
});

test("自定义 UI 创建失败会脱敏通知并释放命令锁", async () => {
  const h = harness(async () => undefined);
  const ctx = {
    ...h.ctx,
    mode: "tui",
    ui: { ...h.ctx.ui, custom: async () => { throw new Error("sk-ui-sensitive"); } },
  } as unknown as ExtensionCommandContext;
  await h.handler("", ctx);
  assert.deepEqual(h.notices, ["Failed to fetch balance."]);
  await h.run();
  assert.match(h.notices.at(-1)!, /DEEPSEEK_API_KEY/);
});

test("旧会话请求结束不能解除新会话的命令锁", async () => {
  const resolvers: ((key: string | undefined) => void)[] = [];
  const h = harness(() => new Promise<string | undefined>(resolve => { resolvers.push(resolve); }));
  const oldRequest = h.run();
  h.shutdown();
  const newRequest = h.run();
  resolvers[0]!(undefined);
  await oldRequest;
  await h.run();
  assert.match(h.notices.at(-1)!, /already open/);
  assert.equal(resolvers.length, 2);
  resolvers[1]!(undefined);
  await newRequest;
  assert.match(h.notices.at(-1)!, /DEEPSEEK_API_KEY/);
});

test("凭据缺失或解析失败时不请求 API，不泄露解析器异常", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { assert.fail("没有凭据时不得请求网络"); };
    const missing = harness(async () => undefined);
    await missing.run();
    assert.match(missing.notices.at(-1)!, /DEEPSEEK_API_KEY/);
    assert.equal(missing.statuses.at(-1), undefined);
    const failing = harness(async () => { throw new Error("sk-sensitive-parser-error"); });
    await failing.run();
    assert.equal(failing.notices.at(-1), "Failed to fetch balance.");
    assert.equal(failing.statuses.at(-1), undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("凭据解析期间结束会话，不得发出余额请求或通知旧会话", async () => {
  const previousFetch = globalThis.fetch;
  let resolve!: (key: string) => void;
  const h = harness(() => new Promise<string>(done => { resolve = done; }));
  try {
    globalThis.fetch = async () => { assert.fail("取消后不得请求网络"); };
    const pending = h.run();
    h.shutdown();
    resolve("sk-resolved-later");
    await pending;
    assert.deepEqual(h.notices, []);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
