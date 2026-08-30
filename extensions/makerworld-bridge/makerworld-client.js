(() => {
  const API_PREFIX = "/api/v1/design-service";
  const CLIENT_HEADERS = {
    "Accept": "application/json",
    "X-BBL-Client-Type": "web",
    "X-BBL-Client-Version": "00.00.00.01",
    "X-BBL-App-Source": "makerworld",
    "X-BBL-Client-Name": "MakerWorld",
  };

  class MakerWorldBridgeError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  function allowedSignedUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:"
        && host.endsWith(".bblmw.com")
        && host.length > ".bblmw.com".length
        && Boolean(url.search);
    } catch {
      return false;
    }
  }

  function safeFilename(value, fallback) {
    const leaf = String(value || "").split(/[\\/]/).pop() || "";
    const cleaned = leaf
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return (cleaned || fallback).slice(0, 180);
  }

  function filenameFromUrl(rawUrl, fallback) {
    try {
      return safeFilename(decodeURIComponent(new URL(rawUrl).pathname.split("/").pop() || ""), fallback);
    } catch {
      return fallback;
    }
  }

  function firstArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    for (const key of ["instances", "hits", "list", "items", "data"]) {
      const candidate = value[key];
      if (Array.isArray(candidate)) return candidate;
      if (candidate && typeof candidate === "object") {
        const nested = firstArray(candidate);
        if (nested.length > 0) return nested;
      }
    }
    return [];
  }

  function instanceId(value) {
    const id = Number(value?.id ?? value?.instanceId ?? value?.instance_id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function instanceName(value, id) {
    return safeFilename(
      value?.title ?? value?.name ?? value?.displayName,
      `MakerWorld profile ${id}`
    );
  }

  function instancePrinter(value) {
    return value?.extention?.modelInfo?.compatibility?.devModelName
      ?? value?.extension?.modelInfo?.compatibility?.devModelName
      ?? "";
  }

  function collectSignedEntries(payload, sourceKeyBase, fallbackName) {
    const results = [];
    const seen = new Set();
    const visit = (value, inheritedName) => {
      if (Array.isArray(value)) {
        value.forEach(item => visit(item, inheritedName));
        return;
      }
      if (!value || typeof value !== "object") return;

      const ownName = value.name
        ?? value.fileName
        ?? value.filename
        ?? value.modelName
        ?? value.title
        ?? inheritedName;
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === "string" && /url|link/i.test(key) && allowedSignedUrl(child)) {
          if (seen.has(child)) continue;
          seen.add(child);
          results.push({
            source_key: `${sourceKeyBase}:${results.length}`,
            filename: safeFilename(ownName || filenameFromUrl(child, fallbackName), fallbackName),
            url: child,
          });
        } else if (child && typeof child === "object") {
          visit(child, ownName);
        }
      }
    };
    visit(payload, fallbackName);
    return results;
  }

  async function fetchJson(path, query) {
    const url = new URL(`${API_PREFIX}${path}`, window.location.origin);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: CLIENT_HEADERS,
      redirect: "follow",
    });
    if (response.status === 401 || response.status === 403) {
      throw new MakerWorldBridgeError(
        "makerworld_sign_in_required",
        "Sign in to MakerWorld in this Safari tab, then retry from Workshop."
      );
    }
    if (response.status === 418 || response.status === 429) {
      throw new MakerWorldBridgeError(
        "makerworld_challenge",
        "MakerWorld requested a verification challenge. Complete it in this tab, then retry."
      );
    }
    if (!response.ok) {
      throw new MakerWorldBridgeError(
        "makerworld_request_failed",
        `MakerWorld returned ${response.status}.`
      );
    }
    try {
      return await response.json();
    } catch {
      throw new MakerWorldBridgeError(
        "makerworld_invalid_response",
        "MakerWorld returned an invalid download response."
      );
    }
  }

  async function collect(designId) {
    const normalizedId = String(designId ?? "");
    if (!/^\d+$/.test(normalizedId)) {
      throw new MakerWorldBridgeError("invalid_design", "MakerWorld model ID is invalid.");
    }

    const design = await fetchJson(`/design/${normalizedId}`);
    const title = safeFilename(design?.title, `MakerWorld model ${normalizedId}`);
    const warnings = [];
    const instances = Array.isArray(design?.instances) ? [...design.instances] : [];
    try {
      const fullInstances = firstArray(await fetchJson(`/design/${normalizedId}/instances`));
      instances.push(...fullInstances);
    } catch (error) {
      if (error.code === "makerworld_sign_in_required") throw error;
      warnings.push(`Complete print-profile list: ${error.message}`);
    }

    const assets = [];
    try {
      const rawModel = await fetchJson(`/design/${normalizedId}/model`);
      assets.push(...collectSignedEntries(
        rawModel,
        `design:${normalizedId}:model`,
        `${title} source files.zip`
      ));
    } catch (error) {
      if (error.code === "makerworld_sign_in_required") throw error;
      warnings.push(`Raw source bundle: ${error.message}`);
    }

    const uniqueInstances = [];
    const seenIds = new Set();
    for (const instance of instances) {
      const id = instanceId(instance);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      uniqueInstances.push({ id, value: instance });
    }

    for (const [index, entry] of uniqueInstances.entries()) {
      const name = instanceName(entry.value, entry.id);
      try {
        const profile = await fetchJson(`/instance/${entry.id}/f3mf`, {
          type: "download",
          fileType: "",
          devModelName: instancePrinter(entry.value) || undefined,
        });
        const entries = collectSignedEntries(
          profile,
          `instance:${entry.id}`,
          `${name}.3mf`
        );
        if (entries.length === 0) {
          warnings.push(`${name}: MakerWorld returned no signed file URL.`);
        } else {
          assets.push(...entries);
        }
      } catch (error) {
        if (error.code === "makerworld_sign_in_required") throw error;
        warnings.push(`${name}: ${error.message}`);
      }
      if (index < uniqueInstances.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    const uniqueAssets = [];
    const seenKeys = new Set();
    for (const asset of assets) {
      const base = asset.source_key.replace(/:\d+$/, "");
      const sourceKey = seenKeys.has(base) ? asset.source_key : base;
      if (seenKeys.has(sourceKey)) continue;
      seenKeys.add(sourceKey);
      uniqueAssets.push({ ...asset, source_key: sourceKey });
    }
    if (uniqueAssets.length === 0) {
      throw new MakerWorldBridgeError(
        "makerworld_no_files",
        "MakerWorld did not provide any signed model-file URLs."
      );
    }
    return { designId: normalizedId, assets: uniqueAssets, warnings };
  }

  globalThis.WorkshopMakerWorldClient = {
    MakerWorldBridgeError,
    allowedSignedUrl,
    collectSignedEntries,
    collect,
    safeFilename,
  };
})();
