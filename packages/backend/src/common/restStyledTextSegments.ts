import type { TextNode, TypeStyle } from "../api_types";
import type { StyledTextSegmentField } from "../host";
import type { StyledTextSegmentSubset } from "types";

type LineType = TextNode["lineTypes"][number];

type FullSegmentValues = {
  characters: string;
  start: number;
  end: number;
  fontName: { family: string; style: string };
  fontSize: number;
  fontWeight: number;
  fills: TypeStyle["fills"];
  hyperlink: { type: "URL" | "NODE"; value: string } | null;
  indentation: number;
  letterSpacing: { value: number; unit: "PIXELS" };
  lineHeight:
    | { value: number; unit: "PIXELS" | "PERCENT" }
    | { unit: "AUTO" };
  listOptions: { type: LineType };
  textCase:
    | "ORIGINAL"
    | "UPPER"
    | "LOWER"
    | "TITLE"
    | "SMALL_CAPS"
    | "SMALL_CAPS_FORCED";
  textDecoration: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textStyleId: undefined;
  fillStyleId: undefined;
  openTypeFeatures: Record<string, boolean>;
};

const mergeStyle = (
  base: TypeStyle,
  override: TypeStyle | undefined,
): TypeStyle => (override ? { ...base, ...override } : base);

const lineIndexPerCharacter = (characters: string): number[] => {
  const lines: number[] = [];
  let line = 0;
  for (const ch of characters) {
    lines.push(line);
    if (ch === "\n") line++;
  }
  return lines;
};

const translateLineHeight = (
  style: TypeStyle,
): FullSegmentValues["lineHeight"] => {
  switch (style.lineHeightUnit) {
    case "FONT_SIZE_%":
      return {
        value: style.lineHeightPercentFontSize ?? 100,
        unit: "PERCENT",
      };
    case "INTRINSIC_%":
      return { unit: "AUTO" };
    case "PIXELS":
    default:
      return { value: style.lineHeightPx ?? 0, unit: "PIXELS" };
  }
};

const buildFullSegment = (
  characters: string,
  start: number,
  end: number,
  style: TypeStyle,
  lineIndex: number,
  lineTypes: ReadonlyArray<LineType>,
  lineIndentations: ReadonlyArray<number>,
): FullSegmentValues => ({
  characters,
  start,
  end,
  fontName: {
    family: style.fontFamily ?? "",
    style: style.fontStyle ?? (style.italic ? "Italic" : "Regular"),
  },
  fontSize: style.fontSize ?? 0,
  fontWeight: style.fontWeight ?? 400,
  fills: style.fills ?? [],
  hyperlink: style.hyperlink
    ? {
        type: style.hyperlink.type,
        value: style.hyperlink.url ?? style.hyperlink.nodeID ?? "",
      }
    : null,
  indentation: lineIndentations[lineIndex] ?? 0,
  letterSpacing: { value: style.letterSpacing ?? 0, unit: "PIXELS" },
  lineHeight: translateLineHeight(style),
  listOptions: { type: lineTypes[lineIndex] ?? "NONE" },
  textCase: style.textCase ?? "ORIGINAL",
  textDecoration: style.textDecoration ?? "NONE",
  // The REST API only exposes resolved TypeStyle values, never the id of
  // the TextStyle/PaintStyle a run is linked to — there is no field on
  // TypeStyle that carries it, so these can't be reconstructed from JSON.
  textStyleId: undefined,
  fillStyleId: undefined,
  openTypeFeatures: Object.fromEntries(
    Object.entries(style.opentypeFlags ?? {}).map(([feature, flag]) => [
      feature,
      flag === 1,
    ]),
  ),
});

type RestTextSegmentSource = Pick<
  TextNode,
  | "characters"
  | "style"
  | "characterStyleOverrides"
  | "styleOverrideTable"
  | "lineTypes"
  | "lineIndentations"
>;

/**
 * Pure REST-JSON equivalent of `figmaNode.getStyledTextSegments(fields)` —
 * decodes a TEXT node's `characterStyleOverrides`/`styleOverrideTable` into
 * per-run segments instead of calling the live plugin API. Groups
 * consecutive characters that share an override index into one run, merges
 * that run's style with the node's base `style`, and joins `lineTypes`/
 * `lineIndentations` by line for `listOptions`/`indentation`.
 *
 * `textStyleId`/`fillStyleId` are always `undefined` — the REST API has no
 * field carrying them. `fontName.style` is approximated from `fontStyle`/
 * `italic` since the plugin's resolved display string (e.g. "Bold Italic")
 * isn't present either.
 */
export const resolveStyledTextSegmentsFromRest = (
  node: RestTextSegmentSource,
  fields: StyledTextSegmentField[],
): StyledTextSegmentSubset[] => {
  const { characters } = node;
  if (characters.length === 0) return [];

  const lineIndex = lineIndexPerCharacter(characters);
  const overrides = node.characterStyleOverrides ?? [];
  const keys = ["characters", "start", "end", ...fields] as const;

  const segments: StyledTextSegmentSubset[] = [];
  let runStart = 0;
  let runOverride = overrides[0] ?? 0;

  const flushRun = (end: number) => {
    const overrideStyle =
      runOverride === 0
        ? undefined
        : node.styleOverrideTable[String(runOverride)];
    const merged = mergeStyle(node.style, overrideStyle);
    const full = buildFullSegment(
      characters.slice(runStart, end),
      runStart,
      end,
      merged,
      lineIndex[runStart] ?? 0,
      node.lineTypes,
      node.lineIndentations,
    );
    const picked: Record<string, unknown> = {};
    for (const key of keys) {
      picked[key] = (full as unknown as Record<string, unknown>)[key];
    }
    segments.push(picked as unknown as StyledTextSegmentSubset);
  };

  for (let i = 1; i < characters.length; i++) {
    const index = overrides[i] ?? 0;
    if (index !== runOverride) {
      flushRun(i);
      runStart = i;
      runOverride = index;
    }
  }
  flushRun(characters.length);

  return segments;
};
