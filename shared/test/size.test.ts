import { describe, expect, it } from "vitest";
import {
  detectSize,
  detectSizeFromKeyValues,
  detectSizeFromLines,
  footprintCells,
  parseSizeValue,
} from "../src/size.js";

const kv = (key: string, value: string) => ({ key, value, origin: "test" });
const line = (text: string) => ({ text, origin: "test" });

describe("parseSizeValue", () => {
  it.each([
    ["Large", "large"],
    ["  MEDIUM  ", "medium"],
    ["gargantuan", "gargantuan"],
    ["Huge (15 ft.)", "huge"],
    ["Medium or Small", "medium"],
    ["tiny.", "tiny"],
    ["L", "large"],
    ["g", "gargantuan"],
    ["Small ", "small"],
  ])("parses %j", (input, expected) => {
    expect(parseSizeValue(input)).toBe(expected);
  });

  it.each(["", "big", "smallish", "XL", "10 ft", "very large"])("rejects %j", (input) => {
    expect(parseSizeValue(input)).toBeNull();
  });
});

describe("detectSizeFromKeyValues", () => {
  it("finds a Size row regardless of key case and punctuation", () => {
    const r = detectSizeFromKeyValues([kv("Type", "Dragon"), kv(" size: ", "Large")]);
    expect(r).toMatchObject({ category: "large", source: "keyValue", raw: "Large" });
  });

  it("ignores rows with other keys that mention a size", () => {
    expect(detectSizeFromKeyValues([kv("Description", "A large dragon")])).toBeNull();
  });

  it("skips an unparseable Size row and keeps looking", () => {
    const r = detectSizeFromKeyValues([kv("Size", "varies"), kv("Creature size", "Huge")]);
    expect(r?.category).toBe("huge");
  });
});

describe("detectSizeFromLines", () => {
  it.each([
    ["Size: Medium", "medium", "field"],
    ["size - large", "large", "field"],
    ["Size — Gargantuan", "gargantuan", "field"],
    ["Large dragon, chaotic evil", "large", "statblock"],
    ["Medium humanoid (any race), any alignment", "medium", "statblock"],
    ["Medium or Small Humanoid (Elf), Neutral", "medium", "statblock"],
    ["Huge Giant, Typically Neutral Evil", "huge", "statblock"],
    ["Medium swarm of Tiny beasts, unaligned", "medium", "statblock"],
    ["Tiny fey, neutral good", "tiny", "statblock"],
  ])("detects %j", (text, category, source) => {
    expect(detectSizeFromLines([line(text)])).toMatchObject({ category, source });
  });

  it.each([
    "The dragon is large and terrifying.",
    "A large crowd gathered at the gates, chaotic and loud.",
    "Large creatures, such as ogres, are common here.",
    "Our small band of heroes, lawful to a fault, pressed on.",
    "In the marsh a huge dragon, chaotic evil by all accounts, slept for a hundred years while the kingdom above it fell to ruin and was rebuilt.",
    "Sizeable treasure awaits.",
  ])("does not treat prose as a size: %j", (text) => {
    expect(detectSizeFromLines([line(text)])).toBeNull();
  });

  it("prefers an explicit Size field over a statblock line anywhere on the page", () => {
    const r = detectSizeFromLines([line("Large dragon, chaotic evil"), line("Size: Huge")]);
    expect(r?.category).toBe("huge");
  });
});

describe("detectSize", () => {
  it("prefers structured key/value data over text", () => {
    const r = detectSize([kv("Size", "Small")], [line("Size: Huge")]);
    expect(r).toMatchObject({ category: "small", source: "keyValue" });
  });

  it("returns null when nothing is found", () => {
    expect(detectSize([], [line("A quiet village.")])).toBeNull();
  });
});

describe("footprintCells", () => {
  it("maps the standard categories", () => {
    expect(footprintCells("tiny")).toBe(0.5);
    expect(footprintCells("small")).toBe(1);
    expect(footprintCells("medium")).toBe(1);
    expect(footprintCells("large")).toBe(2);
    expect(footprintCells("huge")).toBe(3);
    expect(footprintCells("gargantuan")).toBe(4);
  });

  it("allows larger gargantuan creatures and clamps nonsense", () => {
    expect(footprintCells("gargantuan", { gargantuanCells: 6 })).toBe(6);
    expect(footprintCells("gargantuan", { gargantuanCells: 999 })).toBe(20);
    expect(footprintCells("tiny", { tinyCells: Number.NaN })).toBe(1);
  });
});
