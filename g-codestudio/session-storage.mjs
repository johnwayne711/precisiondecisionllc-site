export const SESSION_STORAGE_KEYS = Object.freeze({
  legacyJob: "verify.session.v1",
  preferences: "verify.preferences.v1",
  rememberChoice: "verify.rememberJob.v1",
  rememberedJob: "verify.rememberedJob.v1",
});

export const PRIVATE_PREFERENCE_IDS = Object.freeze([
  "displayUnits",
  "graphicsQuality",
  "toolpathToggle",
]);

const APPLICATION_STORAGE_PREFIX = "verify.";

function storageGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageRemove(storage, key) {
  try {
    storage?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function storageSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function parseObject(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function privatePreferencesOnly(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  const preferences = {};
  for (const id of PRIVATE_PREFERENCE_IDS) {
    const value = candidate[id];
    if (typeof value === "string" || typeof value === "boolean") preferences[id] = value;
  }
  return preferences;
}

export function readPrivatePreferences(storage) {
  return privatePreferencesOnly(parseObject(storageGet(storage, SESSION_STORAGE_KEYS.preferences)));
}

export function writePrivatePreferences(storage, preferences) {
  return storageSet(
    storage,
    SESSION_STORAGE_KEYS.preferences,
    JSON.stringify(privatePreferencesOnly(preferences)),
  );
}

export function migrateLegacySession(storage) {
  const legacy = storageGet(storage, SESSION_STORAGE_KEYS.legacyJob);
  if (legacy === null) return {removed: false, preferencesMigrated: false};

  // Erase the old program-bearing record before parsing or migrating anything.
  storageRemove(storage, SESSION_STORAGE_KEYS.legacyJob);
  const saved = parseObject(legacy);
  const existingPreferences = storageGet(storage, SESSION_STORAGE_KEYS.preferences);
  const safePreferences = privatePreferencesOnly(saved?.preferences);
  const preferencesMigrated = existingPreferences === null
    && Object.keys(safePreferences).length > 0
    && writePrivatePreferences(storage, safePreferences);
  return {removed: true, preferencesMigrated};
}

export function isRememberJobEnabled(storage) {
  return storageGet(storage, SESSION_STORAGE_KEYS.rememberChoice) === "true";
}

export function setRememberJobEnabled(storage, enabled) {
  if (!enabled) {
    storageRemove(storage, SESSION_STORAGE_KEYS.rememberedJob);
    storageRemove(storage, SESSION_STORAGE_KEYS.rememberChoice);
    storageRemove(storage, SESSION_STORAGE_KEYS.legacyJob);
    return true;
  }
  return storageSet(storage, SESSION_STORAGE_KEYS.rememberChoice, "true");
}

export function saveRememberedJob(storage, job) {
  if (!isRememberJobEnabled(storage)) {
    storageRemove(storage, SESSION_STORAGE_KEYS.rememberedJob);
    return {saved: false, reason: "private"};
  }
  if (!job || typeof job !== "object" || Array.isArray(job) || typeof job.program !== "string") {
    storageRemove(storage, SESSION_STORAGE_KEYS.rememberedJob);
    return {saved: false, reason: "invalid"};
  }
  const serialized = JSON.stringify({schemaVersion: 1, ...job});
  if (!storageSet(storage, SESSION_STORAGE_KEYS.rememberedJob, serialized)) {
    storageRemove(storage, SESSION_STORAGE_KEYS.rememberedJob);
    return {saved: false, reason: "unavailable"};
  }
  return {saved: true, reason: "saved"};
}

export function readRememberedJob(storage) {
  if (!isRememberJobEnabled(storage)) {
    storageRemove(storage, SESSION_STORAGE_KEYS.rememberedJob);
    return null;
  }
  const saved = parseObject(storageGet(storage, SESSION_STORAGE_KEYS.rememberedJob));
  if (saved?.schemaVersion === 1 && typeof saved.program === "string" && saved.program.trim()) return saved;
  setRememberJobEnabled(storage, false);
  return null;
}

function clearApplicationStorage(storage) {
  let removed = 0;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (typeof key !== "string" || !key.startsWith(APPLICATION_STORAGE_PREFIX)) continue;
      storage.removeItem(key);
      removed += 1;
    }
  } catch {
    // Hardened or disabled storage is already equivalent to an empty local record.
  }
  return removed;
}

export function clearLocalApplicationData(local, session) {
  return clearApplicationStorage(local) + clearApplicationStorage(session);
}
