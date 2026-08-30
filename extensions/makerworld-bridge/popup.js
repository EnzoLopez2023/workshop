const extensionApi = globalThis.browser ?? globalThis.chrome;

function tabsQuery(query) {
  if (globalThis.browser) return globalThis.browser.tabs.query(query);
  return new Promise(resolve => extensionApi.tabs.query(query, resolve));
}

tabsQuery({ active: true, currentWindow: true }).then(tabs => {
  const current = tabs[0]?.url ?? "";
  const status = document.getElementById("status");
  if (current.startsWith("https://makerworld.com/")) {
    status.textContent = "MakerWorld is open. Return to the Workshop project and start the import.";
  } else if (current.startsWith("https://workshop.nintek.com/")) {
    status.textContent = "Ready. Open a MakerWorld Bambu project and choose Import from MakerWorld.";
  }
});
