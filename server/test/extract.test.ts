import { describe, expect, it } from "vitest";
import { extractPage, imageIdFor, runsToText } from "../src/lk/extract.js";
import type { LkDocument, LkNode, LkResource } from "../src/lk/types.js";
import { buildFixtures } from "./mockLk.js";

const A = "https://assets.example";
const fixtures = buildFixtures(A);
const doc = (id: string, name: string): LkDocument => ({ id, name, type: "page", rank: "a0", isHidden: false });

function page(resourceId: string, docs: [string, string][]) {
  const resource = fixtures.resources[resourceId] as LkResource;
  return extractPage({
    resource,
    documents: docs.map(([id, name]) => ({ doc: doc(id, name), blocks: fixtures.blocks[`${resourceId}/${id}`] as LkNode[] })),
  });
}

describe("extractPage", () => {
  it("finds sidebar, infobox, nested and resource images in reading order without duplicates", () => {
    const result = page("goblin", [["doc1", "Overview"]]);
    expect(result.images.map((i) => [i.source, i.label])).toEqual([
      ["property", "Portrait"],
      ["block", "Overview · image 1"], // infobox image titled with the default "Image"
      ["block", "Goblin attacking"], // alt text when there is no title
      ["resource", "Page image"],
      ["banner", "Banner"],
    ]);
    // The duplicate portrait inside the layout was collapsed into the sidebar entry.
    expect(result.images.filter((i) => i.url.endsWith("goblin-portrait.png"))).toHaveLength(1);
    expect(result.images[1].documentName).toBe("Overview");
  });

  it("uses stable opaque ids derived from the URL", () => {
    const result = page("goblin", [["doc1", "Overview"]]);
    for (const image of result.images) {
      expect(image.id).toBe(imageIdFor(image.url));
      expect(image.id).toMatch(/^[a-f0-9]{24}$/);
    }
  });

  it("detects size from a sidebar key/value property before prose", () => {
    const result = page("goblin", [["doc1", "Overview"]]);
    expect(result.size).toMatchObject({ category: "small", source: "keyValue", origin: '"Stats" in sidebar' });
  });

  it("detects size from a statblock type line and finds images inside secrets", () => {
    const result = page("dragon", [["d1", "Statblock"]]);
    expect(result.size).toMatchObject({ category: "gargantuan", source: "statblock" });
    expect(result.images.map((i) => i.label)).toEqual(["Red dragon art"]);
  });

  it("does not read a size out of prose and handles pages without images", () => {
    const result = page("village", [["v1", "Main"]]);
    expect(result.size).toBeNull();
    expect(result.images).toEqual([]);
  });

  it("skips documents that could not be read", () => {
    const resource = fixtures.resources.goblin as LkResource;
    const result = extractPage({ resource, documents: [{ doc: doc("doc1", "Overview"), blocks: null }] });
    expect(result.images.map((i) => i.source)).toEqual(["property", "resource", "banner"]);
  });

  it("reads two-cell table rows and infobox key/value rows", () => {
    const resource: LkResource = { id: "x", name: "X", tags: [], aliases: [], documents: [], properties: [] };
    const cell = (text: string) => ({ kind: "tableCell", children: [{ kind: "paragraph", content: [{ text }] }] });
    const blocks: LkNode[] = [
      { kind: "table", children: [{ kind: "tableRow", children: [cell("Armor Class"), cell("15")] }, { kind: "tableRow", children: [cell("Size"), cell("Huge")] }] },
    ];
    const result = extractPage({ resource, documents: [{ doc: doc("d", "Stats"), blocks }] });
    expect(result.size).toMatchObject({ category: "huge", source: "keyValue", origin: 'Table in "Stats"' });

    const infobox: LkNode[] = [
      { kind: "infobox", rows: [{ kind: "keyValue", rows: [{ key: "Size", text: "Tiny", content: [{ text: "Tiny" }] }] }] },
    ];
    const r2 = extractPage({ resource, documents: [{ doc: doc("d", "Main"), blocks: infobox }] });
    expect(r2.size).toMatchObject({ category: "tiny", origin: 'Key/value block in infobox on "Main"' });
  });

  it("ignores non-http image URLs and malformed nodes", () => {
    const resource: LkResource = {
      id: "x", name: "X", tags: [], aliases: [], documents: [],
      properties: [{ kind: "image", url: "data:image/png;base64,AAAA" }, null as unknown as LkNode, { kind: "image" }],
    };
    expect(extractPage({ resource, documents: [] }).images).toEqual([]);
  });
});

describe("runsToText", () => {
  it("joins text, mentions and breaks", () => {
    expect(
      runsToText([{ text: "Size" }, { break: true }, { mention: { resourceId: "r", name: "Large" } }, { mention: { resourceId: "r", text: "!", name: "x" } }]),
    ).toBe("Size\nLarge!");
  });
});
