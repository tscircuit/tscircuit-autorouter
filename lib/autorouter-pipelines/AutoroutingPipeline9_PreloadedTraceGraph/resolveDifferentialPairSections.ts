import type { DifferentialPairPath } from "@tscircuit/length-matching-solver"
import { distance } from "@tscircuit/math-utils"
import { getConnectionPathPoints } from "lib/solvers/NetToPointPairsSolver/getConnectionPathPoints"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"

export type PreloadedDifferentialPairSections = ReadonlyMap<
  string,
  { connection: SimpleRouteConnection; pcbTraceId: string }
>

/** Match consecutive path terminals to the solver's output or existing copper. */
export function resolveDifferentialPairSections(
  srj: SimpleRouteJson,
  connections: SimpleRouteConnection[],
): {
  sectionsByMember: Map<
    string,
    DifferentialPairPath["sections"][number][number][]
  >
  preloadedSections: PreloadedDifferentialPairSections
} {
  const sectionsByMember = new Map<
    string,
    DifferentialPairPath["sections"][number][number][]
  >()
  const preloadedSections = new Map<
    string,
    { connection: SimpleRouteConnection; pcbTraceId: string }
  >()
  const pathPointIds = new Set(
    srj.connections.flatMap((connection) => connection.path ?? []),
  )
  for (const name of new Set(
    srj.differentialPairs?.flatMap((pair) => pair.connectionNames),
  )) {
    const member = srj.connections.find(
      (connection) => connection.name === name,
    )
    if (!member) {
      const matches = connections.filter(
        (connection) =>
          connection.__rootConnectionNames?.includes(name) ||
          connection.__netConnectionName === name,
      )
      if (matches.length !== 1)
        throw new Error(
          `Pipeline9: differential pair connection "${name}" must resolve to exactly one final point-pair connection, got ${matches.length}`,
        )
      sectionsByMember.set(name, [{ connectionName: matches[0]!.name }])
      continue
    }
    const points = getConnectionPathPoints(member)
    sectionsByMember.set(
      name,
      points.slice(1).map((to, index) => {
        const from = points[index]!
        const fromId = getPointKey(from)
        const toId = getPointKey(to)
        const matches = connections.filter((connection) => {
          const ids = connection.pointsToConnect.map(getPointKey)
          return ids.length === 2 && ids.includes(fromId) && ids.includes(toId)
        })
        if (matches.length === 1) return { connectionName: matches[0]!.name }
        if (matches.length > 1)
          throw new Error(
            `Pipeline9: differential pair path "${name}" has multiple connections between "${fromId}" and "${toId}"`,
          )
        const traces = (srj.traces ?? []).filter((trace) => {
          const ids = trace.connectsTo ?? []
          if (
            !ids.includes(fromId) ||
            !ids.includes(toId) ||
            ids.some(
              (id) => id !== fromId && id !== toId && pathPointIds.has(id),
            )
          )
            return false
          const first = trace.route.find((entry) => entry.route_type === "wire")
          const last = trace.route.findLast(
            (entry) => entry.route_type === "wire",
          )
          return (
            first &&
            last &&
            ((distance(from, first) <= 1e-8 && distance(to, last) <= 1e-8) ||
              (distance(from, last) <= 1e-8 && distance(to, first) <= 1e-8))
          )
        })
        if (traces.length !== 1)
          throw new Error(
            `Pipeline9: differential pair path "${name}" needs one routed connection or preloaded trace between "${fromId}" and "${toId}"`,
          )
        const pcbTraceId = traces[0]!.pcb_trace_id
        preloadedSections.set(pcbTraceId, {
          connection: { ...member, pointsToConnect: [from, to] },
          pcbTraceId,
        })
        return { pcbTraceId }
      }),
    )
  }
  return { sectionsByMember, preloadedSections }
}
