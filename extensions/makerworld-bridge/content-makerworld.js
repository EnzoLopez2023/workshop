const extensionApi = globalThis.browser ?? globalThis.chrome;

if (!globalThis.__workshopMakerWorldListenerInstalled) {
  globalThis.__workshopMakerWorldListenerInstalled = true;
  extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "WORKSHOP_MAKERWORLD_COLLECT") return false;
    globalThis.WorkshopMakerWorldClient.collect(message.designId, {
      existingSourceKeys: message.existingSourceKeys,
    })
      .then(result => {
        sendResponse({
          ok: true,
          designId: result.designId,
          assets: result.assets,
          warnings: result.warnings,
          upToDate: result.upToDate,
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
}
