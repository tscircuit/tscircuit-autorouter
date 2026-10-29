import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointLayerAssignmentSolver, type JointLayerAssignmentParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointLayerAssignmentSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { getOriginalJointLayerStaticConflict } from "tests/utils/joint-layer-static-reference"

test("static broadphase preserves the frozen exact predicate across widths, rotations, layers and contact tolerances", (): void => {
  let seed = 0x35a17bd2, originalDistances = 0, optimizedDistances = 0, positives = 0
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const connMap = new ConnectivityMap({ own: ["netA", "rootA", "aliasA"], other: ["foreign"] })
  const compare = (route: HighDensityRoute, obstacles: Obstacle[], layerCount: number,
    blind: boolean, clearance: number, viaToPadClearance: number): void => {
    const params: JointLayerAssignmentParams = { routes: [], fixedRoutes: [], layerCount,
      allowBlindAndBuriedVias: blind, connMap, obstacles, clearance, viaToPadClearance,
      evaluate: () => ({ valid: true, manufacturedSites: 0 }) }
    const solver = new Pipeline9JointLayerAssignmentSolver(params)
    const actual = (solver as unknown as { hasStaticConflict: (route: HighDensityRoute) => boolean })
      .hasStaticConflict(route)
    const expected = getOriginalJointLayerStaticConflict(route, params)
    expect(actual).toBe(expected.conflict)
    expect(solver.stats.staticDistanceEvaluations).toBeLessThanOrEqual(expected.distances)
    originalDistances += expected.distances
    optimizedDistances += Number(solver.stats.staticDistanceEvaluations)
    if (expected.conflict) positives++
  }
  for (let index = 0; index < 4000; index++) {
    const layerCount = index % 2 ? 4 : 2, startZ = Math.floor(random() * layerCount)
    const endZ = (startZ + 1 + Math.floor(random() * (layerCount - 1))) % layerCount
    const point = (): { x: number; y: number } => ({ x: random() * 10 - 5, y: random() * 10 - 5 })
    const start = point(), middle = point(), end = point()
    const route: HighDensityRoute = { connectionName: "netA", rootConnectionName: "rootA",
      traceThickness: 0.05 + random() * 0.4, viaDiameter: 0.1 + random(),
      route: [{ ...start, z: startZ, traceThickness: random() * 2 },
        { ...middle, z: startZ }, { ...middle, z: endZ, traceThickness: random() * 2 },
        { ...end, z: endZ }], vias: [middle] }
    const obstacles: Obstacle[] = Array.from({ length: 5 }, (_, obstacleIndex) => ({
      type: "rect", shape: random() < 0.5 ? "circle" : undefined,
      obstacleId: `random_${index}_${obstacleIndex}`, center: point(),
      width: 0.01 + random() * 4, height: 0.01 + random() * 4,
      ccwRotationDegrees: random() * 1080 - 540,
      layers: Array.from({ length: layerCount }, (_, z) => mapZToLayerName(z, layerCount))
        .filter(() => random() < 0.75),
      connectedTo: random() < 0.2 ? ["aliasA"] : ["foreign"],
    }))
    compare(route, obstacles, layerCount, index % 3 === 0, 0.01 + random() * 0.3, random() * 0.4)
  }
  const wire: HighDensityRoute = { connectionName: "netA", traceThickness: 0.2,
    viaDiameter: 0.4, vias: [], route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }
  for (const shape of [undefined, "circle"] as const) {
    for (const offset of [-2e-9, -0.5e-9, 0, 0.5e-9, 2e-9]) {
      compare(wire, [{ type: "rect", shape, center: { x: 0, y: 0.3 + offset },
        width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign"] }], 2, false, 0.1, 0.1)
    }
  }
  compare({ ...wire, traceThickness: 0.01, route: wire.route.map((point) =>
    ({ ...point, traceThickness: 2 })) }, [{ type: "rect", center: { x: 0, y: 0.8 },
    width: 0.1, height: 0.1, ccwRotationDegrees: 45,
    layers: ["top"], connectedTo: ["foreign"] }], 2, false, 0.1, 0.1)
  for (const blind of [false, true]) {
    const via: HighDensityRoute = { ...wire, route: [
      { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 2 }], vias: [{ x: 0, y: 0 }] }
    compare(via, [{ type: "rect", center: { x: 0.25, y: 0 }, width: 0.1, height: 0.1,
      layers: ["top"], connectedTo: ["foreign"] }], 4, blind, 0.1, 0.2)
  }
  expect(positives).toBeGreaterThan(500)
  expect(originalDistances).toBeGreaterThan(optimizedDistances)
})
