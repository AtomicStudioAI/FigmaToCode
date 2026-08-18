import { afterEach, describe, expect, it, vi } from "vitest";
import { exportAsyncProxy } from "./exportAsyncProxy";
import { setBackendHost, type BackendHost } from "../host";

const postConversionStart = vi.hoisted(() => vi.fn());
vi.mock("../messaging", () => ({ postConversionStart }));

const node = { id: "1:1" } as SceneNode;
const settings: ExportSettings = {
  format: "PNG",
  constraint: { type: "SCALE", value: 1 },
};

afterEach(() => {
  setBackendHost(null);
  postConversionStart.mockClear();
});

describe("exportAsyncProxy", () => {
  it("resolves with the host's export result", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    setBackendHost({
      mixed: Symbol("mixed"),
      getNodeExport: async () => bytes,
    } satisfies BackendHost);

    await expect(exportAsyncProxy(node, settings)).resolves.toBe(bytes);
  });

  it("resets isRunning after a rejected export, instead of leaving later exports silently un-flagged", async () => {
    setBackendHost({
      mixed: Symbol("mixed"),
      getNodeExport: async () => {
        throw new Error("export failed");
      },
    } satisfies BackendHost);

    await expect(exportAsyncProxy(node, settings)).rejects.toThrow(
      "export failed",
    );
    expect(postConversionStart).toHaveBeenCalledTimes(1);

    setBackendHost({
      mixed: Symbol("mixed"),
      getNodeExport: async () => new Uint8Array([9]),
    } satisfies BackendHost);

    await expect(exportAsyncProxy(node, settings)).resolves.toEqual(
      new Uint8Array([9]),
    );
    // If isRunning were stuck `true` from the earlier rejection, this
    // second call would skip postConversionStart() entirely — it's called
    // again here, which is the observable proof isRunning was reset.
    expect(postConversionStart).toHaveBeenCalledTimes(2);
  });
});
