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

  function providerMessage(payload) {
    if (!payload || typeof payload !== "object") return "";
    for (const key of ["error", "message", "msg"]) {
      if (typeof payload[key] === "string" && payload[key].trim()) {
        return payload[key].replace(/\s+/g, " ").trim().slice(0, 240);
      }
    }
    return "";
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
    let payload;
    try {
      payload = await response.json();
    } catch {
      if (response.status === 429) {
        throw new MakerWorldBridgeError(
          "makerworld_rate_limited",
          "MakerWorld temporarily rate-limited this profile. Wait 30 seconds, then retry; Workshop will request only missing files."
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new MakerWorldBridgeError(
          "makerworld_sign_in_required",
          "Sign in to MakerWorld in the opened tab, then retry from Workshop."
        );
      }
      if (response.status === 418) {
        throw new MakerWorldBridgeError(
          "makerworld_challenge",
          "MakerWorld requested a verification challenge. Use MakerWorld's Download button once in the opened tab, complete any prompt, then retry from Workshop."
        );
      }
      throw new MakerWorldBridgeError(
        "makerworld_invalid_response",
        `MakerWorld returned an unreadable download response (${response.status}).`
      );
    }

    const message = providerMessage(payload);
    if (response.status === 418 || /captcha|robot|verification challenge/i.test(message)) {
      throw new MakerWorldBridgeError(
        "makerworld_challenge",
        "MakerWorld requested a verification challenge. Use MakerWorld's Download button once in the opened tab, complete any prompt, then retry from Workshop."
      );
    }
    if (
      response.status === 401
      || response.status === 403
      || /(?:log|sign)\s*in|unauthenticated|unauthorized/i.test(message)
    ) {
      throw new MakerWorldBridgeError(
        "makerworld_sign_in_required",
        "Sign in to MakerWorld in the opened tab, then retry from Workshop."
      );
    }
    if (response.status === 429 || /rate.?limit|too many requests/i.test(message)) {
      throw new MakerWorldBridgeError(
        "makerworld_rate_limited",
        "MakerWorld temporarily rate-limited this profile. Wait 30 seconds, then retry; Workshop will request only missing files."
      );
    }
    if (
      !response.ok
      || payload?.success === false
      || (message && typeof payload?.code === "number" && payload.code !== 0)
    ) {
      throw new MakerWorldBridgeError(
        "makerworld_request_failed",
        message || `MakerWorld returned ${response.status}.`
      );
    }
    return payload;
  }

  async function fetchSignedEntries(path, queries, sourceKeyBase, fallbackName) {
    let lastError = null;
    for (const query of queries) {
      try {
        const payload = await fetchJson(path, query);
        const entries = collectSignedEntries(payload, sourceKeyBase, fallbackName);
        if (entries.length > 0) return entries;
        lastError = new MakerWorldBridgeError(
          "makerworld_no_signed_url",
          "MakerWorld returned no signed file URL."
        );
      } catch (error) {
        lastError = error;
        if (
          error.code === "makerworld_sign_in_required"
          || error.code === "makerworld_challenge"
          || error.code === "makerworld_rate_limited"
        ) {
          break;
        }
      }
    }
    throw lastError ?? new MakerWorldBridgeError(
      "makerworld_no_signed_url",
      "MakerWorld returned no signed file URL."
    );
  }

  function hasExistingSource(existingSourceKeys, prefix) {
    return [...existingSourceKeys].some(key => key === prefix || key.startsWith(`${prefix}:`));
  }

  async function collect(designId, options = {}) {
    const normalizedId = String(designId ?? "");
    if (!/^\d+$/.test(normalizedId)) {
      throw new MakerWorldBridgeError("invalid_design", "MakerWorld model ID is invalid.");
    }

    const design = await fetchJson(`/design/${normalizedId}`);
    const title = safeFilename(design?.title, `MakerWorld model ${normalizedId}`);
    const existingSourceKeys = new Set(
      Array.isArray(options.existingSourceKeys)
        ? options.existingSourceKeys.filter(key => typeof key === "string")
        : []
    );
    const profileDelayMs = Number.isFinite(options.profileDelayMs)
      ? Math.max(0, Number(options.profileDelayMs))
      : 1_200;
    const warnings = [];
    const failures = [];
    const instances = Array.isArray(design?.instances) ? [...design.instances] : [];
    try {
      const fullInstances = firstArray(await fetchJson(`/design/${normalizedId}/instances`));
      instances.push(...fullInstances);
    } catch (error) {
      if (error.code === "makerworld_sign_in_required") throw error;
      failures.push(error);
      warnings.push(`Complete print-profile list: ${error.message}`);
    }

    const assets = [];
    const rawFiles = design?.designExtension?.model_files
      ?? design?.designExtension?.modelFiles
      ?? [];
    const rawSourceKey = `design:${normalizedId}:model`;
    const needsRawModel = Array.isArray(rawFiles)
      && rawFiles.length > 0
      && !hasExistingSource(existingSourceKeys, rawSourceKey);
    if (needsRawModel) {
      try {
        assets.push(...await fetchSignedEntries(
          `/design/${normalizedId}/model`,
          [
            { modelType: "all", type: "download" },
            { type: "download" },
            undefined,
          ],
          rawSourceKey,
          `${title} source files.zip`
        ));
      } catch (error) {
        if (error.code === "makerworld_sign_in_required") throw error;
        failures.push(error);
        warnings.push(`Raw source bundle: ${error.message}`);
      }
    }

    const uniqueInstances = [];
    const seenIds = new Set();
    for (const instance of instances) {
      const id = instanceId(instance);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      uniqueInstances.push({ id, value: instance });
    }

    const pendingInstances = uniqueInstances.filter(entry =>
      !hasExistingSource(existingSourceKeys, `instance:${entry.id}`)
    );
    for (const [index, entry] of pendingInstances.entries()) {
      const name = instanceName(entry.value, entry.id);
      try {
        const devModelName = instancePrinter(entry.value) || undefined;
        const entries = await fetchSignedEntries(
          `/instance/${entry.id}/f3mf`,
          [
            { type: "download", fileType: "3mfstl", devModelName },
            { type: "download", fileType: "", devModelName },
            undefined,
          ],
          `instance:${entry.id}`,
          `${name}.3mf`
        );
        assets.push(...entries);
      } catch (error) {
        if (error.code === "makerworld_sign_in_required") throw error;
        failures.push(error);
        warnings.push(`${name}: ${error.message}`);
        if (
          error.code === "makerworld_challenge"
          || error.code === "makerworld_rate_limited"
        ) {
          break;
        }
      }
      if (index < pendingInstances.length - 1 && profileDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, profileDelayMs));
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
    const upToDate = !needsRawModel && pendingInstances.length === 0;
    if (uniqueAssets.length === 0 && !upToDate) {
      const actionable = failures.find(error => error.code === "makerworld_challenge")
        ?? failures.find(error => error.code === "makerworld_rate_limited");
      if (actionable) throw actionable;
      throw new MakerWorldBridgeError(
        "makerworld_no_files",
        warnings.length > 0
          ? `MakerWorld did not provide any signed model-file URLs. ${warnings.slice(0, 2).join(" ")}`
          : "MakerWorld did not provide any signed model-file URLs."
      );
    }
    return { designId: normalizedId, assets: uniqueAssets, warnings, upToDate };
  }

  globalThis.WorkshopMakerWorldClient = {
    MakerWorldBridgeError,
    allowedSignedUrl,
    collectSignedEntries,
    collect,
    safeFilename,
  };
})();
