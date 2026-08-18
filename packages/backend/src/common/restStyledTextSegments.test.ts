import { describe, expect, it } from "vitest";
import { resolveStyledTextSegmentsFromRest } from "./restStyledTextSegments";
import type { TextNode } from "../api_types";

const baseNode = (
  overrides: Partial<
    Pick<
      TextNode,
      | "characters"
      | "style"
      | "characterStyleOverrides"
      | "styleOverrideTable"
      | "lineTypes"
      | "lineIndentations"
    >
  >,
) => ({
  characters: "",
  style: { fontFamily: "Inter", fontSize: 16, fontWeight: 400 },
  characterStyleOverrides: [],
  styleOverrideTable: {},
  lineTypes: [],
  lineIndentations: [],
  ...overrides,
});

describe("resolveStyledTextSegmentsFromRest", () => {
  it("returns no segments for empty text", () => {
    expect(
      resolveStyledTextSegmentsFromRest(baseNode({}), ["fontSize"]),
    ).toEqual([]);
  });

  it("returns a single run covering the whole string when there are no overrides", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({ characters: "hello" }),
      ["fontSize", "fontWeight"],
    );

    expect(segments).toEqual([
      {
        characters: "hello",
        start: 0,
        end: 5,
        fontSize: 16,
        fontWeight: 400,
      },
    ]);
  });

  it("splits into runs at override boundaries", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "bold text",
        characterStyleOverrides: [1, 1, 1, 1, 0, 0, 0, 0, 0],
        styleOverrideTable: { "1": { fontWeight: 700 } },
      }),
      ["fontWeight"],
    );

    expect(segments).toEqual([
      { characters: "bold", start: 0, end: 4, fontWeight: 700 },
      { characters: " text", start: 4, end: 9, fontWeight: 400 },
    ]);
  });

  it("falls back to the base style when the override array is shorter than the text", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "ab",
        characterStyleOverrides: [1],
        styleOverrideTable: { "1": { fontWeight: 700 } },
      }),
      ["fontWeight"],
    );

    expect(segments).toEqual([
      { characters: "a", start: 0, end: 1, fontWeight: 700 },
      { characters: "b", start: 1, end: 2, fontWeight: 400 },
    ]);
  });

  it("splits into a run per line when indentation or listOptions changes at a line boundary", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "one\ntwo",
        lineTypes: ["ORDERED", "UNORDERED"],
        lineIndentations: [0, 2],
      }),
      ["indentation", "listOptions"],
    );

    expect(segments).toEqual([
      {
        characters: "one\n",
        start: 0,
        end: 4,
        indentation: 0,
        listOptions: { type: "ORDERED" },
      },
      {
        characters: "two",
        start: 4,
        end: 7,
        indentation: 2,
        listOptions: { type: "UNORDERED" },
      },
    ]);
  });

  it("keeps one run across a line boundary when indentation and listOptions are unchanged", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "one\ntwo",
        lineTypes: ["NONE", "NONE"],
        lineIndentations: [0, 0],
      }),
      ["indentation", "listOptions"],
    );

    expect(segments).toEqual([
      {
        characters: "one\ntwo",
        start: 0,
        end: 7,
        indentation: 0,
        listOptions: { type: "NONE" },
      },
    ]);
  });

  it("indexes line metadata by UTF-16 code unit, not Unicode code point", () => {
    // "😀" is a surrogate pair — 1 code point, 2 UTF-16 units. The override
    // boundary below lands exactly on the "\n" (UTF-16 index 2). A
    // code-point-indexed line array is one short there and misreads that
    // run as already being on line 1, instead of the line the "\n" itself
    // still belongs to.
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "😀\ntwo",
        characterStyleOverrides: [0, 0, 1, 1, 1, 1],
        styleOverrideTable: { "1": { fontWeight: 700 } },
        lineTypes: ["ORDERED", "UNORDERED"],
        lineIndentations: [0, 2],
      }),
      ["fontWeight", "indentation", "listOptions"],
    );

    expect(segments).toEqual([
      {
        characters: "😀",
        start: 0,
        end: 2,
        fontWeight: 400,
        indentation: 0,
        listOptions: { type: "ORDERED" },
      },
      {
        // The override boundary lands exactly on "\n" (UTF-16 index 2) —
        // it still reports line 0's metadata, proving the "\n" itself was
        // correctly attributed to line 0 and not line 1.
        characters: "\n",
        start: 2,
        end: 3,
        fontWeight: 700,
        indentation: 0,
        listOptions: { type: "ORDERED" },
      },
      {
        // "two" starts on line 1, whose metadata differs from line 0's —
        // that's a separate run split (line-boundary fix), not the bug
        // under test here.
        characters: "two",
        start: 3,
        end: 6,
        fontWeight: 700,
        indentation: 2,
        listOptions: { type: "UNORDERED" },
      },
    ]);
  });

  it("translates FONT_SIZE_% line height into the plugin's PERCENT shape", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "x",
        style: {
          fontFamily: "Inter",
          lineHeightUnit: "FONT_SIZE_%",
          lineHeightPercentFontSize: 150,
        },
      }),
      ["lineHeight"],
    );

    expect(segments).toEqual([
      {
        characters: "x",
        start: 0,
        end: 1,
        lineHeight: { value: 150, unit: "PERCENT" },
      },
    ]);
  });

  it("translates INTRINSIC_% line height into the plugin's AUTO shape", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "x",
        style: { fontFamily: "Inter", lineHeightUnit: "INTRINSIC_%" },
      }),
      ["lineHeight"],
    );

    expect(segments).toEqual([
      { characters: "x", start: 0, end: 1, lineHeight: { unit: "AUTO" } },
    ]);
  });

  it("defaults letterSpacing to a zero PIXELS value when absent", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({ characters: "x" }),
      ["letterSpacing"],
    );

    expect(segments).toEqual([
      {
        characters: "x",
        start: 0,
        end: 1,
        letterSpacing: { value: 0, unit: "PIXELS" },
      },
    ]);
  });

  it("leaves textStyleId and fillStyleId undefined since the REST schema has no equivalent", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({ characters: "x" }),
      ["textStyleId", "fillStyleId"],
    );

    expect(segments).toEqual([
      {
        characters: "x",
        start: 0,
        end: 1,
        textStyleId: undefined,
        fillStyleId: undefined,
      },
    ]);
  });

  it("converts hyperlink url/nodeID into the plugin's value field", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "x",
        style: {
          fontFamily: "Inter",
          hyperlink: { type: "URL", url: "https://example.com" },
        },
      }),
      ["hyperlink"],
    );

    expect(segments).toEqual([
      {
        characters: "x",
        start: 0,
        end: 1,
        hyperlink: { type: "URL", value: "https://example.com" },
      },
    ]);
  });

  it("converts opentypeFlags 1/0 map into a boolean map", () => {
    const segments = resolveStyledTextSegmentsFromRest(
      baseNode({
        characters: "x",
        style: {
          fontFamily: "Inter",
          opentypeFlags: { LIGA: 1, SMCP: 0 },
        },
      }),
      ["openTypeFeatures"],
    );

    expect(segments).toEqual([
      {
        characters: "x",
        start: 0,
        end: 1,
        openTypeFeatures: { LIGA: true, SMCP: false },
      },
    ]);
  });
});
