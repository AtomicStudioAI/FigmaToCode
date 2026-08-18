/**
 * Seam that lets `packages/backend` run outside the Figma plugin sandbox.
 * By default every function here reads the live `figma` global, exactly as
 * before; a host embedding this package in a non-plugin environment (no
 * `figma` global — e.g. a server converting REST API JSON) must call
 * `setBackendHost()` once before running any conversion.
 */

export interface ExportRequest {
  format?: string;
  constraint?: { type: string; value: number };
}

export interface BackendHost {
  mixed: symbol;
  getNodeExport: (
    id: string,
    settings: ExportRequest,
  ) => Promise<string | Uint8Array>;
  getVariableName?: (id: string) => Promise<string | null>;
}

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

export const setBackendHost = (host: BackendHost | null): void => {
  overrideHost = host;
};

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

// Cast back to the plugin API's literal sentinel type (BackendHost.mixed is
// plain `symbol` so host authors outside this package don't need
// @figma/plugin-typings) — callers compare fontSize/fills/etc against this,
// and TypeScript only narrows `T | typeof figma.mixed` unions away from a
// value typed as the literal `typeof figma.mixed`, not generic `symbol`.
export const getMixed = (): typeof figma.mixed =>
  getBackendHost().mixed as unknown as typeof figma.mixed;
