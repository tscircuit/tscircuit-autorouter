import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { validateOwnerCutRoutes } from "lib/solvers/HighDensitySolver/validateOwnerCutRoutes"
import { ownerCutParams } from "../solvers/ownerCutTestUtils"

test("ordinary local Pipeline9 enables owner-cut candidates with physical context", (): void => {
  const params = ownerCutParams()
  params.viaDiameter = 0.15
  params.viaHoleDiameter = 0.08
  params.minViaHoleEdgeToViaHoleEdgeClearance = 0.05
  params.nodeWithPortPoints.portPoints = Array.from({ length: 4 }, (_, index) => {
    const angle = index * Math.PI / 4
    return [1, -1].map((sign) => ({
      x: sign * 1.4 * Math.cos(angle), y: sign * 1.4 * Math.sin(angle),
      z: 0, connectionName: `signal-${index}`,
    }))
  }).flat()
  params.nodeWithPortPoints.width = 3
  params.nodeWithPortPoints.height = 3
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [params.nodeWithPortPoints], fixedHdRoutes: [],
    connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
    viaDiameter: params.viaDiameter, viaHoleDiameter: params.viaHoleDiameter,
    minViaHoleEdgeToViaHoleEdgeClearance: params.minViaHoleEdgeToViaHoleEdgeClearance,
    traceWidth: 0.05, obstacleMargin: 0.15, effort: 1,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.benchmarkDiagnosticCounters.ownerCutCandidates).toBeGreaterThan(0)
  expect(solver.benchmarkDiagnosticCounters.ownerCutQueries).toBeGreaterThan(0)
  expect(validateOwnerCutRoutes(solver.routes, { ...params,
    traceThickness: 0.1, traceMargin: 0.1 })).toBeUndefined()
})
