import { expect, test } from "bun:test"
import "graphics-debug/matcher"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

const createRepairCapReproInput = (): {
  nodeWithPortPoints: NodeWithPortPoints[]
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
} => {
  const nodeWithPortPoints: NodeWithPortPoints[] = []
  const hdRoutes: HighDensityRoute[] = []
  const obstacles: Obstacle[] = []

  for (let copyIndex = 0; copyIndex < 3; copyIndex++) {
    const xOffset = copyIndex * 2
    const copySuffix = `copy_${copyIndex}`
    const capacityMeshNodeId = `cmn_11__sub_1_0_${copySuffix}`
    const sourceTrace18ConnectionName = `source_trace_18__source_net_18_mst3_${copySuffix}`
    const sourceTrace5ConnectionName = `source_trace_5__source_net_5_mst12_${copySuffix}`

    nodeWithPortPoints.push({
      capacityMeshNodeId,
      center: { x: -1.95 + xOffset, y: 9.2075 },
      width: 0.51,
      height: 1.905,
      portPoints: [
        {
          x: -1.695 + xOffset,
          y: 8.886793,
          z: 0,
          connectionName: sourceTrace5ConnectionName,
          portPointId: `ce5032_pp0_z0_${copySuffix}`,
          nextPortPointId: `ce5030_pp1_z3_${copySuffix}`,
        },
        {
          x: -1.695 + xOffset,
          y: 8.7025,
          z: 3,
          connectionName: sourceTrace5ConnectionName,
          portPointId: `ce5030_pp1_z3_${copySuffix}`,
          prevPortPointId: `ce5032_pp0_z0_${copySuffix}`,
        },
        {
          x: -2.205 + xOffset,
          y: 8.4425,
          z: 2,
          connectionName: sourceTrace18ConnectionName,
          portPointId: `ce4774_pp0_z2_${copySuffix}`,
          nextPortPointId: `ce5031_pp0_z2_${copySuffix}`,
        },
        {
          x: -1.695 + xOffset,
          y: 8.7025,
          z: 2,
          connectionName: sourceTrace18ConnectionName,
          portPointId: `ce5031_pp0_z2_${copySuffix}`,
          prevPortPointId: `ce4774_pp0_z2_${copySuffix}`,
        },
      ],
    })
    hdRoutes.push(
      {
        connectionName: sourceTrace18ConnectionName,
        rootConnectionName: `source_trace_18_${copySuffix}`,
        regionId: capacityMeshNodeId,
        route: [
          { x: -2.205 + xOffset, y: 8.442, z: 2 },
          { x: -2.077 + xOffset, y: 8.467, z: 2 },
          { x: -1.95 + xOffset, y: 8.573, z: 2 },
          { x: -1.822 + xOffset, y: 8.678, z: 2 },
          { x: -1.695 + xOffset, y: 8.703, z: 2 },
        ],
        traceThickness: 0.1,
        vias: [],
        viaDiameter: 0.3,
      },
      {
        connectionName: sourceTrace5ConnectionName,
        rootConnectionName: `source_trace_5_${copySuffix}`,
        regionId: capacityMeshNodeId,
        route: [
          { x: -1.695 + xOffset, y: 8.887, z: 0 },
          { x: -1.822 + xOffset, y: 8.996, z: 0 },
          { x: -1.914 + xOffset, y: 9.068, z: 0 },
          { x: -1.914 + xOffset, y: 9.068, z: 3 },
          { x: -1.84 + xOffset, y: 8.98, z: 3 },
          { x: -1.767 + xOffset, y: 8.885, z: 3 },
          { x: -1.695 + xOffset, y: 8.784, z: 3 },
          { x: -1.695 + xOffset, y: 8.703, z: 3 },
        ],
        traceThickness: 0.1,
        vias: [{ x: -1.914 + xOffset, y: 9.068 }],
        viaDiameter: 0.3,
      },
    )
    obstacles.push({
      obstacleId: `obstacle_${copySuffix}`,
      type: "rect",
      layers: ["top"],
      center: { x: -2.5 + xOffset, y: 8.59 },
      width: 0.59,
      height: 0.64,
      connectedTo: [],
    })
  }

  return { nodeWithPortPoints, hdRoutes, obstacles }
}

test("high-density repair processes the highest-risk regions within its sample cap", (): void => {
  const { nodeWithPortPoints, hdRoutes, obstacles } =
    createRepairCapReproInput()
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints,
    hdRoutes,
    obstacles,
    repairMargin: 0.2,
    maxSampleEntries: 2,
  })

  solver.solve()

  expect(solver.stats).toMatchObject({
    sampleCount: 2,
    skippedSampleCount: 1,
    repairedNodeCount: 2,
    repairedRouteCount: 4,
  })
  expect(solver.getOutput().slice(0, 4)).not.toEqual(hdRoutes.slice(0, 4))
  expect(solver.getOutput().slice(4)).toEqual(hdRoutes.slice(4))
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
