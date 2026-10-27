import { expect, test } from "bun:test"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { priorityParams } from "../priorityDagTestUtils"
import { sparseOptions } from "./fixtures"

const makeRoute = ({
  connectionName,
  y,
  via,
}: {
  connectionName: string
  y: number
  via: boolean
}): HighDensityIntraNodeRoute => ({
  connectionName,
  traceThickness: 0.1,
  viaDiameter: 0.4,
  route: via
    ? [{ x: 5, y, z: 0 }, { x: 5, y, z: 1 }]
    : [{ x: 2, y, z: 0 }, { x: 8, y, z: 0 }],
  vias: via ? [{ x: 5, y }] : [],
})

test("declared trace and via pad gaps independently constrain exact edges and final priority witness pairs", (): void => {
  for (const rules of [
    { trace: 0.05, pad: 0.1 },
    { trace: 0.1, pad: 0.3 },
    { trace: 0.3, pad: 0.25 },
  ]) {
    for (const via of [false, true]) {
      const obstacle = makeRoute({ connectionName: "obstacle", y: 5, via })
      const physicalRadiusSum = via ? 0.4 : 0.1
      const requiredGap = via ? rules.pad : rules.trace
      for (const offset of [-0.001, 0.001]) {
        const y = 5 + physicalRadiusSum + requiredGap + offset
        const candidate = makeRoute({ connectionName: "candidate", y, via })
        const priority = new PriorityDagIntraNodeSolver({
          nodeWithPortPoints: {
            capacityMeshNodeId: "declared-gap",
            center: { x: 5, y: 5 }, width: 10, height: 10,
            availableZ: [0, 1],
            portPoints: [obstacle, candidate].flatMap((route) =>
              [route.route[0]!, route.route.at(-1)!].map((point) => ({
                ...point, connectionName: route.connectionName,
              })),
            ),
          },
          sparsePhysicalSearch: true,
          actualCopperClearance: rules.trace,
          actualViaPadClearance: rules.pad,
          obstacleMargin: 0.15,
          traceWidth: 0.1,
          viaDiameter: 0.4,
          viaHoleDiameter: 0.05,
          minViaHoleEdgeToViaHoleEdgeClearance: 0.05,
          layerCount: 2,
          priorityFamilySize: 6,
          captureSearchDebug: false,
        })
        const tasks = priority["tasks"]
        const obstacleTask = tasks.findIndex((task) => task.connectionName === "obstacle")
        const candidateTask = tasks.findIndex((task) => task.connectionName === "candidate")
        const state = {
          ancestors: tasks.map(() => new Set<number>()),
          witnesses: tasks.map((task) => ({
            route: task.connectionName === "candidate" ? candidate : obstacle,
            ancestors: [],
          })),
        }
        state.ancestors[candidateTask]!.add(obstacleTask)
        const options = priority["getOptions"](candidateTask, state)
        expect(options.obstacleMargin).toBe(rules.trace)
        const kernel = new SparsePhysicalSingleRouteSolver({
          ...options,
          viaPadClearance: rules.pad,
          nodeBoundaryMargin: 0.15,
          viaHoleDiameter: 0.05,
          minViaHoleEdgeToViaHoleEdgeClearance: 0.05,
        })
        expect(kernel.isSparseEdgeLegal({
          start: candidate.route[0]!, end: candidate.route[1]!,
        })).toBe(offset > 0)
        expect(priority["pairConflict"](obstacleTask, candidateTask, state)).toBe(offset < 0)
        expect(doPipeline9RoutesHaveCopperConflict({
          left: obstacle,
          right: candidate,
          clearance: rules.trace,
          viaPadClearance: rules.pad,
          layerCount: 2,
        })).toBe(offset < 0)
      }
    }
    const viaObstacle = makeRoute({ connectionName: "obstacle", y: 5, via: true })
    const kernel = new SparsePhysicalSingleRouteSolver({
      ...sparseOptions,
      traceThickness: 0.1,
      obstacleMargin: rules.trace,
      viaPadClearance: rules.pad,
      nodeBoundaryMargin: 0.15,
      obstacleRoutes: [viaObstacle],
    })
    for (const offset of [-0.001, 0.001]) {
      const y = 5 + 0.25 + rules.trace + offset
      expect(kernel.isSparseEdgeLegal({
        start: { x: 2, y, z: 0 }, end: { x: 8, y, z: 0 },
      })).toBe(offset > 0)
    }
  }
  const border = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    obstacleMargin: 0.05,
    nodeBoundaryMargin: 0.15,
  })
  expect(border.isSparseEdgeLegal({
    start: { x: 0.15, y: 2, z: 0 },
    end: { x: 0.15, y: 8, z: 0 },
  })).toBe(false)
  const standalone = new PriorityDagIntraNodeSolver({
    ...priorityParams(),
    sparsePhysicalSearch: true,
    obstacleMargin: 0.15,
  })
  const state = {
    ancestors: standalone["tasks"].map(() => new Set<number>()),
    witnesses: standalone["tasks"].map(() => undefined),
  }
  expect(standalone["getOptions"](0, state).obstacleMargin).toBe(0.15)
})
