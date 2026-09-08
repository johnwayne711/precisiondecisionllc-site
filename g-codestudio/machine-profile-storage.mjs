export const MACHINE_PROFILE_STORAGE_KEYS = Object.freeze({
  legacy: "verify.machineProfiles.v1",
  local: "verify.machineProfiles.local.v2",
  quarantine: "verify.quarantinedMachineProfiles.v1",
});

const LOCAL_SCHEMA_VERSION = 2;
const LOCAL_SCOPE = "device-local";

export function quarantineLegacyMachineProfileCache(storage) {
  let legacy;
  try {
    legacy = storage.getItem(MACHINE_PROFILE_STORAGE_KEYS.legacy);
  } catch {
    return {status: "unavailable"};
  }
  if (legacy === null) return {status: "none"};

  try {
    const quarantined = storage.getItem(MACHINE_PROFILE_STORAGE_KEYS.quarantine);
    if (quarantined === null) {
      storage.setItem(MACHINE_PROFILE_STORAGE_KEYS.quarantine, legacy);
    } else if (quarantined !== legacy) {
      // A stale tab may have recreated v1 after another value was quarantined.
      // Preserve both dormant records rather than overwrite or discard either.
      return {status: "conflict"};
    }
    storage.removeItem(MACHINE_PROFILE_STORAGE_KEYS.legacy);
    return {status: "quarantined"};
  } catch {
    // Never consume the unscoped value. Leaving it under the legacy key is safer
    // than deleting it before a recoverable quarantine copy has been written.
    return {status: "retained"};
  }
}

export function readLocalMachineProfiles(storage) {
  try {
    const cached = JSON.parse(storage.getItem(MACHINE_PROFILE_STORAGE_KEYS.local) || "null");
    if (cached?.schemaVersion !== LOCAL_SCHEMA_VERSION || cached?.scope !== LOCAL_SCOPE) return [];
    return Array.isArray(cached.profiles) ? cached.profiles : [];
  } catch {
    return [];
  }
}

export function writeLocalMachineProfiles(storage, profiles) {
  try {
    storage.setItem(MACHINE_PROFILE_STORAGE_KEYS.local, JSON.stringify({
      schemaVersion: LOCAL_SCHEMA_VERSION,
      scope: LOCAL_SCOPE,
      profiles,
    }));
    return true;
  } catch {
    return false;
  }
}
