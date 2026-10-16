import { describe, expect, it, vi } from "vitest";
import { LkApiError, LkClient, LkNetworkError } from "../src/lk/client.js";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof LkClient>[0]> = {}) {
  return new LkClient({ baseUrl: "https://lk.test", apiKey: "secret", fetch: fetchImpl, sleep: async () => {}, ...extra });
}

describe("LkClient", () => {
  it("sends the bearer key and query parameters", async () => {
    const fetchMock = vi.fn(async () => respond(200, { data: [] }));
    await client(fetchMock as unknown as typeof fetch).get("/api/v3/projects/p/search", { q: "gob lin", limit: 5, skip: undefined });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://lk.test/api/v3/projects/p/search?q=gob+lin&limit=5");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });

  it("retries a 429 that asks for a short wait, honouring Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(429, { code: "RATE_LIMITED", message: "slow" }, { "retry-after": "2" }))
      .mockResolvedValueOnce(respond(200, { ok: true }));
    const result = await client(fetchMock, { sleep }).get("/x");
    expect(result).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("does not wait out a long Retry-After and reports it", async () => {
    const fetchMock = vi.fn(async () => respond(429, { code: "RATE_LIMITED", message: "slow" }, { "retry-after": "120" }));
    const err = await client(fetchMock).get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(LkApiError);
    expect(err).toMatchObject({ status: 429, retryAfter: 120 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx then gives up with the upstream code and request id", async () => {
    const fetchMock = vi.fn(async () => respond(503, { code: "INTERNAL", message: "down", requestId: "req_1" }));
    const err = await client(fetchMock).get("/x").catch((e) => e);
    expect(err).toMatchObject({ status: 503, code: "INTERNAL", requestId: "req_1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never retries a 404", async () => {
    const fetchMock = vi.fn(async () => respond(404, { code: "NOT_FOUND", message: "gone" }));
    await expect(client(fetchMock).get("/x")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns network failures into LkNetworkError after retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(client(fetchMock).get("/x")).rejects.toBeInstanceOf(LkNetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
