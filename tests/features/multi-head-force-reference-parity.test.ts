import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type {
  MHPoint2,
  PolyLine2,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { Frozen142EndpointForceSolver } from "tests/fixtures/Frozen142EndpointForceSolver"

test("cached force references preserve finite segment/via forces, fixed endpoints, and route copper exactly", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "force-reference-parity",
      center: { x: 0, y: 0 },
      width: 6,
      height: 6,
      availableZ: [0, 1, 2],
      portPoints: [],
    },
    viaDiameter: 0.3,
  }
  const optimized = new MultiHeadPolyLineIntraNodeSolver2(params)
  // This fixture is the frozen pre-optimization force pass, including via
  // interactions and boundary forces; it does not share force accumulation.
  const reference = new Frozen142EndpointForceSolver(params)
  let seed = 71043
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  let movingPasses = 0
  for (let sample = 0; sample < 60; sample++) {
    const scale = [1e-200, 0.001, 0.1, 1, 6][sample % 5]!
    optimized.BOUNDARY_PADDING = reference.BOUNDARY_PADDING =
      sample % 2 === 0 ? 0.05 : -0.05
    const lines: PolyLine2[] = []
    for (let lineIndex = 0; lineIndex < 5; lineIndex++) {
      const pointCount = 2 + ((sample + lineIndex) % 5)
      const points: MHPoint2[] = []
      let layer = (sample + lineIndex) % 3
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
        const nextLayer =
          (sample + lineIndex + pointIndex) % 3 === 0 ? (layer + 1) % 3 : layer
        const repeated = pointIndex > 0 && (sample + pointIndex) % 4 === 0
        points.push({
          x: repeated ? points[pointIndex - 1]!.x : (random() - 0.5) * scale,
          y: repeated ? points[pointIndex - 1]!.y : (random() - 0.5) * scale,
          z1: layer,
          z2: nextLayer,
        })
        layer = nextLayer
      }
      lines.push({
        connectionName: `line-${lineIndex}`,
        start: points[0]!,
        end: points.at(-1)!,
        mPoints: points.slice(1, -1),
      })
    }
    const expected = structuredClone(lines)
    const fixedEndpoints = lines.map((line) => ({
      start: { ...line.start },
      end: { ...line.end },
    }))
    for (let pass = 0; pass < 4; pass++) {
      const originalPositions = lines.map((line) =>
        line.mPoints.map((point) => ({ x: point.x, y: point.y })),
      )
      const result = optimized.applyForcesToPolyLines(lines)
      expect(result).toEqual(reference.applyForcesToPolyLines(expected))
      if (result.lastStepMoved) movingPasses++
      expect(lines).toEqual(expected)
      expect(
        lines.map((line) => ({ start: line.start, end: line.end })),
      ).toEqual(fixedEndpoints)
      // Observe each applied displacement, including clamped points and vias.
      expect(
        lines.map((line, i) =>
          line.mPoints.map((point, j) => ({
            x: point.x - originalPositions[i]![j]!.x,
            y: point.y - originalPositions[i]![j]!.y,
          })),
        ),
      ).toEqual(
        expected.map((line, i) =>
          line.mPoints.map((point, j) => ({
            x: point.x - originalPositions[i]![j]!.x,
            y: point.y - originalPositions[i]![j]!.y,
          })),
        ),
      )
    }
    for (const [solver, polyLines] of [
      [optimized, lines],
      [reference, expected],
    ] as const) {
      solver.lastCandidate = {
        polyLines,
        g: 0,
        h: 0,
        f: 0,
        minGaps: [],
        viaCount: 0,
      }
      solver.solved = true
      solver._setSolvedRoutes()
    }
    expect(optimized.solvedRoutes).toEqual(reference.solvedRoutes)
  }
  expect(movingPasses).toBeGreaterThan(0)
})
