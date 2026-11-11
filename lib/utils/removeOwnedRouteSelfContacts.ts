import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { assertOwnedRouteTopology } from "./assertOwnedRouteTopology"
import { DifferentialPairRoutingError } from "./DifferentialPairRoutingError"
import { getConnectivityMapFromSimpleRouteJson } from "./getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "./getViaDimensions"

/** Remove generated self-contacting bends before tuning, without moving anchors.
 * All coordinates are board-world mm (+X right, +Y up, z indexes PCB layers).
 * Each accepted proposal reduces the vertex count, passes board DRC and preserves every
 * cross-route ownership rule. Final validation and length measurement still run. */
export const removeOwnedRouteSelfContacts = ({
  input,
  srjWithPointPairs,
  hdRoutes,
}: {
  input: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
}): HighDensityRoute[] => {
  if (!input.differentialPairs?.length) return hdRoutes
  const topologyInput = { ...input, differentialPairs: input.differentialPairs }
  let routes = hdRoutes
  let evaluate:
    | ReturnType<typeof createPipeline7AutoroutingDrcEvaluator>
    | undefined
  const vertexCount = routes.reduce((sum, route) => sum + route.route.length, 0)
  for (let removed = 0; removed <= vertexCount; removed++) {
    let failure: DifferentialPairRoutingError
    try {
      assertOwnedRouteTopology(topologyInput, routes)
      return routes
    } catch (error) {
      if (
        !(error instanceof DifferentialPairRoutingError) ||
        !error.selfContact
      )
        throw error
      failure = error
    }
    const contact = failure.selfContact!
    const route = routes[contact.routeIndex]!
    const firstIndex = route.route.indexOf(
      contact.firstSegmentEnd as HighDensityRoute["route"][number],
    )
    const lastIndex = route.route.indexOf(
      contact.secondSegmentStart as HighDensityRoute["route"][number],
    )
    if (firstIndex < 0 || lastIndex < firstIndex) throw failure
    let repaired = false
    const candidates: HighDensityRoute[][] = []
    const before = route.route[firstIndex - 1]
    const after = route.route[lastIndex + 1]
    const bend = route.route.slice(firstIndex, lastIndex + 1)
    const canMove = (point: HighDensityRoute["route"][number]): boolean =>
      point.z === before?.z &&
      !point.toNextSegmentType &&
      !point.pcb_port_id &&
      !point.insideJumperPad &&
      (point.traceThickness ?? route.traceThickness) ===
        (before.traceThickness ?? route.traceThickness) &&
      !route.vias.some(
        (via) => Math.hypot(via.x - point.x, via.y - point.y) <= 1e-8,
      )
    if (
      before &&
      after &&
      before.z === after.z &&
      !before.toNextSegmentType &&
      (after.traceThickness ?? route.traceThickness) ===
        (before.traceThickness ?? route.traceThickness) &&
      bend.every(canMove)
    ) {
      const section = [before, ...bend, after]
      const length = section
        .slice(1)
        .reduce(
          (sum, point, index) =>
            sum +
            Math.hypot(
              point.x - section[index]!.x,
              point.y - section[index]!.y,
            ),
          0,
        )
      const dx = after.x - before.x
      const dy = after.y - before.y
      const chord = Math.hypot(dx, dy)
      const height = Math.sqrt(Math.max(0, length ** 2 - chord ** 2)) / 2
      // Replace overlapping copper with a real, equal-length two-segment bend.
      // Both sides are geometric proposals; the full ownership and DRC checks
      // below decide whether either side has enough board space.
      if (chord > 0 && height <= chord / 2 && firstIndex < lastIndex) {
        for (const side of [1, -1]) {
          const point = {
            ...bend[0]!,
            x: (before.x + after.x) / 2 - (side * dy * height) / chord,
            y: (before.y + after.y) / 2 + (side * dx * height) / chord,
          }
          const margin =
            route.traceThickness / 2 + (input.minBoardEdgeClearance ?? 0)
          if (
            point.x < input.bounds.minX + margin ||
            point.x > input.bounds.maxX - margin ||
            point.y < input.bounds.minY + margin ||
            point.y > input.bounds.maxY - margin
          )
            continue
          const candidate = [...routes]
          candidate[contact.routeIndex] = {
            ...route,
            route: [
              ...route.route.slice(0, firstIndex),
              point,
              ...route.route.slice(lastIndex + 1),
            ],
          }
          candidates.push(candidate)
        }
      }
    }
    // A returning bend can require removing several vertices together: deleting
    // just its tip would leave the two returning legs adjacent. Expand the
    // shortcut in vertex-count order while retaining all protected anchors.
    for (
      let count = lastIndex - firstIndex + 1;
      count < route.route.length - 1;
      count++
    ) {
      for (
        let start = Math.max(1, lastIndex - count + 1);
        start <= firstIndex && start + count < route.route.length;
        start++
      ) {
        const previous = route.route[start - 1]!
        const next = route.route[start + count]!
        if (
          previous.toNextSegmentType ||
          previous.z !== before?.z ||
          next.z !== previous.z ||
          (previous.traceThickness ?? route.traceThickness) !==
            (before.traceThickness ?? route.traceThickness) ||
          (next.traceThickness ?? route.traceThickness) !==
            (previous.traceThickness ?? route.traceThickness) ||
          !route.route.slice(start, start + count).every(canMove)
        )
          continue
        const candidate = [...routes]
        candidate[contact.routeIndex] = {
          ...route,
          route: [
            ...route.route.slice(0, start),
            ...route.route.slice(start + count),
          ],
        }
        candidates.push(candidate)
      }
    }
    for (const candidate of candidates) {
      const candidatePoints = candidate[contact.routeIndex]!.route
      // A shortcut must not merely turn a returning leg into an adjacent one.
      // New joins retain at least a 45-degree inside angle, keeping their
      // contact local instead of hiding a near-parallel returning leg.
      const createsReturningJoin = candidatePoints
        .slice(1, -1)
        .some((point, index) => {
          const previous = candidatePoints[index]!
          const next = candidatePoints[index + 2]!
          const originalIndex = route.route.indexOf(point)
          if (
            originalIndex >= 0 &&
            route.route[originalIndex - 1] === previous &&
            route.route[originalIndex + 1] === next
          )
            return false
          const ux = point.x - previous.x
          const uy = point.y - previous.y
          const vx = next.x - point.x
          const vy = next.y - point.y
          return (
            ux * vx + uy * vy <
            -Math.SQRT1_2 * Math.hypot(ux, uy) * Math.hypot(vx, vy)
          )
        })
      if (createsReturningJoin) continue
      try {
        assertOwnedRouteTopology(topologyInput, candidate)
      } catch (error) {
        if (!(error instanceof DifferentialPairRoutingError)) throw error
        if (!error.selfContact) continue
      }
      evaluate ??= createPipeline7AutoroutingDrcEvaluator({
        connections: srjWithPointPairs.connections,
        originalConnections: input.connections,
        differentialPairs: input.differentialPairs,
        obstacles: input.obstacles,
        layerCount: input.layerCount,
        defaultViaHoleDiameter: getViaDimensions(input).holeDiameter,
        connMap: getConnectivityMapFromSimpleRouteJson(input),
        srjWithPointPairs,
        originalSrj: input,
      })
      const drc = evaluate({ routes: candidate, traces: [] })
      if ((Array.isArray(drc) ? drc : drc.errors).length > 0) continue
      routes = candidate
      repaired = true
      break
    }
    if (!repaired) throw failure
  }
  throw new Error("Owned route self-contact repair exhausted its vertex bound")
}
