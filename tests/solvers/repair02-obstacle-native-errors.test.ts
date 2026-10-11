import { expect, test } from "bun:test"
import { FixedCopperClearanceGuard } from "high-density-repair02/lib/high-density-repair-solver/functions/FixedCopperClearanceGuard"
import { repairNodeClearance as nativeRepair } from "high-density-repair02/lib/high-density-repair-solver/functions/repairNodeClearance"
import type { HdRoute, Obstacle } from "high-density-repair02/lib/high-density-repair-solver/shared/types"
import { repairNodeClearance as indexedRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair02/repairNodeClearance"

test("repair02 obstacle rejection preserves original layer errors and unsupported arithmetic results", (): void => {
  const routes: HdRoute[] = [{
    connectionName: "foreign",
    traceThickness: 0.1,
    route: [{ x: 10, y: -2, z: 0 }, { x: 10, y: 2, z: 0 }],
    vias: [],
  }]
  const obstacle: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 2, height: 2, zLayers: [0] }
  const parameters = {
    routes,
    boundary: { minX: -100, minY: -100, maxX: 100, maxY: 100, width: 200, height: 200, center: { x: 0, y: 0 } },
    fixedCopperGuard: new FixedCopperClearanceGuard([], 0.1),
    maxCandidates: 0,
  }
  for (const value of [Number.NaN, Infinity, -Infinity, 1e12, -1]) {
    for (const changed of [
      { ...obstacle, center: { x: value, y: 0 } },
      { ...obstacle, width: value },
      { ...obstacle, height: value },
    ]) {
      const input = { ...parameters, clearanceObstacles: [changed] }
      expect(indexedRepair(input)).toEqual(nativeRepair(input))
    }
    const input = { ...parameters, clearanceObstacles: [obstacle], clearance: value }
    expect(indexedRepair(input)).toEqual(nativeRepair(input))
  }
  const layerError = new RangeError("native layer predicate failure")
  const malformed = {
    ...obstacle,
    zLayers: { some: (): never => { throw layerError } },
  } as unknown as Obstacle
  for (const repair of [nativeRepair, indexedRepair]) {
    let caught: unknown
    try {
      repair({ ...parameters, clearanceObstacles: [malformed] })
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(layerError)
  }
})
