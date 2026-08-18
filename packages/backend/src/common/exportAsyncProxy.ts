import { postConversionStart } from "../messaging";
import { getBackendHost } from "../host";

let isRunning = false;

/*
 * This is a wrapper for exportAsync() This allows us to pass a message to the UI every time
 * this rather costly operation gets run so that it can display a loading message. This avoids
 * showing a loading message every time anything in the UI changes and only showing it when
 * exportAsync() is called.
 */
export const exportAsyncProxy = async <
  T extends string | Uint8Array = Uint8Array /* | Object */,
>(
  node: SceneNode,
  settings: ExportSettings | ExportSettingsSVGString /*| ExportSettingsREST*/,
): Promise<T> => {
  if (isRunning === false) {
    isRunning = true;
    postConversionStart();
    // force postMessage to run right now.
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  const result = await getBackendHost().getNodeExport(node.id, settings);

  isRunning = false;
  return result as T;
};
