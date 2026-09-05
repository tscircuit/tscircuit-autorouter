import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { asRegionalRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("regional repair gives separate pieces of a shared connection distinct splice identities", () => {
  const routes: HighDensityRoute[] = [-0.5, 0.5, 0.8].map((y, index) => ({
    connectionName: index < 2 ? "shared" : "foreign",
    rootConnectionName: index < 2 ? "shared-root" : "foreign-root",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -2, y, z: 0 },
      { x: 2, y, z: 0 },
    ],
  }))
  const connMap = new ConnectivityMap({
    netA: ["shared", "shared-root", "pad-a"],
    netB: ["foreign", "foreign-root"],
  })
  const regionalRoutes = asRegionalRoutes(routes, connMap)
  const problem = createRegionalFallbackProblem(
    {
      capacityMeshNodeId: "repair-window",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: [],
    },
    regionalRoutes,
  )

  expect(problem.fixedRouteSectionsByConnectionName.size).toBe(3)
  expect(new Set(regionalRoutes.map((route) => route.connectionName)).size).toBe(3)
  expect(regionalRoutes[2]!.connectionName).toBe("foreign")
  for (const route of regionalRoutes.slice(0, 2)) {
    expect(connMap.areIdsConnected(route.connectionName, "pad-a")).toBe(true)
    expect(connMap.areIdsConnected(route.connectionName, "foreign")).toBe(false)
    const section = problem.fixedRouteSectionsByConnectionName.get(
      route.connectionName,
    )!
    expect(section.sourceRoutes[0]!.preloadedTraceIndex).toBe(
      route.preloadedTraceIndex,
    )
  }
  expect(routes.map((route) => route.connectionName)).toEqual([
    "shared",
    "shared",
    "foreign",
  ])
})
