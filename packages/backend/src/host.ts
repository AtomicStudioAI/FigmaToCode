/**
 * Seam that lets `packages/backend` run outside the Figma plugin sandbox.
 * By default every function here reads the live `figma` global, exactly as
 * before; a host embedding this package in a non-plugin environment (no
 * `figma` global — e.g. a server converting REST API JSON) must call
 * `setBackendHost()` once before running any conversion.
 */

/** Options accepted by {@link BackendHost.getNodeExport}. */
export interface ExportRequest {
  format?: string;
  constraint?: { type: string; value: number };
}

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
      return node.exportAsync(settings as ExportSettings);
    },
    getVariableName: async (id) =>
      (await figma.variables.getVariableByIdAsync(id))?.name ?? null,
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
