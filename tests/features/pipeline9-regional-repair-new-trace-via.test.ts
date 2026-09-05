import { expect, test } from "bun:test"
import { applyPipeline9RegionalB01Repairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import "../fixtures/svg-matcher"

test("regional repair removes an inner-layer via short without preloaded copper", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "via_owner",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pcb_port_id: "a" },
          { x: 4, y: 0, layer: "bottom", pcb_port_id: "b" },
        ],
      },
      {
        name: "crossing",
        pointsToConnect: [
          { x: -4, y: -1, layer: "inner2", pcb_port_id: "c" },
          { x: 4, y: 1, layer: "inner2", pcb_port_id: "d" },
        ],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "via_owner",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -4, y: 0, z: 0, pcb_port_id: "a" },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 3 },
        { x: 4, y: 0, z: 3, pcb_port_id: "b" },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "crossing",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -4, y: -1, z: 2, pcb_port_id: "c" },
        { x: 4, y: 1, z: 2, pcb_port_id: "d" },
      ],
      vias: [],
    },
  ]
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const conversion = {
    connections: srj.connections,
    originalConnections: srj.connections,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaHoleDiameter: 0.15,
    connMap,
  }
  const before = {
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversion,
      hdRoutes: routes,
    }),
  }
  const originalRoutes = structuredClone(routes)
  expect(evaluateRelaxedDrc(before).errors).toHaveLength(1)
  const result = applyPipeline9RegionalB01Repairs({
    srj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: srj.connections,
    syntheticConnectionNames: new Set(),
    preloadRepairTraceIds: new Set(),
    drcEvaluator: createPipeline9RelaxedDrcEvaluator({
      ...conversion,
      srjWithPointPairs: srj,
      originalSrj: srj,
      mutatedPreloadedTraces: [],
    }),
    connMap,
    colorMap: { via_owner: "blue", crossing: "red" },
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })
  const after = {
    ...before,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversion,
      hdRoutes: result.routes,
    }),
  }
  expect(evaluateRelaxedDrc(after).errors).toHaveLength(0)
  expect(result.preloadEligibleDrcIssueCount).toBe(0)
  expect(result.repairAttempted).toBeTrue()
  expect(result.acceptedCandidateCount).toBeGreaterThan(0)
  expect(result.candidateSearchCount).toBeLessThanOrEqual(
    result.candidateSearchBudget,
  )
  expect(routes).toEqual(originalRoutes)
  for (const [index, route] of result.routes.entries()) {
    expect(route.route[0]).toEqual(originalRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(originalRoutes[index]!.route.at(-1))
  }
  await expect(getBugReportSnapshotSvg(before)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "before" },
  )
  await expect(getBugReportSnapshotSvg(after)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "after" },
  )
})
