const extensionApi = globalThis.browser ?? globalThis.chrome;

const WORKSHOP_ORIGINS = new Set([
  "https://workshop.nintek.com",
  "https://app-workshop-prod-lwxhu7jxlrbtu.azurewebsites.net",
]);

function runtimeError() {
  return globalThis.chrome?.runtime?.lastError?.message ?? null;
}

function tabsQuery(query) {
  if (globalThis.browser) return globalThis.browser.tabs.query(query);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.query(query, tabs => {
      const error = runtimeError();
      if (error) reject(new Error(error));
      else resolve(tabs);
    });
  });
}

function tabsCreate(options) {
  if (globalThis.browser) return globalThis.browser.tabs.create(options);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.create(options, tab => {
      const error = runtimeError();
      if (error) reject(new Error(error));
      else resolve(tab);
    });
  });
}

function tabsUpdate(tabId, options) {
  if (globalThis.browser) return globalThis.browser.tabs.update(tabId, options);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.update(tabId, options, tab => {
      const error = runtimeError();
      if (error) reject(new Error(error));
      else resolve(tab);
    });
  });
}

function tabsRemove(tabId) {
  if (globalThis.browser) return globalThis.browser.tabs.remove(tabId);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.remove(tabId, () => {
      const error = runtimeError();
      if (error) reject(new Error(error));
      else resolve();
    });
  });
}

function tabsSendMessage(tabId, message) {
  if (globalThis.browser) return globalThis.browser.tabs.sendMessage(tabId, message);
  return new Promise((resolve, reject) => {
    extensionApi.tabs.sendMessage(tabId, message, response => {
      const error = runtimeError();
      if (error) reject(new Error(error));
      else resolve(response);
    });
  });
}

function isMakerWorldUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return host === "makerworld.com";
  } catch {
    return false;
  }
}

function validateWorkshopSubmitUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!WORKSHOP_ORIGINS.has(url.origin)) {
    throw new Error("Workshop bridge target is not allowed.");
  }
  if (!/^\/api\/extensions\/makerworld-import\/[0-9a-f-]+$/i.test(url.pathname)) {
    throw new Error("Workshop bridge target is invalid.");
  }
  return url;
}

async function waitForTab(tabId, timeoutMs = 30_000) {
  const tabs = await tabsQuery({});
  const current = tabs.find(tab => tab.id === tabId);
  if (current?.status === "complete") return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      extensionApi.tabs.onUpdated.removeListener(listener);
      reject(new Error("MakerWorld took too long to open."));
    }, timeoutMs);
    const listener = (updatedId, changeInfo) => {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      extensionApi.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    extensionApi.tabs.onUpdated.addListener(listener);
  });
}

async function makerWorldTab(sourceUrl) {
  const created = await tabsCreate({ url: sourceUrl, active: true });
  if (created.id == null) throw new Error("Safari did not create the MakerWorld tab.");
  await waitForTab(created.id);
  return created;
}

async function collectFromTab(tabId, payload) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await tabsSendMessage(tabId, {
        type: "WORKSHOP_MAKERWORLD_COLLECT",
        designId: payload.designId,
        existingSourceKeys: payload.existingSourceKeys ?? [],
      });
      if (response) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw lastError ?? new Error("The MakerWorld bridge did not load in the tab.");
}

async function runImport(payload, workshopTabId) {
  if (!payload || typeof payload !== "object") throw new Error("Workshop sent an invalid import.");
  if (!/^\d+$/.test(String(payload.designId ?? ""))) throw new Error("MakerWorld model ID is invalid.");
  if (!isMakerWorldUrl(payload.sourceUrl)) throw new Error("MakerWorld source URL is invalid.");
  const submitUrl = validateWorkshopSubmitUrl(payload.submitUrl);
  const tab = await makerWorldTab(payload.sourceUrl);
  const collected = await collectFromTab(tab.id, payload);

  if (!collected.ok) {
    const error = new Error(collected.error || "MakerWorld did not provide download links.");
    error.code = collected.code;
    throw error;
  }
  const response = await fetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: payload.token,
      design_id: String(payload.designId),
      assets: collected.assets,
      warnings: collected.warnings ?? [],
      up_to_date: collected.upToDate === true,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Workshop rejected the import (${response.status}).`);

  await tabsRemove(tab.id).catch(() => {});
  if (workshopTabId != null) {
    await tabsUpdate(workshopTabId, { active: true }).catch(() => {});
  }
  return {
    ok: true,
    status: collected.upToDate ? "reconciling" : result.status,
    assetCount: collected.assets.length,
    warnings: collected.warnings ?? [],
  };
}

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "WORKSHOP_MAKERWORLD_IMPORT") return false;
  runImport(message.payload, sender.tab?.id)
    .then(sendResponse)
    .catch(error => {
      sendResponse({
        ok: false,
        code: error.code ?? "bridge_failed",
        error: error.message || "MakerWorld bridge failed.",
      });
    });
  return true;
});
