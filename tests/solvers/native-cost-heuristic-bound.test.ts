import { expect, test } from "bun:test"
import {
  createModelNode,
  createNativeHeuristicSolver,
  getModelShortestPaths,
  type MovementModel,
} from "./nativeCostHeuristicTestUtils"

test("Native directional heuristic bounds nonuniform multilayer movement to off-grid goal disks", (): void => {
  const layerSets = [[0], [0, 2], [0, 1], [0, 2, 3]]
  for (const layers of layerSets) {
    for (const misalignment of [0, 0.2, 0.7, 1, 2, 5, 10]) {
      for (const flip of [false, true]) {
        for (const viaCost of [0, 0.4]) {
          for (const goal of [
            { x: 0.64, y: 0.58, z: layers[layers.length - 1]! },
            { x: 0.98, y: 0.02, z: layers[0]! },
          ]) {
            const model: MovementModel = {
              coordinates: [0, 0.23, 0.61, 1],
              layers,
              goal,
              goalRadius: 0.05 * Math.SQRT2,
              misalignment,
              flip,
              viaCost,
            }
            const oracle = getModelShortestPaths(model)
            const solver = createNativeHeuristicSolver(model)
            const priorities = oracle.points.map((point) =>
              solver.computeH(createModelNode(point)),
            )
            expect(oracle.costs.some((cost) => cost === 0)).toBe(true)
            for (let index = 0; index < priorities.length; index++) {
              expect(Number.isFinite(priorities[index])).toBe(true)
              expect(priorities[index]!).toBeGreaterThanOrEqual(0)
              expect(priorities[index]!).toBeLessThanOrEqual(
                oracle.costs[index]! + 1e-10,
              )
            }
            for (const edge of oracle.edges) {
              expect(priorities[edge.from]!).toBeLessThanOrEqual(
                edge.cost + priorities[edge.to]! + 1e-10,
              )
            }
          }
        }
      }
    }
  }
})
