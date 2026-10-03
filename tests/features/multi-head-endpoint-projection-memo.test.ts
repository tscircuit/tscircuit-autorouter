import { expect, test } from "bun:test"
import cn27515 from "fixtures/legacy/assets/cn27515-nodeWithPortPoints.json"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type {
  MHPoint2,
  PolyLine2,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { isDeepStrictEqual } from "node:util"
import { Frozen142EndpointForceSolver } from "../fixtures/Frozen142EndpointForceSolver"

test("endpoint memo retains frozen forces, movement and complete solver decisions", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "endpoint-memo-parity",
      center: { x: 0, y: 0 },
      width: 8,
      height: 8,
      portPoints: [],
      availableZ: [0, 1, 2],
    },
  }
  const frozen = new Frozen142EndpointForceSolver(params)
  const trial = new MultiHeadPolyLineIntraNodeSolver2(params)
  let seed = 319
  const random = (): number => {
    const product = Math.imul(seed, 1664525)
    const nextSeed = (product + 1013904223) >>> 0
    seed = nextSeed
    return seed / 2 ** 32
  }
  const cases: PolyLine2[][] = []
  for (let sample = 0; sample < 320; sample++) {
    const scale = [1e-200, 1e-150, 0.0005, 0.001, 0.01, 1, 1e120, 1e200][
      sample % 8
    ]!
    const lines: PolyLine2[] = []
    for (let lineIndex = 0; lineIndex < 5; lineIndex++) {
      const points: MHPoint2[] = []
      let layer = sample % 4 === 0 ? 0 : lineIndex % 3
      const pointCount = 2 + ((sample + lineIndex) % 7)
      for (let index = 0; index < pointCount; index++) {
        const nextLayer =
          sample % 4 !== 0 &&
          index > 0 &&
          index < pointCount - 1 &&
          (sample + index + lineIndex) % 3 === 0
            ? (layer + 1) % 3
            : layer
        const previous = points[index - 1]
        const duplicate = previous && (sample + index) % 5 === 0
        points.push({
          x: duplicate ? previous.x : (random() - 0.5) * scale,
          y: duplicate ? previous.y : (random() - 0.5) * scale,
          z1: layer,
          z2: nextLayer,
        })
        layer = nextLayer
      }
      if (sample % 11 === 0 && points.length > 3) {
        points[2] = points[1]!
      }
      lines.push({
        connectionName: `line-${lineIndex}`,
        start: points[0]!,
        end: points[points.length - 1]!,
        mPoints: points.slice(1, -1),
      })
    }
    cases.push(lines)
  }
  for (const distance of [
    0,
    -0,
    0.001 * (1 - Number.EPSILON),
    0.001,
    0.001 * (1 + Number.EPSILON),
  ]) {
    cases.push(
      [0, distance].map(
        (y, index): PolyLine2 => ({
          connectionName: `epsilon-${index}`,
          start: { x: -1, y, z1: 0, z2: 0 },
          end: { x: 1, y, z1: 0, z2: 0 },
          mPoints: [
            { x: 0, y, z1: 0, z2: 0 },
            { x: 0, y: index === 0 ? y : 0.002, z1: 0, z2: 0 },
          ],
        }),
      ),
    )
  }
  for (const lines of cases) {
    const expected = structuredClone(lines)
    const actual = structuredClone(lines)
    for (let pass = 0; pass < 6; pass++) {
      const oldResult = frozen.applyForcesToPolyLines(expected)
      const newResult = trial.applyForcesToPolyLines(actual)
      // Strict comparison retains signed zeros and NaNs in both force totals
      // and coordinates, including underflow/overflow cases.
      expect(isDeepStrictEqual(newResult, oldResult)).toBe(true)
      expect(isDeepStrictEqual(actual, expected)).toBe(true)
    }
  }

  const parallel: PolyLine2[] = [0, 1, 2].map(
    (line): PolyLine2 => ({
      connectionName: `parallel-${line}`,
      start: { x: -2, y: line * 0.2, z1: 0, z2: 0 },
      end: { x: 2, y: line * 0.2, z1: 0, z2: 0 },
      mPoints: [-1, 0, 1].map(
        (x): MHPoint2 => ({
          x,
          y: line * 0.2,
          z1: 0,
          z2: 0,
        }),
      ),
    }),
  )
  const originalExp = Math.exp
  let exponentialCalls = 0
  const expected = structuredClone(parallel)
  const actual = structuredClone(parallel)
  let oldCalls = 0
  let newCalls = 0
  try {
    Math.exp = (value: number): number => {
      const observedCalls = exponentialCalls + 1
      exponentialCalls = observedCalls
      const result = originalExp(value)
      return result
    }
    const oldResult = frozen.applyForcesToPolyLines(expected)
    oldCalls = exponentialCalls
    exponentialCalls = 0
    const newResult = trial.applyForcesToPolyLines(actual)
    newCalls = exponentialCalls
    expect(isDeepStrictEqual(newResult, oldResult)).toBe(true)
    expect(isDeepStrictEqual(actual, expected)).toBe(true)
  } finally {
    Math.exp = originalExp
  }
  expect(oldCalls).toBe(192)
  expect(newCalls).toBe(120)

  const solveParams = {
    nodeWithPortPoints: cn27515.nodeWithPortPoints,
    hyperParameters: { SEGMENTS_PER_POLYLINE: 4 },
  }
  const oldSolver = new Frozen142EndpointForceSolver(
    structuredClone(solveParams),
  )
  const newSolver = new MultiHeadPolyLineIntraNodeSolver2(
    structuredClone(solveParams),
  )
  oldSolver.solve()
  newSolver.solve()
  const state = (solver: MultiHeadPolyLineIntraNodeSolver2): object => ({
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    progress: solver.progress,
    phase: solver.phase,
    stats: solver.stats,
    lastCandidate: solver.lastCandidate,
    candidates: solver.candidates,
    solvedRoutes: solver.solvedRoutes,
  })
  expect(oldSolver.solved).toBe(true)
  expect(isDeepStrictEqual(state(newSolver), state(oldSolver))).toBe(true)
})
