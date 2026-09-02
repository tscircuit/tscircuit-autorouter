import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const createSolverWithParallelRoute = ({
  inputTraceThickness,
  otherTraceThickness,
  centerlineDistance,
}: {
  inputTraceThickness: number
  otherTraceThickness: number
  centerlineDistance: number
}): SingleSimplifiedPathSolver5 => {
  const inputRoute: HighDensityIntraNodeRoute = {
    connectionName: "input",
    traceThickness: inputTraceThickness,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const otherRoute: HighDensityIntraNodeRoute = {
    connectionName: "other",
    traceThickness: otherTraceThickness,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: centerlineDistance, z: 0 },
      { x: 2, y: centerlineDistance, z: 0 },
    ],
    vias: [],
  }

  return new SingleSimplifiedPathSolver5({
    inputRoute,
    otherHdRoutes: [otherRoute],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
  })
}

test("path simplification keeps the legacy narrow-trace envelope and expands it for wide traces", () => {
  const narrowCollision = createSolverWithParallelRoute({
    inputTraceThickness: 0.1,
    otherTraceThickness: 0.1,
    centerlineDistance: 0.249,
  })
  const narrowClear = createSolverWithParallelRoute({
    inputTraceThickness: 0.1,
    otherTraceThickness: 0.1,
    centerlineDistance: 0.251,
  })
  const wideCollision = createSolverWithParallelRoute({
    inputTraceThickness: 0.1,
    otherTraceThickness: 0.3,
    centerlineDistance: 0.324,
  })
  const wideClear = createSolverWithParallelRoute({
    inputTraceThickness: 0.1,
    otherTraceThickness: 0.3,
    centerlineDistance: 0.326,
  })
  const candidateStart = { x: 0, y: 0, z: 0 }
  const candidateEnd = { x: 2, y: 0, z: 0 }

  expect(
    narrowCollision.isValidPathSegment(candidateStart, candidateEnd),
  ).toBe(false)
  expect(narrowClear.isValidPathSegment(candidateStart, candidateEnd)).toBe(
    true,
  )
  expect(wideCollision.isValidPathSegment(candidateStart, candidateEnd)).toBe(
    false,
  )
  expect(wideClear.isValidPathSegment(candidateStart, candidateEnd)).toBe(true)
  expect(narrowCollision.simplifiedRoute.traceThickness).toBe(0.1)
})
