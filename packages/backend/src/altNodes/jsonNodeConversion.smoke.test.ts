import { describe, expect, it } from "vitest";
import { nodesToJSON } from "./jsonNodeConversion";
import { htmlMain } from "../html/htmlMain";
import { setBackendHost, type BackendHost } from "../host";
import { resolveStyledTextSegmentsFromRest } from "../common/restStyledTextSegments";
import type { PluginSettings } from "types";

const settings: PluginSettings = {
  framework: "HTML",
  showLayerNames: false,
  useOldPluginVersion2025: false,
  responsiveRoot: false,
  flutterGenerationMode: "snippet",
  swiftUIGenerationMode: "snippet",
  composeGenerationMode: "snippet",
  roundTailwindValues: true,
  roundTailwindColors: true,
  useColorVariables: false,
  customTailwindPrefix: "",
  embedImages: false,
  embedVectors: false,
  htmlGenerationMode: "html",
  tailwindGenerationMode: "jsx",
  baseFontSize: 16,
  useTailwind4: true,
  thresholdPercent: 15,
  baseFontFamily: "",
  fontFamilyCustomConfig: {},
};

// A captured-shape REST document: a FRAME containing one TEXT node, in the
// same shape Figma's `GET /v1/files/:key/nodes` returns — no plugin-only
// fields anywhere.
const frameDocument = {
  id: "1:1",
  name: "Card",
  type: "FRAME",
  visible: true,
  absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 120 },
  layoutMode: "VERTICAL",
  itemSpacing: 8,
  paddingLeft: 16,
  paddingRight: 16,
  paddingTop: 16,
  paddingBottom: 16,
  fills: [
    {
      type: "SOLID",
      color: { r: 1, g: 1, b: 1, a: 1 },
      visible: true,
      opacity: 1,
    },
  ],
  strokes: [],
  cornerRadius: 8,
  children: [
    {
      id: "1:2",
      name: "Title",
      type: "TEXT",
      visible: true,
      absoluteBoundingBox: { x: 16, y: 16, width: 288, height: 24 },
      fills: [
        {
          type: "SOLID",
          color: { r: 0, g: 0, b: 0, a: 1 },
          visible: true,
          opacity: 1,
        },
      ],
      strokes: [],
      characters: "Hello from REST JSON",
      style: { fontFamily: "Inter", fontSize: 18, fontWeight: 700 },
      characterStyleOverrides: [],
      styleOverrideTable: {},
      lineTypes: ["NONE"],
      lineIndentations: [0],
    },
  ],
} as const;

const restBackedHost: BackendHost = {
  mixed: Symbol("figma.mixed"),
  getNodeExport: async () => {
    throw new Error("getNodeExport should not be reached by this fixture");
  },
  getNodeDocument: async (id) => {
    if (id === frameDocument.id) return frameDocument as any;
    if (id === frameDocument.children[0].id)
      return frameDocument.children[0] as any;
    throw new Error(`No fixture document for node ${id}`);
  },
  getStyledTextSegments: async (id, fields) => {
    const textNode = frameDocument.children.find((child) => child.id === id);
    if (!textNode) throw new Error(`No fixture TEXT node for ${id}`);
    return resolveStyledTextSegmentsFromRest(textNode as any, fields);
  },
};

describe("default conversion pipeline outside the Figma plugin sandbox", () => {
  it("has no figma global in this environment", () => {
    expect(typeof (globalThis as any).figma).toBe("undefined");
  });

  it("converts a REST JSON document to HTML via a REST-backed BackendHost, with no figma global", async () => {
    setBackendHost(restBackedHost);
    try {
      const altNodes = await nodesToJSON([{ id: frameDocument.id }], settings);
      expect(altNodes).toHaveLength(1);

      const output = await htmlMain(altNodes as any, settings);
      expect(output.html).toContain("Hello from REST JSON");
    } finally {
      setBackendHost(null);
    }
  });

  it("throws a clear error instead of a figma ReferenceError when no host is configured", async () => {
    setBackendHost(null);
    await expect(
      nodesToJSON([{ id: frameDocument.id }], settings),
    ).rejects.toThrow(/No backend host configured/);
  });

  it("does not corrupt a cached document when converting the same node twice", async () => {
    // A REST-backed host commonly caches the parsed document and returns
    // the same object reference on every call — conversion must not mutate
    // that shared object, or a second conversion of the same node would
    // see the first conversion's already-transformed output as its input.
    const cachedDocument = structuredClone(frameDocument);
    const cachingHost: BackendHost = {
      ...restBackedHost,
      getNodeDocument: async (id) => {
        if (id === cachedDocument.id) return cachedDocument as any;
        throw new Error(`No fixture document for node ${id}`);
      },
    };

    setBackendHost(cachingHost);
    try {
      const first = await nodesToJSON([{ id: cachedDocument.id }], settings);
      const second = await nodesToJSON([{ id: cachedDocument.id }], settings);

      expect(second).toEqual(first);
      expect(cachedDocument.type).toBe("FRAME");
      expect(cachedDocument.children).toHaveLength(1);
    } finally {
      setBackendHost(null);
    }
  });
});
