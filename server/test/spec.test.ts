// Keeps the mock LegendKeeper honest: every response it serves must validate
// against the official v3 OpenAPI schemas, and every request the client
// makes must hit a path the spec defines. The spec is vendored from
// https://www.legendkeeper.com/api/v3/openapi.json (refresh it to re-check).

import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LkClient } from "../src/core/lk/client.js";
import { PageService, ProjectRegistry } from "../src/core/services.js";
import { safeFetch } from "../src/node/safeFetch.js";
import { API_KEY, buildFixtures, PROJECT_ID, startMockLk, type MockLk } from "./mockLk.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/legendkeeper-openapi.json", import.meta.url), "utf8"));
const SPEC_ID = "https://www.legendkeeper.com/api/v3/openapi.json";

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema({ ...spec, $id: SPEC_ID });

function validator(name: string): ValidateFunction {
  const fn = ajv.getSchema(`${SPEC_ID}#/components/schemas/${name}`);
  if (!fn) throw new Error(`No schema ${name}`);
  return fn;
}

function expectValid(name: string, value: unknown) {
  const validate = validator(name);
  const ok = validate(value);
  expect(ok, `${name}: ${JSON.stringify(validate.errors?.slice(0, 3), null, 1)}`).toBe(true);
}

/** Path templates from the spec as regexes, e.g. /api/v3/projects/{projectId}/search. */
const specPaths = Object.keys(spec.paths).map((p) => ({
  template: p,
  regex: new RegExp(`^${p.replace(/\{[^}]+\}/g, "[^/]+")}/?$`),
  methods: Object.keys(spec.paths[p]).map((m) => m.toUpperCase()),
}));

let lk: MockLk;

beforeAll(async () => {
  lk = await startMockLk();
});
afterAll(() => lk.close());

async function getJson(path: string) {
  const res = await fetch(`${lk.baseUrl}${path}`, { headers: { Authorization: `Bearer ${API_KEY}` } });
  return { status: res.status, body: await res.json() };
}

describe("the validator is not vacuous", () => {
  it("rejects documents that break the schemas", () => {
    expect(validator("Resource")({ id: "x", name: "X" })).toBe(false); // missing required fields
    expect(validator("Block")({ kind: "image", url: "https://a/b.png", bogus: true })).toBe(false); // additionalProperties
    expect(validator("Block")({ kind: "image" })).toBe(false); // url required
    expect(validator("SearchResultList")({ data: [{ resource: { id: "x" } }] })).toBe(false); // name, tags required
    expect(validator("Block")({ kind: "image", url: "https://a/b.png", title: "Portrait" })).toBe(true);
  });
});

describe("mock LegendKeeper conforms to the OpenAPI spec", () => {
  it("vendored spec is v3", () => {
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.info.version).toMatch(/^3\./);
  });

  it("listProjects -> ProjectList", async () => {
    expectValid("ProjectList", (await getJson("/api/v3/projects/")).body);
  });

  it("search -> SearchResultList", async () => {
    expectValid("SearchResultList", (await getJson(`/api/v3/projects/${PROJECT_ID}/search/?q=o`)).body);
  });

  const fixtures = buildFixtures("https://assets.example");
  for (const id of Object.keys(fixtures.resources)) {
    it(`getResource ${id} -> Resource`, async () => {
      expectValid("Resource", (await getJson(`/api/v3/projects/${PROJECT_ID}/resources/${id}/`)).body);
    });
  }

  for (const key of Object.keys(fixtures.blocks)) {
    const [resourceId, docId] = key.split("/");
    it(`getDocumentBlocks ${key} -> DocumentBlocks`, async () => {
      expectValid("DocumentBlocks", (await getJson(`/api/v3/projects/${PROJECT_ID}/resources/${resourceId}/docs/${docId}/blocks/`)).body);
    });
  }

  it("errors -> Error", async () => {
    const res = await getJson(`/api/v3/projects/${PROJECT_ID}/resources/missing/`);
    expect(res.status).toBe(404);
    expectValid("Error", res.body);
  });
});

describe("the client only calls endpoints the spec defines", () => {
  it("every request in a full search + page + image flow matches a spec path and method", async () => {
    lk.requests.length = 0;
    const registry = new ProjectRegistry([new LkClient({ baseUrl: lk.baseUrl, apiKey: API_KEY, sleep: async () => {} })]);
    const pages = new PageService(registry, {
      maxSourceImageBytes: 10_000_000,
      assetHostAllowlist: null,
      allowInsecureAssetFetch: true,
      fetchImage: safeFetch,
    });
    await registry.list(true);
    await pages.search(PROJECT_ID, "goblin", 25);
    const page = await pages.getPage(PROJECT_ID, "goblin");
    await pages.getImage(PROJECT_ID, "goblin", page.details.images[0].id);

    const apiCalls = lk.requests.filter((r) => r.includes("/api/"));
    expect(apiCalls.length).toBeGreaterThan(3);
    for (const call of apiCalls) {
      const [method, path] = call.split(" ");
      const match = specPaths.find((p) => p.regex.test(path) && p.methods.includes(method));
      expect(match, `${call} is not in the spec`).toBeDefined();
    }
  });
});
