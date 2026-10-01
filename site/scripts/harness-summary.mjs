// Per-harness breakdown of published facts. Pure: callers pass the facts
// files already scoped the way the site scopes its other sections.

// Hosts that no real session has proven yet. Removing a host from this set
// removes its "(unproven)" label on the site.
export const UNPROVEN_HOSTS = new Set(["codex-cli"])

function bump(map, key, by = 1) {
  map[key] = (map[key] || 0) + by
}

function depthOf(agent, byN) {
  let depth = 0
  const seen = new Set()
  let cur = agent
  while (cur.parent !== null && cur.parent !== undefined) {
    if (seen.has(cur.n)) break
    seen.add(cur.n)
    const next = byN.get(cur.parent)
    depth += 1
    if (!next) break
    cur = next
  }
  return depth
}

export function harnessSummary(factFiles) {
  const hosts = new Map()
  for (const d of Array.isArray(factFiles) ? factFiles : []) {
    const host = d?.session?.host
    if (typeof host !== "string" || !host) continue
    let h = hosts.get(host)
    if (!h) {
      h = {
        host,
        unproven: UNPROVEN_HOSTS.has(host),
        versions: Object.create(null),
        sessions: 0,
        workers: 0,
        subagents: 0,
        max_depth: 0,
        models: Object.create(null),
        requested_vs_resolved: [],
        agent_types: Object.create(null),
        _pairs: new Map(),
      }
      hosts.set(host, h)
    }
    h.sessions += 1
    const v = d.session.host_version
    bump(h.versions, typeof v === "string" && v ? v : "unknown")

    const agents = (Array.isArray(d.agents) ? d.agents : []).filter(
      (a) => a && typeof a === "object",
    )
    const byN = new Map(agents.map((a) => [a.n, a]))
    for (const a of agents) {
      h.workers += 1
      if (a.parent !== null && a.parent !== undefined) h.subagents += 1
      h.max_depth = Math.max(h.max_depth, depthOf(a, byN))
      if (typeof a.model === "string" && a.model) bump(h.models, a.model)
      if (typeof a.agent_type === "string" && a.agent_type) bump(h.agent_types, a.agent_type)
      if (
        typeof a.requested_model === "string" &&
        a.requested_model &&
        a.requested_model !== a.model
      ) {
        const key = JSON.stringify([a.requested_model, a.model ?? null])
        h._pairs.set(key, (h._pairs.get(key) || 0) + 1)
      }
    }
  }
  return [...hosts.values()]
    .map(({ _pairs, ...h }) => ({
      ...h,
      // Counted on prototype-free maps; Object.fromEntries keeps a store
      // value such as "__proto__" or "constructor" as an ordinary key.
      versions: Object.fromEntries(Object.entries(h.versions)),
      models: Object.fromEntries(Object.entries(h.models)),
      agent_types: Object.fromEntries(Object.entries(h.agent_types)),
      requested_vs_resolved: [..._pairs.entries()]
        .map(([k, workers]) => {
          const [requested, resolved] = JSON.parse(k)
          return { requested, resolved, workers }
        })
        .sort((a, b) => b.workers - a.workers || a.requested.localeCompare(b.requested)),
    }))
    .sort((a, b) => b.sessions - a.sessions || a.host.localeCompare(b.host))
}
