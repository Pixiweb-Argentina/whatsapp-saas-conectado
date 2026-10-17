import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

const { validateMediaUrl, downloadAndStoreMedia } = await import("./media-handler.ts");

test("each provider may only make us download from its own host (SEC-08)", () => {
  assert.equal(validateMediaUrl("ycloud", "https://api.ycloud.com/v2/media/x"), true);
  assert.equal(validateMediaUrl("kapso", "https://api.kapso.ai/media/x?token=t"), true);
  assert.equal(validateMediaUrl("kapso", "https://app.kapso.ai/rails/active_storage/blobs/redirect/x/a.jpeg"), true);
  assert.equal(validateMediaUrl("kapso", "http://app.kapso.ai/x"), false);
  assert.equal(validateMediaUrl("ycloud", "https://app.kapso.ai/x"), false);
  assert.equal(validateMediaUrl("ycloud", "https://api.kapso.ai/media/x"), false);
  assert.equal(validateMediaUrl("kapso", "https://api.ycloud.com/v2/media/x"), false);
  assert.equal(validateMediaUrl("kapso", "https://api.kapso.ai.evil.com/x"), false);
  assert.equal(validateMediaUrl("ycloud", "not a url"), false);
});

test("the API key goes to YCloud only; Kapso URLs are pre-signed", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response("nope", { status: 404 }); // stop before storage
  }) as typeof fetch;
  try {
    const base = { workspaceId: "ws", conversationId: "conv" };
    await downloadAndStoreMedia({ ...base, provider: "ycloud", link: "https://api.ycloud.com/m", apiKey: "yk" });
    await downloadAndStoreMedia({ ...base, provider: "kapso", link: "https://api.kapso.ai/m?token=t", apiKey: "leak" });
    assert.deepEqual(
      (calls[0].init?.headers as Record<string, string>)["X-API-Key"],
      "yk",
    );
    assert.equal(calls[1].init?.headers, undefined, "no headers (and no key) for Kapso");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a link on the wrong host is refused without any request", async () => {
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await downloadAndStoreMedia({
      provider: "kapso",
      link: "https://169.254.169.254/latest/meta-data",
      workspaceId: "ws",
      conversationId: "conv",
    });
    assert.equal(res, null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

const R2 = "https://kapso-ai-prod.d77f1e59818b5ed2ec009d1a9116b255.r2.cloudflarestorage.com/obj?X-Amz-Signature=secret";
const APP_LINK = "https://app.kapso.ai/rails/active_storage/blobs/redirect/signed--token/image.jpeg";

async function withFetch(handler: (url: string, init?: RequestInit) => Response, run: (calls: string[], logs: string[]) => Promise<void>) {
  const calls: string[] = []; const logs: string[] = [];
  const realFetch = globalThis.fetch; const realError = console.error;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push(url); return handler(url, init); }) as typeof fetch;
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try { await run(calls, logs); } finally { globalThis.fetch = realFetch; console.error = realError; }
}

test("a Kapso app link follows exactly one https redirect to its R2 object", async () => {
  await withFetch((url, init) => {
    if (url === APP_LINK) {
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status: 302, headers: { location: R2 } });
    }
    assert.equal(init?.redirect, "error", "no further redirects after R2");
    return new Response("nope", { status: 404 }); // stop before storage
  }, async (calls, logs) => {
    const res = await downloadAndStoreMedia({ provider: "kapso", link: APP_LINK, workspaceId: "ws", conversationId: "conv" });
    assert.equal(res, null);
    assert.deepEqual(calls, [APP_LINK, R2]);
    assert.equal(logs.some((l) => l.includes("secret") || l.includes("token")), false, "signed links stay out of logs");
  });
});

test("a Kapso redirect anywhere but R2 over https is refused", async () => {
  for (const location of ["https://169.254.169.254/latest/meta-data", "http://kapso-ai-prod.abc123.r2.cloudflarestorage.com/o",
    "https://r2.cloudflarestorage.com.evil.com/o", "https://kapso.abc.r2xcloudflarestoragexcom/o", "/local/path"]) {
    await withFetch(() => new Response(null, { status: 302, headers: { location } }), async (calls) => {
      const res = await downloadAndStoreMedia({ provider: "kapso", link: APP_LINK, workspaceId: "ws", conversationId: "conv" });
      assert.equal(res, null);
      assert.deepEqual(calls, [APP_LINK], `no request to ${location}`);
    });
  }
});

test("a refused host is logged without its signed path", async () => {
  await withFetch(() => new Response("", { status: 200 }), async (calls, logs) => {
    await downloadAndStoreMedia({ provider: "kapso", link: "https://evil.example/x?token=secret", workspaceId: "ws", conversationId: "conv" });
    assert.deepEqual(calls, []);
    assert.equal(logs.some((l) => l.includes("evil.example")), true);
    assert.equal(logs.some((l) => l.includes("secret")), false);
  });
});
