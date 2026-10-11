import { expect, test } from "bun:test"
import { installParallelHighDensityRouteGridKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelHighDensityGridKernel"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as GridSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

function readState(solver: GridSolver): unknown {
  return {
    iterations: solver.iterations, max: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed, error: solver.error, progress: solver.progress,
    path: solver.solvedPath,
    explored: [...solver.exploredNodes],
    freePoints: [...solver.freePlanarObstaclePoints],
    debug: [solver.debug_exploredNodesOrdered, [...solver.debug_nodesTooCloseToObstacle], [...solver.debug_nodePathToParentIntersectsObstacle]],
    queued: solver.candidates.getTopN(12),
  }
}

test("worker HD scratch search preserves native geometry, costs, future-cache edits, and limits", (): void => {
  const obstacles: HighDensityIntraNodeRoute[] = [{
    connectionName: "wall", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 2.5, y: 0.8, z: 0 }, { x: 2.5, y: 3.7, z: 0 }],
    vias: [{ x: 3.6, y: 1.7 }],
  }]
  let totalAccepted = 0
  let totalPops = 0
  let found = 0
  for (const availableZ of [[0], [0, 1], [0, 2, 3]]) {
    for (const maxIterations of [25, 10_000]) {
      const opts: ConstructorParameters<typeof GridSolver>[0] = {
        connectionName: "route", rootConnectionName: "root", regionId: "region",
        minDistBetweenEnteringPoints: 0.1,
        bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
        A: { x: 0.13, y: 1.13, z: 0 },
        B: { x: 4.87, y: 4.1, z: availableZ.at(-1)! },
        obstacleRoutes: obstacles, availableZ, layerCount: 4,
        traceThickness: 0.15, obstacleMargin: 0.1,
        futureConnections: [{ connectionName: "future", points: [{ x: 0.5, y: 4.8, z: 0 }, { x: 4.5, y: 0.2, z: 0 }] }],
        hyperParameters: { CELL_SIZE_FACTOR: 2, FLIP_TRACE_ALIGNMENT_DIRECTION: true },
        captureSearchDebug: true,
      }
      const native = new GridSolver(structuredClone(opts))
      const packed = new GridSolver(structuredClone(opts))
      installParallelHighDensityRouteGridKernel(packed)
      installParallelHighDensityRouteGridKernel(packed)
      native.MAX_ITERATIONS = packed.MAX_ITERATIONS = maxIterations
      const counts = [native, packed].map((solver) => {
        const work = { accepted: 0, pops: 0 }
        const enqueue = solver.candidates.enqueue.bind(solver.candidates)
        solver.candidates.enqueue = (node: Node): void => { work.accepted++; enqueue(node) }
        const dequeue = solver.candidates.dequeue.bind(solver.candidates)
        solver.candidates.dequeue = (): Node | null => { work.pops++; return dequeue() }
        return work
      })
      const retained = new Map<Node, string>()
      expect(readState(packed)).toEqual(readState(native))
      while (!native.solved && !native.failed) {
        if (native.iterations === 7) {
          for (const solver of [native, packed]) {
            solver.futureConnectionPoints = [{ x: 0.4, y: 1.4, z: 2 }, { x: 4.6, y: 4.4, z: 0 }]
            solver.VIA_PENALTY_FACTOR = 1.25
          }
        }
        native.step()
        packed.step()
        expect(readState(packed)).toEqual(readState(native))
        for (const node of packed.candidates.getTopN(3)) {
          if (!retained.has(node)) retained.set(node, JSON.stringify(node))
        }
      }
      expect(counts[1]).toEqual(counts[0])
      for (const [node, value] of retained) expect(JSON.stringify(node)).toBe(value)
      if (packed.solved) found++
      totalAccepted += counts[1]!.accepted
      totalPops += counts[1]!.pops
      expect(() => {
        const late = new GridSolver(structuredClone(opts))
        late.step()
        installParallelHighDensityRouteGridKernel(late)
      }).toThrow("before search")
    }
  }
  expect(found).toBeGreaterThan(0)
  expect(totalAccepted).toBeGreaterThan(1_000)
  expect(totalPops).toBeGreaterThan(100)
})
