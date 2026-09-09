import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { originalFutureViaClearance, readFutureViaMemo } from "tests/fixtures/future-via-memo"

test("fixed future clearance preserves 24 complete searches on two, four and six layers", () => {
  let seed = 71329
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  let usedMemo = 0
  let finished = 0
  for (let sample = 0; sample < 24; sample++) {
    const layerCount = [2, 4, 6][sample % 3]
    const offset = sample % 3 === 0 ? 0.00000000000007 : 0
    const bounds = { minX: -2 + offset, maxX: 2.013 + offset, minY: -2.007 - offset, maxY: 2.019 - offset }
    const obstacleRoutes: HighDensityIntraNodeRoute[] = Array.from({ length: 5 }, (_, index) => {
      const x = -1.4 + random() * 2.8
      const y = -1.4 + random() * 2.8
      const z = index % layerCount
      return {
        connectionName: `obstacle-${index}`, traceThickness: 0.15, viaDiameter: 0.3,
        route: [{ x, y, z }, { x: x + random() - 0.5, y: y + random() - 0.5, z }],
        vias: index === 0 ? [{ x, y }] : [],
      }
    })
    if (sample % 8 === 0) obstacleRoutes.push({
      connectionName: "exact-start-obstacle", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -1.42, y: -1.7, z: 0 }, { x: -1.42, y: 1.7, z: 0 }], vias: [],
    })
    const options = {
      connectionName: "route", obstacleRoutes, minDistBetweenEnteringPoints: 0.15, bounds,
      A: sample % 8 === 0 ? { x: -1.113, y: -0.737, z: 0 } : { x: bounds.minX, y: -0.753 + random() * 1.5, z: 0 },
      B: { x: bounds.maxX, y: -0.731 + random() * 1.5, z: sample % layerCount },
      layerCount, availableZ: Array.from({ length: layerCount }, (_, z) => z),
      hyperParameters: { CELL_SIZE_FACTOR: sample % 2 === 0 ? 0.5 : 1, FLIP_TRACE_ALIGNMENT_DIRECTION: sample % 3 === 0 },
      futureConnections: [
        { connectionName: "future-a", points: [{ x: 0, y: bounds.minY, z: 0 }, { x: 0, y: bounds.maxY, z: 1 }] },
        { connectionName: "future-b", points: [{ x: -0.41, y: -1, z: 0 }, { x: 0.73, y: 1, z: layerCount - 1 }] },
      ],
    }
    const candidate = new Solver({ ...options, fixedFutureConnectionGeometry: true })
    const reference = new Solver({ ...options, fixedFutureConnectionGeometry: false })
    reference.isViaTooCloseToFutureConnectionTrace = (node): boolean => originalFutureViaClearance(reference, node)
    candidate.solve()
    reference.solve()
    expect(candidate.solved || candidate.failed).toBe(true)
    expect({
      solved: candidate.solved, failed: candidate.failed, error: candidate.error,
      iterations: candidate.iterations, path: candidate.solvedPath,
      explored: candidate.debug_exploredNodesOrdered,
      blocked: [...candidate.debug_nodesTooCloseToObstacle],
      intersected: [...candidate.debug_nodePathToParentIntersectsObstacle],
      queued: candidate.candidates.getTopN(100),
    }).toEqual({
      solved: reference.solved, failed: reference.failed, error: reference.error,
      iterations: reference.iterations, path: reference.solvedPath,
      explored: reference.debug_exploredNodesOrdered,
      blocked: [...reference.debug_nodesTooCloseToObstacle],
      intersected: [...reference.debug_nodePathToParentIntersectsObstacle],
      queued: reference.candidates.getTopN(100),
    })
    if (readFutureViaMemo(candidate)) usedMemo++
    if (layerCount === 2) expect(readFutureViaMemo(candidate)).toBeUndefined()
    finished++
  }
  expect(usedMemo).toBeGreaterThan(0)
  expect(finished).toBe(24)
})
