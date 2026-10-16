import { describe, expect, it } from "vitest";
import {
  collectSceneLinks,
  createLink,
  LINK_KEY,
  matchTokens,
  newImportId,
  parseLink,
  type LinkableItem,
} from "../src/lib/links";
import {
  emptyIndex,
  enforceBudget,
  MAX_INDEX_BYTES,
  newSceneKey,
  otherScenesFor,
  parseIndex,
  parseSceneKey,
  reconcileScene,
  sameIndex,
} from "../src/lib/roomIndex";

let n = 0;
function item(name: string, metadata: Record<string, unknown> = {}): LinkableItem {
  return { id: `item${++n}`, name, type: "IMAGE", metadata };
}
const linked = (name: string, resourceId: string, title = name, projectId = "proj1") =>
  item(name, { [LINK_KEY]: createLink(projectId, resourceId, title, newImportId()) });

describe("parseLink", () => {
  it("ignores items without our key, including other extensions' metadata", () => {
    expect(parseLink({})).toBeNull();
    expect(parseLink({ "com.other/link": { resourceId: "x" } })).toBeNull();
  });

  it("reads a valid link", () => {
    const link = createLink("proj1", "goblin", "Goblin Boss", "abc");
    expect(parseLink({ [LINK_KEY]: link })).toEqual({ status: "valid", link });
  });

  it.each([
    ["not an object", "oops"],
    ["wrong version", { v: 9, projectId: "p", resourceId: "r" }],
    ["missing resource", { v: 1, projectId: "p" }],
    ["injected id", { v: 1, projectId: "p", resourceId: "../../x" }],
  ])("flags invalid link data: %s", (_name, raw) => {
    expect(parseLink({ [LINK_KEY]: raw })).toMatchObject({ status: "invalid" });
  });

  it("tolerates missing optional fields", () => {
    expect(parseLink({ [LINK_KEY]: { v: 1, projectId: "p", resourceId: "r" } })).toMatchObject({
      status: "valid",
      link: { title: "", importId: "" },
    });
  });
});

describe("matching tokens to pages", () => {
  const scene = [
    linked("Goblin Boss", "goblin"),
    linked("Goblin Boss", "goblin"), // an Owlbear copy
    linked("Old Name", "dragon", "Old Name"),
    linked("Goblin Boss", "goblin", "Goblin Boss", "proj2"), // same page id, other project
    item("Unlinked token"),
    item("Broken", { [LINK_KEY]: { v: 1 } }),
  ];

  it("finds every token for a page by id, not title, within the project", () => {
    const matches = matchTokens(scene, "proj1", "goblin", "Goblin Boss");
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.duplicate && !m.nameDiffers && !m.pageRenamed)).toBe(true);
  });

  it("flags renamed pages and diverging token names", () => {
    const [m] = matchTokens(scene, "proj1", "dragon", "Ancient Red Dragon");
    expect(m).toMatchObject({ pageRenamed: true, nameDiffers: true, duplicate: false });
  });

  it("does not match by title", () => {
    expect(matchTokens([item("Goblin Boss")], "proj1", "goblin", "Goblin Boss")).toEqual([]);
  });

  it("collects invalid link data separately", () => {
    const links = collectSceneLinks(scene);
    expect(links.invalid.map((i) => i.item.name)).toEqual(["Broken"]);
    expect([...links.byPage.keys()].sort()).toEqual(["proj1:dragon", "proj1:goblin", "proj2:goblin"]);
  });

  it("makes unique import ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newImportId));
    expect(ids.size).toBe(200);
  });
});

describe("room index", () => {
  it("records, moves and forgets tokens per scene", () => {
    let index = reconcileScene(emptyIndex(), "sceneA", new Map([["p:goblin", "Goblin"]]), 1);
    index = reconcileScene(index, "sceneB", new Map([["p:goblin", "Goblin"], ["p:dragon", "Dragon"]]), 2);
    expect(otherScenesFor(index, "p:goblin", "sceneA")).toEqual(["sceneB"]);
    expect(otherScenesFor(index, "p:dragon", "sceneA")).toEqual(["sceneB"]);

    // The goblin token is deleted from scene B; the next reconcile of B forgets it there.
    index = reconcileScene(index, "sceneB", new Map([["p:dragon", "Dragon"]]), 3);
    expect(otherScenesFor(index, "p:goblin", "sceneB")).toEqual(["sceneA"]);
    expect(otherScenesFor(index, "p:goblin", "sceneA")).toEqual([]);

    // Emptying scene A drops the entry entirely.
    index = reconcileScene(index, "sceneA", new Map(), 4);
    expect(index.entries["p:goblin"]).toBeUndefined();
  });

  it("stays under its byte budget by evicting the stalest entries", () => {
    let index = emptyIndex();
    for (let i = 0; i < 400; i++) {
      index = reconcileScene(index, `scene${i % 7}`, new Map([[`proj:page${i}`, `A fairly long page title ${i}`]]), i);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(index)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_INDEX_BYTES);
    expect(index.entries["proj:page399"]).toBeDefined();
    expect(index.entries["proj:page0"]).toBeUndefined();
    expect(enforceBudget(index)).toEqual(index);
  });

  it("parses defensively", () => {
    expect(parseIndex("junk")).toEqual(emptyIndex());
    expect(parseIndex({ v: 1, entries: { a: { t: "x", s: ["s1", 5] , u: 1 }, b: { s: [] } } })).toEqual({
      v: 1,
      entries: { a: { t: "x", s: ["s1"], u: 1 } },
    });
    expect(parseSceneKey({ id: newSceneKey() })).toMatch(/^[a-z0-9]{10}$/);
    expect(parseSceneKey({ id: "<script>" })).toBeNull();
  });

  it("compares indexes ignoring timestamps and order", () => {
    const a = reconcileScene(emptyIndex(), "s1", new Map([["k", "T"]]), 1);
    const b = reconcileScene(emptyIndex(), "s1", new Map([["k", "T"]]), 99);
    expect(sameIndex(a, b)).toBe(true);
  });
});
