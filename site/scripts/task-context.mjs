import { createRequire } from "node:module";
const { validateTaskContext } = createRequire(import.meta.url)("../src/task-context.js");

export function projectTaskContext({ job, bytes, facts, validateContextBytes, checkContextAgainstFacts }) {
  const unavailable = (reason) => ({ schema: "factory-task-context/1", job, availability: "unavailable", reason, record: null, placements: [] });
  if (bytes === null) return unavailable("not_published");
  if (typeof validateContextBytes !== "function" || typeof checkContextAgainstFacts !== "function") return unavailable("canonical_source_unavailable");
  if (!validateContextBytes(bytes).ok) return unavailable("invalid_context");
  const record = JSON.parse(bytes.toString("utf8"));
  if (record.job !== job) return unavailable("invalid_context");
  if (!checkContextAgainstFacts(record, facts).ok) return unavailable("source_changed");
  const placements = record.events.map((event) => ({
    event: event.id,
    spans: event.evidence.map((ref) => {
      const source = facts.find((entry) => entry.session.id === ref.session);
      const offset = source.jobs.find((entry) => entry.job === job).session_offset_ms;
      let start = ref.range?.[0] ?? (ref.anchor === "start" ? 0 : source.session.duration_ms);
      let end = ref.range?.[1] ?? start;
      if (ref.anchor.endsWith("_start")) end = start;
      if (ref.anchor.endsWith("_end")) start = end;
      return { session: ref.session, start_ms: offset === null ? null : offset + start, end_ms: offset === null ? null : offset + end };
    }),
  }));
  const doc = { schema: "factory-task-context/1", job, availability: record.state, reason: null, record, placements };
  if (!validateTaskContext(doc, job).ok) throw new Error("task_context_projection_invalid");
  return doc;
}
