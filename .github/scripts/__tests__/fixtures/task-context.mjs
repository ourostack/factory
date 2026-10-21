export const JOB = "a".repeat(32), SESSION = "3b0c1f5e-8a1d-4c2e-9f3a-1b2c3d4e5f60", HASH = "b".repeat(64);
export function record(job = JOB) {
  return {
    schema: "desk.factory.context/1", job, evaluator: { plugin_version: "3.2.0-alpha.1", rubric: "1" },
    state: "published", heading: "Restore the device connection",
    events: [
      { id: "1".repeat(16), kind: "work", lean: "support", explanation: "Checked the connection.", reason: null, prerequisite: null, resumption: null,
        confidence: "high", evidence: [{ session: SESSION, source: HASH, anchor: "interval", range: [0, 1000] }] },
      { id: "2".repeat(16), kind: "waiting", lean: "waiting", explanation: "Progress required a software update.", reason: "The installed software did not support the connection.",
        prerequisite: "Install the required software.", resumption: "Work resumed after the update.", confidence: "high",
        evidence: [{ session: SESSION, source: HASH, anchor: "interval_end", range: [0, 1000] }, { session: SESSION, source: HASH, anchor: "interval_start", range: [5000, 6000] }] },
      { id: "3".repeat(16), kind: "result", lean: "value", explanation: "The connection worked after correcting the mapping.", reason: null, prerequisite: null, resumption: null,
        confidence: "medium", evidence: [{ session: SESSION, source: HASH, anchor: "interval", range: [5000, 6000] }] },
    ],
    sources: [{ session: SESSION, sha256: HASH }],
    coverage: { state: "measured", reasons: [], omitted_events: 0 },
    privacy: { verdict: "approved", payload_sha256: HASH, reviewer: { plugin_version: "3.2.0-alpha.1", rubric: "1" } },
  };
}
export function projection(job = JOB) {
  const value = record(job);
  return { schema: "factory-task-context/1", job, availability: "published", reason: null, record: value,
    placements: value.events.map((event) => ({ event: event.id, spans: event.evidence.map((ref) => ({
      session: ref.session, start_ms: ref.anchor.endsWith("_end") ? 11000 : ref.anchor.endsWith("_start") ? 15000 : 10000 + ref.range[0],
      end_ms: ref.anchor.endsWith("_end") ? 11000 : ref.anchor.endsWith("_start") ? 15000 : 10000 + ref.range[1],
    })) })) };
}
