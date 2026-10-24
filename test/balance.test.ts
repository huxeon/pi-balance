import assert from "node:assert/strict";
import test from "node:test";
import { fetchBalance, formatBalance, parseBalance } from "../src/balance.ts";

const config = { apiKey: "sk-test-secret", timeoutMs: 1000 };
const balance = {
  is_available: true,
  balance_infos: [{ currency: "CNY" as const, total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }],
};
const reply = (body: unknown, status = 200): typeof fetch =>
  async () => new Response(JSON.stringify(body), { status });

test("使用官方固定端点及 Bearer 鉴权，禁止重定向", async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/user/balance");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer sk-test-secret");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return Response.json(balance);
  };
  assert.deepEqual(await fetchBalance(config, undefined, request), balance);
});

test("余额数据校验及多币种显示，不把金额转换为浮点数", () => {
  const multi = parseBalance({ ...balance, balance_infos: [
    ...balance.balance_infos,
    { currency: "USD", total_balance: "0.00000001", granted_balance: "0.00", topped_up_balance: "-1.00" },
  ] });
  assert.match(formatBalance(multi), /Total: 110.00/);
  assert.match(formatBalance(multi), /Granted: 10.00/);
  assert.match(formatBalance(multi), /Topped up: 100.00/);
  assert.match(formatBalance(multi), /USD.*Total: 0.00000001/);
  assert.match(formatBalance({ is_available: false, balance_infos: [] }), /no available balance/);
  for (const bad of [null, [], {}, { ...balance, is_available: "true" },
    { ...balance, balance_infos: [{}] },
    { ...balance, balance_infos: [{ ...balance.balance_infos[0], currency: "\x1b[31m" }] },
    { ...balance, balance_infos: [{ ...balance.balance_infos[0], total_balance: 110 }] },
    { ...balance, balance_infos: [{ ...balance.balance_infos[0], total_balance: "NaN" }] },
  ]) assert.throws(() => parseBalance(bad), /Invalid balance data/);
});

for (const status of [401, 403, 429, 500]) {
  test(`HTTP ${status} 错误不泄露远端错误体`, async () => {
    await assert.rejects(fetchBalance(config, undefined, reply({ error: config.apiKey }, status)),
      (e: Error) => e.message.includes(String(status)) && !e.message.includes(config.apiKey));
  });
}

test("无效 JSON、无效结构和网络错误", async () => {
  await assert.rejects(fetchBalance(config, undefined, async () => new Response("sk-test-secret")), /invalid JSON/);
  await assert.rejects(fetchBalance(config, undefined, reply({})), /Invalid balance data/);
  await assert.rejects(fetchBalance(config, undefined, async () => { throw new Error(config.apiKey); }), /network connection/);
});

test("金额拒绝空白、终端控制符、科学计数法及超长输入", () => {
  for (const field of ["total_balance", "granted_balance", "topped_up_balance"]) {
    for (const amount of ["1\n", "1\r", "1\r\n", " 1", "1 ", "1\t", "1\x1b[31m", "1e3", "9".repeat(65)]) {
      assert.throws(() => parseBalance({
        ...balance,
        balance_infos: [{ ...balance.balance_infos[0], [field]: amount }],
      }), /Invalid balance data/);
    }
  }
});

test("已取消时不发起请求；读取后发现取消也不返回余额", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(fetchBalance(config, cancelled.signal, async () => {
    assert.fail("已取消的查询不得发出请求");
  }), /cancelled/);

  const controller = new AbortController();
  await assert.rejects(fetchBalance(config, controller.signal, async () => {
    const response = Response.json(balance);
    response.json = async () => {
      controller.abort();
      return balance;
    };
    return response;
  }), /cancelled/);
});

test("错误响应清理失败或挂起时仍保留 HTTP 错误", async () => {
  for (const cancel of [
    () => Promise.reject(new Error(config.apiKey)),
    () => new Promise<void>(() => {}),
  ]) {
    const response = new Response(new ReadableStream({ cancel }), { status: 401 });
    await assert.rejects(fetchBalance(config, undefined, async () => response), error =>
      error instanceof Error && error.message.includes("HTTP 401") && !error.message.includes(config.apiKey));
  }
});

const abortable: typeof fetch = async (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init!.signal!;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

test("请求超时和主动取消", async () => {
  // AbortSignal.timeout uses an unref timer; keep this mock's event loop alive.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(fetchBalance({ ...config, timeoutMs: 10 }, undefined, abortable), /timed out/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchBalance(config, controller.signal, abortable), /cancelled/);
  } finally {
    clearInterval(keepAlive);
  }
});

test("响应体读取也受超时控制", async () => {
  const keepAlive = setInterval(() => {}, 1000);
  const slowBody: typeof fetch = async (_url, init) => {
    const body = new ReadableStream({
      start(controller) {
        init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
      },
    });
    return new Response(body);
  };
  try {
    await assert.rejects(fetchBalance({ ...config, timeoutMs: 10 }, undefined, slowBody), /timed out/);
  } finally {
    clearInterval(keepAlive);
  }
});
