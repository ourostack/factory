// Origin-local display preferences only; no identity, private detail or tracker.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FactoryPreferences = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const KEY = "factory.preferences/1";
  const keys = (x, list) => x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).every((k) => list.includes(k));
  function validZone(zone) {
    // Abbreviations such as PST are not user-selectable IANA zones.
    if (typeof zone !== "string" || (zone !== "UTC" && !zone.includes("/")) || zone.length > 80) return false;
    try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; } catch { return false; }
  }
  function validSummary(x) {
    return keys(x, ["schema", "generation", "at", "attention", "agents", "investigation"]) &&
      x.schema === "factory-overview-summary/1" && typeof x.generation === "string" &&
      /^factory-site\/3:[A-Za-z0-9:._-]{1,80}$/.test(x.generation) &&
      typeof x.at === "string" && Number.isFinite(Date.parse(x.at)) && Date.parse(x.at) <= Date.now() &&
      ["attention", "agents", "investigation"].every((k) => Array.isArray(x[k]) && x[k].length <= 64 && x[k].every((id) => typeof id === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(id)));
  }
  function valid(x) {
    return keys(x, ["schema", "dismissed", "zone", "previous"]) && x.schema === KEY &&
      typeof x.dismissed === "boolean" && validZone(x.zone) && (x.previous === null || validSummary(x.previous));
  }
  function readPreferences(storage, zone) {
    const fallback = { schema: KEY, dismissed: false, zone: validZone(zone) ? zone : "UTC", previous: null, persistent: false };
    try {
      if (!storage || typeof storage.getItem !== "function") return fallback;
      const raw = storage.getItem(KEY);
      if (raw === null) return { ...fallback, persistent: true };
      if (typeof raw !== "string" || raw.length > 32768) return fallback;
      const x = JSON.parse(raw);
      return valid(x) ? { ...x, persistent: true } : fallback;
    } catch { return fallback; }
  }
  // `deviceZone` is the zone in effect when nothing is saved yet, so saving
  // another preference never pins the display to UTC behind the reader's back.
  function savePreferences(storage, patch, deviceZone) {
    try {
      if (!keys(patch, ["dismissed", "zone", "previous"])) return { saved: false, reason: "invalid_preferences" };
      const prior = readPreferences(storage, validZone(deviceZone) ? deviceZone : "UTC");
      const { persistent, ...value } = { ...prior, ...patch };
      if (!valid(value)) return { saved: false, reason: "invalid_preferences" };
      if (!storage || typeof storage.setItem !== "function") return { saved: false, reason: "storage_unavailable" };
      storage.setItem(KEY, JSON.stringify(value));
      return { saved: true, reason: null };
    } catch { return { saved: false, reason: "storage_unavailable" }; }
  }
  return { readPreferences, savePreferences, validZone, validSummary };
});
