const extensionApi = globalThis.browser ?? globalThis.chrome;

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "WORKSHOP_MAKERWORLD_COLLECT") return false;
  globalThis.WorkshopMakerWorldClient.collect(message.designId)
    .then(result => {
      sendResponse({
        ok: true,
        designId: result.designId,
        assets: result.assets,
        warnings: result.warnings,
      });
    })
    .catch(error => {
      sendResponse({
        ok: false,
        code: error.code ?? "makerworld_failed",
        error: error.message || "MakerWorld file collection failed.",
      });
    });
  return true;
});
