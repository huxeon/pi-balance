import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { BalanceError, type Balance } from "../src/balance.ts";
import { BalancePanel } from "../src/ui.ts";

// ANSI styling ensures width tests exercise styled CJK content, not just plain text.
const theme = {
  fg: (color: string, value: string) => `\x1b[${color === "border" ? 34 : color === "dim" ? 90 : color === "muted" ? 37 : 36}m${value}\x1b[39m`,
  bold: (value: string) => `\x1b[1m${value}\x1b[22m`,
} as unknown as Theme;
const balance: Balance = { is_available: true, balance_infos: [
  { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
  { currency: "USD", total_balance: "0.00000001", granted_balance: "0.00", topped_up_balance: "0.00000001" },
] };
function harness(query: (signal: AbortSignal) => Promise<Balance>, customCancel = false) {
  let closed = 0;
  let renders = 0;
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS,
    customCancel ? { "tui.select.cancel": "ctrl+q", "tui.select.confirm": "ctrl+r" } : undefined);
  const panel = new BalancePanel({ theme, keybindings, query,
    requestRender: () => { renders++; }, done: () => { closed++; } });
  return { panel, get closed() { return closed; }, get renders() { return renders; } };
}
const plain = (panel: BalancePanel, width = 80) => panel.render(width).map(stripVTControlCharacters).join("\n");
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("精简余额面板：边框、金额、双币种和快捷键", async () => {
  const h = harness(async () => balance);
  await h.panel.refresh();
  const content = plain(h.panel);
  assert.match(content, /─{40}/);
  for (const expected of ["DeepSeek balance", "Granted 10.00", "Topped up 100.00", "110.00 CNY", "USD", "0.00000001", "refresh", "close"]) {
    assert.ok(content.includes(expected), `缺少 ${expected}`);
  }
  for (const width of [0, 1, 2, 12, 24, 40, 60, 80, 120]) {
    for (const line of h.panel.render(width)) assert.ok(visibleWidth(line) <= width, `宽度 ${width} 越界`);
  }
  assert.match(plain(h.panel, 30), /110.00 CNY/);
  for (const removed of ["Provider", "账户可用", "更新于", "总可用余额"]) assert.ok(!content.includes(removed));
  h.panel.invalidate();
  assert.match(plain(h.panel), /110.00 CNY/);
});

test("内置对话框约定：单标题、留白、分组快捷键和主题色层级", async () => {
  const h = harness(async () => balance);
  await h.panel.refresh();
  const header = plain(h.panel, 60).split("\n").find(line => line.includes("DeepSeek"))!;
  assert.equal(header.trim(), "DeepSeek balance");
  const narrowHeader = plain(h.panel, 24).split("\n").find(line => line.includes("DeepSeek"))!;
  assert.equal(narrowHeader.trim(), "DeepSeek balance");
  const lines = plain(h.panel, 60).split("\n");
  assert.equal(lines[1]!.trim(), "");
  assert.equal(lines.at(-2)!.trim(), "");
  const rendered = h.panel.render(60).join("\n");
  assert.ok(h.panel.render(60)[0]!.includes("\x1b[34m"), "边框应使用 border 而不是 accent");
  assert.ok(h.panel.render(60).at(-1)!.includes("\x1b[34m"));
  assert.ok(rendered.includes("\x1b[36m\x1b[1mDeepSeek balance\x1b[22m"), "标题使用 accent");
  assert.ok(rendered.includes("\x1b[1m110.00\x1b[22m"));
  assert.ok(!rendered.includes("\x1b[1m110.00 CNY"));
  assert.match(plain(h.panel), /enter\/r refresh {2}escape(?:\/ctrl\+c)? close/);
  assert.ok(rendered.includes("\x1b[90menter/r\x1b[39m"));
  assert.ok(rendered.includes("\x1b[37m refresh\x1b[39m"));
  assert.ok(!plain(h.panel).includes("•"));
  assert.ok(rendered.includes("\x1b[37m close\x1b[39m"));
  h.panel.close();
});

test("加载中立即显示面板，重复刷新不并发，返回可取消且不再重绘", async () => {
  let resolve!: (value: Balance) => void;
  let signal!: AbortSignal;
  let queries = 0;
  const h = harness(input => {
    queries++;
    signal = input;
    return new Promise<Balance>(done => { resolve = done; });
  });
  const pending = h.panel.refresh();
  assert.match(plain(h.panel), /Loading balance/);
  assert.match(plain(h.panel), /close/);
  assert.ok(!plain(h.panel).includes("refresh"));
  h.panel.handleInput("r");
  h.panel.handleInput("\r");
  assert.equal(queries, 1);
  h.panel.handleInput("\x1b");
  assert.ok(signal.aborted);
  assert.equal(h.closed, 1);
  h.panel.close();
  assert.equal(h.closed, 1);
  const renders = h.renders;
  resolve(balance);
  await pending;
  assert.equal(h.renders, renders);
});

test("错误在面板内显示，可按 r/Enter 重试，失败时不展示旧余额", async () => {
  let queries = 0;
  const h = harness(async () => {
    queries++;
    if (queries === 2) throw new BalanceError("DeepSeek request timed out. Please try again.");
    return balance;
  });
  await h.panel.refresh();
  h.panel.handleInput("r");
  await tick();
  assert.match(plain(h.panel), /timed out/);
  assert.ok(!plain(h.panel).includes("110.00"));
  h.panel.handleInput("\r");
  await tick();
  assert.match(plain(h.panel), /110.00/);
  assert.equal(queries, 3);
});

test("刷新键去重，禁用键位时不生成空操作提示", async () => {
  for (const confirm of [[], ["r" as const]]) {
    const panel = new BalancePanel({
      theme,
      keybindings: { matches: () => false, getKeys: action => action === "tui.select.confirm" ? confirm : [] },
      query: async () => balance,
      requestRender: () => {},
      done: () => {},
    });
    await panel.refresh();
    const content = plain(panel);
    assert.match(content, /r refresh/);
    assert.ok(!content.includes("r/r"));
    assert.ok(!content.includes("/r"));
    assert.ok(!content.includes("close"));
    panel.dispose();
    await panel.refresh();
  }
});

test("关闭后迟到的错误不会重绘或重新发起查询", async () => {
  let reject!: (error: Error) => void;
  let queries = 0;
  const h = harness(() => {
    queries++;
    return new Promise<Balance>((_resolve, fail) => { reject = fail; });
  });
  const pending = h.panel.refresh();
  h.panel.close();
  const renders = h.renders;
  reject(new Error("sk-sensitive"));
  await pending;
  h.panel.handleInput("r");
  await h.panel.refresh();
  assert.equal(queries, 1);
  assert.equal(h.renders, renders);
  assert.equal(h.closed, 1);
});

test("空余额、不可用、未知异常及自定义退出键", async () => {
  const h = harness(async () => ({ is_available: false, balance_infos: [] }), true);
  await h.panel.refresh();
  assert.match(plain(h.panel), /Account unavailable/);
  assert.match(plain(h.panel), /No balance details available/);
  assert.match(plain(h.panel), /ctrl\+r\/r refresh {2}ctrl\+q close/);
  h.panel.handleInput("\x1b");
  assert.equal(h.closed, 0);
  h.panel.handleInput("\x11");
  assert.equal(h.closed, 1);
  const failed = harness(async () => { throw new Error("sk-secret"); });
  await failed.panel.refresh();
  assert.match(plain(failed.panel), /Failed to fetch balance/);
  assert.ok(!plain(failed.panel).includes("sk-secret"));
});
