import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9HardObstacleReroutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9HardObstacleReroutes"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("single-connection reroute clears via clearance while neighboring copper stays fixed", () => {
  const { originalSrj, routes } = createBoundedRegionalRepairFixture()
  originalSrj.obstacles.splice(2, 1)
  originalSrj.obstacles.push(
    {
      type: "rect",
      center: { x: -1, y: 1 },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: ["via", "v1"],
      circuitJsonMetadata: { pcb_smtpad_id: "via_start", pcb_port_id: "v1" },
    },
    {
      type: "rect",
      center: { x: 2, y: 0.3 },
      width: 0.2,
      height: 0.2,
      layers: ["bottom"],
      connectedTo: ["via", "v2"],
      circuitJsonMetadata: { pcb_smtpad_id: "via_end", pcb_port_id: "v2" },
    },
  )
  originalSrj.connections.push({
    name: "via",
    pointsToConnect: [
      { x: -1, y: 1, layer: "top", pointId: "v1", pcb_port_id: "v1" },
      { x: 2, y: 0.3, layer: "bottom", pointId: "v2", pcb_port_id: "v2" },
    ],
  })
  routes.push({
    connectionName: "via",
    traceThickness: 0.1,
    viaDiameter: 0.4,
    vias: [{ x: -1, y: 0.3 }],
    route: [
      { x: -1, y: 1, z: 0 },
      { x: -1, y: 0.3, z: 0 },
      { x: -1, y: 0.3, z: 1 },
      { x: 2, y: 0.3, z: 1 },
    ],
  })
  const fixedViaRoute = structuredClone(routes[1])
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: originalSrj.connections,
      originalConnections: originalSrj.connections,
      hdRoutes: (candidate ?? hdRoutes)!,
      layerCount: originalSrj.layerCount,
      obstacles: originalSrj.obstacles,
      defaultViaHoleDiameter: 0.2,
      connMap,
    })
    const result = evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: traces,
    })
    const errors = normalizePipeline9DrcErrorsForRepair({
      errors: result.errors,
      circuitJson: result.circuitJson,
      newTraceIds: new Set(traces.map((trace) => trace.pcb_trace_id)),
    })
    return { errors, errorsWithCenters: errors }
  }
  const before = drcEvaluator({ traces: [], routes })
  expect(Array.isArray(before) ? before : before.errors).toHaveLength(1)

  const repaired = applyPipeline9HardObstacleReroutes({
    originalSrj,
    routes,
    connections: originalSrj.connections,
    drcEvaluator,
    viaHoleDiameter: 0.2,
    maxAttempts: 8,
  })

  expect(repaired).not.toBe(routes)
  expect(repaired[1]).toEqual(fixedViaRoute)
  expect(repaired[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(repaired[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
  const after = drcEvaluator({ traces: [], routes: repaired })
  expect(Array.isArray(after) ? after : after.errors).toHaveLength(0)
})
