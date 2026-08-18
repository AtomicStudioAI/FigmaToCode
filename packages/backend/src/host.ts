import type { Node } from "./api_types";
import type { StyledTextSegmentSubset } from "types";

/**
 * Seam that lets `packages/backend` run outside the Figma plugin sandbox.
 * By default every function here reads the live `figma` global, exactly as
 * before; a host embedding this package in a non-plugin environment (no
 * `figma` global — e.g. a server converting REST API JSON) must call
 * `setBackendHost()` once before running any conversion.
 */

/**
 * Options accepted by {@link BackendHost.getNodeExport} — the same
 * discriminated union `figma.*.exportAsync()` accepts, so a host
 * implementation gets exhaustive `format` checking for free and this
 * package never needs to cast a request past the type checker.
 */
export type ExportRequest = ExportSettings | ExportSettingsSVGString;

/** The field list accepted by `figma.*.getStyledTextSegments()`. */
export type StyledTextSegmentField = keyof Omit<
  StyledTextSegment,
  "characters" | "start" | "end"
>;

/**
 * Everything the conversion path needs from a live Figma document, made
 * pluggable. Implement this to run `packages/backend` outside the plugin
 * sandbox — e.g. backed by Figma's REST API instead of `figma.*`.
 */
export interface BackendHost {
  /** Stands in for the plugin API's `figma.mixed` sentinel. */
  mixed: symbol;
  /** Replaces `figma.getNodeByIdAsync(id).exportAsync(settings)`. */
  getNodeExport: (
    id: string,
    settings: ExportRequest,
  ) => Promise<string | Uint8Array>;
  /** Replaces `figma.variables.getVariableByIdAsync(id)?.name`. */
  getVariableName?: (id: string) => Promise<string | null>;
  /**
   * Replaces `figma.getNodeByIdAsync(id).exportAsync({format:"JSON_REST_V1"}).document`
   * — the REST-JSON document for a node subtree. A REST-backed host can
   * usually satisfy this from JSON it already fetched, with no further call.
   */
  getNodeDocument?: (id: string) => Promise<Node>;
  /**
   * Replaces `figma.getNodeByIdAsync(id).getStyledTextSegments(fields)` for
   * TEXT nodes. Figma's REST API has no direct equivalent call, but a
   * REST-backed host can derive segments from a TEXT node's
   * `characterStyleOverrides`/`styleOverrideTable` — see
   * `common/restStyledTextSegments.ts`. Hosts that leave this undefined
   * degrade to unstyled text runs rather than failing the conversion.
   */
  getStyledTextSegments?: (
    id: string,
    fields: StyledTextSegmentField[],
  ) => Promise<StyledTextSegmentSubset[]>;
}

/**
 * The host used when nobody has called `setBackendHost()`: wraps the real
 * `figma` global, so existing plugin code keeps working unchanged. Returns
 * `null` when no `figma` global exists (e.g. a server process), in which
 * case the caller must have configured a host explicitly.
 */
function defaultHost(): BackendHost | null {
  if (typeof figma === "undefined") return null;

  return {
    mixed: figma.mixed as unknown as symbol,
    getNodeExport: async (id, settings) => {
      const node = (await figma.getNodeByIdAsync(id)) as ExportMixin;
      if (node.exportAsync === undefined) {
        throw new TypeError(
          `Node ${id} doesn't have an exportAsync() function.`,
        );
      }
      // exportAsync is overloaded on the SVG_STRING/ExportSettings split
      // (string vs. Uint8Array return); narrowing on `format` — rather than
      // casting — is what selects the right overload here.
      if (settings.format === "SVG_STRING") {
        return node.exportAsync(settings);
      }
      return node.exportAsync(settings);
    },
    getVariableName: async (id) =>
      (await figma.variables.getVariableByIdAsync(id))?.name ?? null,
    getNodeDocument: async (id) => {
      const node = (await figma.getNodeByIdAsync(id)) as ExportMixin;
      if (node.exportAsync === undefined) {
        throw new TypeError(
          `Node ${id} doesn't have an exportAsync() function.`,
        );
      }
      const exported = (await node.exportAsync({
        format: "JSON_REST_V1",
      })) as unknown as { document: Node };
      return exported.document;
    },
    getStyledTextSegments: async (id, fields) => {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.type !== "TEXT") {
        throw new TypeError(`Node ${id} is not a TEXT node.`);
      }
      return node.getStyledTextSegments(
        fields,
      ) as unknown as StyledTextSegmentSubset[];
    },
  };
}

let overrideHost: BackendHost | null = null;

/**
 * Registers the host the conversion path should use going forward. Pass
 * `null` to revert to wrapping the real `figma` global.
 */
export const setBackendHost = (host: BackendHost | null): void => {
  overrideHost = host;
};

/**
 * Returns the active host: whatever was passed to `setBackendHost()`, or a
 * wrapper around the real `figma` global if nothing was set. Throws if
 * neither is available — i.e. running outside the plugin without having
 * configured a host.
 */
export const getBackendHost = (): BackendHost => {
  const host = overrideHost ?? defaultHost();
  if (!host) {
    throw new Error(
      "No backend host configured. Call setBackendHost() before running " +
        "conversion outside the Figma plugin sandbox.",
    );
  }
  return host;
};

/**
 * The active host's mixed-value sentinel, cast back to the plugin API's
 * literal sentinel type. `BackendHost.mixed` is plain `symbol` so host
 * authors outside this package don't need `@figma/plugin-typings`, but
 * callers compare `fontSize`/`fills`/etc. against this value, and
 * TypeScript only narrows `T | typeof figma.mixed` unions away from a value
 * typed as the literal `typeof figma.mixed` — not generic `symbol`.
 */
export const getMixed = (): typeof figma.mixed =>
  getBackendHost().mixed as unknown as typeof figma.mixed;
