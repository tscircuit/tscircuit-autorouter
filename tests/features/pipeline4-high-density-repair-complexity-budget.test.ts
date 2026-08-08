import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("bounded high-density repair selects a tractable violating region", (): void => {
  const createNode = (
    capacityMeshNodeId: string,
    centerX: number,
  ): NodeWithPortPoints => ({
    capacityMeshNodeId,
    center: { x: centerX, y: 0 },
    width: 4,
    height: 4,
    portPoints: [],
  })
  const createRoute = (
    connectionName: string,
    regionId: string,
    route: HighDensityRoute["route"],
  ): HighDensityRoute => ({
    connectionName,
    regionId,
    route,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
  })
  const oversizedRoutePoints = Array.from({ length: 12 }, (_, pointIndex) => ({
    x: -1.5 + pointIndex * 0.25,
    y: pointIndex % 2 === 0 ? -0.1 : 0.1,
    z: 0,
  }))
  const nodes = [createNode("oversized", 0), createNode("tractable", 10)]
  const routes = [
    createRoute("oversized-a", "oversized", oversizedRoutePoints),
    createRoute("oversized-b", "oversized", [
      { x: 0, y: -1.5, z: 0 },
      { x: 0, y: 1.5, z: 0 },
    ]),
    createRoute("tractable-a", "tractable", [
      { x: 8.5, y: 0, z: 0 },
      { x: 11.5, y: 0, z: 0 },
    ]),
    createRoute("tractable-b", "tractable", [
      { x: 10, y: -1.5, z: 0 },
      { x: 10, y: 1.5, z: 0 },
    ]),
  ]

  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: nodes,
    hdRoutes: routes,
    obstacles: [],
    repairMargin: 0.2,
    maxSampleEntries: 1,
    maxRoutePointCountPerSample: 10,
  })

  expect(
    solver.sampleEntries.map((entry) => entry.node.capacityMeshNodeId),
  ).toEqual(["tractable"])
  expect(solver.stats).toMatchObject({
    sampleCount: 1,
    skippedSampleCount: 1,
    skippedOversizedSampleCount: 1,
  })
})
