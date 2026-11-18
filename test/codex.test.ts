import assert from "node:assert/strict";
import test from "node:test";
import { fetchCodexUsage, formatCodexUsage, parseCodexUsage } from "../src/codex.ts";

const tokenWith = (id: string) => `header.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: id },
})).toString("base64url")}.signature`;
const token = tokenWith("codex-test-account");
const payload = {
  plan_type: "plus",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 18, limit_window_seconds: 18000, reset_at: 1795007450 },
    secondary_window: { used_percent: 3, limit_window_seconds: 604800, reset_at: 1795594284 },
  },
  credits: { has_credits: false, unlimited: false, balance: "0" },
};

test("Codex 查询使用固定接口、OAuth access token 和账户 ID，禁止重定向", async () => {
  const usage = await fetchCodexUsage(token, undefined, async (url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(headers.get("Authorization"), `Bearer ${token}`);
    assert.equal(headers.get("ChatGPT-Account-Id"), "codex-test-account");
    assert.equal(headers.get("Accept"), "application/json");
    return Response.json(payload);
  });
  assert.deepEqual(usage, {
    plan: "Plus",
    windows: [
      { usedPercent: 18, durationSeconds: 18000, resetAt: 1795007450 },
      { usedPercent: 3, durationSeconds: 604800, resetAt: 1795594284 },
    ],
    limitReached: false,
    credits: null,
  });
  const output = formatCodexUsage(usage, new Date(1795007450 * 1000 - 1000));
  assert.match(output, /5-hour: 82% left · Resets today at \d\d:\d\d/);
  assert.match(output, /Weekly: 97% left · Resets /);
  assert.doesNotMatch(output, /Credits/);
});

test("损坏的 OAuth 凭据或已结束的查询不发请求，HTTP 错误不泄露响应体", async () => {
  let requests = 0;
  const blocked: typeof fetch = async () => { requests++; throw new Error(); };
  for (const bad of ["sk-api-key", "bad.@@@.token", tokenWith("foo\r\nsecret")]) {
    await assert.rejects(fetchCodexUsage(bad, undefined, blocked), /\/login openai-codex/);
  }
  await assert.rejects(fetchCodexUsage(token, AbortSignal.abort(), blocked), /cancelled/);
  assert.equal(requests, 0);
  await assert.rejects(fetchCodexUsage(token, undefined, async () =>
    new Response(token, { status: 401 })), error =>
    error instanceof Error && error.message.includes("/login openai-codex") && !error.message.includes(token));
});

test("Codex 按时长命名窗口，支持缺少重置时间、空窗口和可选 credits", () => {
  const daily = parseCodexUsage({
    plan_type: "pro",
    rate_limit: {
      limit_reached: true,
      secondary_window: { used_percent: 100, limit_window_seconds: 86400 },
    },
    credits: { has_credits: true, unlimited: false, balance: "1.00100" },
  });
  assert.match(formatCodexUsage(daily), /Usage limit reached\nDaily: 0% left\nCredits: 1\.00100/);
  const noWindows = parseCodexUsage({
    plan_type: "custom", rate_limit: null, credits: { has_credits: true, unlimited: true },
  });
  assert.match(formatCodexUsage(noWindows), /No usage windows available\nCredits: Unlimited/);
});

test("Codex 对坏额度数据和终端控制字符报安全错误", () => {
  const primary_window = payload.rate_limit.primary_window;
  for (const bad of [null, {}, { ...payload, plan_type: "plus\n" }, { ...payload, rate_limit: [] },
    ...[{ used_percent: -1 }, { used_percent: 101 }, { limit_window_seconds: 0 }, { reset_at: 1e15 }]
      .map(overrides => ({ ...payload, rate_limit: { primary_window: { ...primary_window, ...overrides } } })),
    { ...payload, credits: { has_credits: true, unlimited: false, balance: "1\x1b[31m" } },
  ]) assert.throws(() => parseCodexUsage(bad), /Invalid usage data/);
});
