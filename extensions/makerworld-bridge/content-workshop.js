const extensionApi = globalThis.browser ?? globalThis.chrome;
const READY = "WORKSHOP_MAKERWORLD_BRIDGE_READY";
const PING = "WORKSHOP_MAKERWORLD_BRIDGE_PING";
const REQUEST = "WORKSHOP_MAKERWORLD_BRIDGE_REQUEST";
const RESULT = "WORKSHOP_MAKERWORLD_BRIDGE_RESULT";

function postReady() {
  const version = extensionApi.runtime.getManifest().version;
  window.postMessage({ type: READY, version }, window.location.origin);
}

function sendRuntimeMessage(message) {
  if (globalThis.browser) return globalThis.browser.runtime.sendMessage(message);
  return new Promise((resolve, reject) => {
    extensionApi.runtime.sendMessage(message, response => {
      const error = globalThis.chrome?.runtime?.lastError?.message;
      if (error) reject(new Error(error));
      else resolve(response);
    });
  });
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.type === PING) {
    postReady();
    return;
  }
  if (event.data?.type !== REQUEST || typeof event.data.requestId !== "string") return;

  const requestId = event.data.requestId;
  sendRuntimeMessage({
    type: "WORKSHOP_MAKERWORLD_IMPORT",
    payload: event.data.payload,
  })
    .then(result => {
      window.postMessage({ type: RESULT, requestId, result }, window.location.origin);
    })
    .catch(error => {
      window.postMessage({
        type: RESULT,
        requestId,
        result: { ok: false, code: "extension_failed", error: error.message },
      }, window.location.origin);
    });
});

postReady();
