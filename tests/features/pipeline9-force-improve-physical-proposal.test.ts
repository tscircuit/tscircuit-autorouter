import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import fixture from "../fixtures/pipeline9-native-world-guards/cmn42-valid-input-unsafe-force-proposal.json"

test("force improvement rejects a real proposal that moves a valid through-via into a foreign top pad", () => {
  const routes = structuredClone(fixture.routes) as HighDensityRoute[]
  const input = {
    nodeWithPortPoints: [fixture.node as NodeWithPortPoints],
    hdRoutes: routes,
    totalStepsPerNode: 20,
    nodeAssignmentMargin: 0.15,
  }
  const physicalValidation = {
    connectivityNetMap: fixture.connectivityNetMap,
    layerCount: fixture.layerCount,
    allowBlindAndBuriedVias: fixture.allowBlindAndBuriedVias,
    traceClearance: 0.1,
    viaHoleDiameter: fixture.viaHoleDiameter,
    minViaHoleEdgeToViaHoleEdgeClearance: fixture.minViaHoleEdgeToViaHoleEdgeClearance,
    boardObstacles: fixture.boardObstacles as Obstacle[],
    viaToPadClearance: 0.1,
  }
  const connMap = new ConnectivityMap(fixture.connectivityNetMap)
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...physicalValidation, routes, connMap })).toBe(true)
  const numerical = new HighDensityForceImproveSolver(structuredClone(input))
  numerical.solve()
  expect(numerical.solved).toBe(true)
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...physicalValidation, routes: numerical.getOutput(), connMap })).toBe(false)
  const guarded = new Pipeline9HighDensityForceImproveSolver({ ...input, physicalValidation })
  guarded.solve()
  expect(guarded.solved).toBe(true)
  expect(guarded.failed).toBe(false)
  expect(guarded.stats.physicalCandidateRejectionCount).toBe(1)
  expect(guarded.getOutput()).toEqual(routes)
  expect(guarded.getConstructorParams()[0].physicalValidation).toEqual(physicalValidation)
})
