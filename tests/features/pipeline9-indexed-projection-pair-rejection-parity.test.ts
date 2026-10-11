import { RelaxTraceClearanceSolver, type RelaxTraceClearanceInput } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9IndexedRelaxTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9IndexedRelaxTraceClearanceSolver"
import { projectionInput } from "../fixtures/repair04StepFixtures"

type PairDiagnostic = { separated: boolean }
type SolverDiagnostic = {
  pairs: PairDiagnostic[]
  canRejectSeparatedPairs: boolean
}

test("current pair separation preserves exact sweeps and recomputes after far vertices approach", (): void => {
  const routes = [0, 0.3].map((y, index) => ({
    connectionName: `signal${index}`, traceThickness: 0.1, viaDiameter: 0.3,
    vias: [],
    route: [{ x: -2, y, z: 0 }, { x: 0, y, z: 0 }, { x: 2, y, z: 0 }],
  }))
  const movement: RelaxTraceClearanceInput = {
    ...projectionInput, routes,
    lockedPointIndices: routes.map(() => [true, false, true]),
    srj: {
      ...projectionInput.srj, layerCount: 2,
      obstacles: [{
        type: "rect", center: { x: 0, y: 0.46 }, width: 0.4, height: 0.3,
        layers: ["top"], connectedTo: ["foreign"],
      }],
    },
  }
  const cases: { input: RelaxTraceClearanceInput; eligible: boolean; movement?: boolean; rejected?: boolean }[] = [
    { input: movement, eligible: true, movement: true },
  ]
  for (const offset of [-1e-10, 1e-10, 1e-7]) {
    cases.push({
      input: {
        ...movement,
        routes: [0, 0.2 + offset].map((y, index) => ({
          ...routes[index]!, route: routes[index]!.route.map((point) => ({ ...point, y })),
        })),
        srj: { ...movement.srj, obstacles: [] },
      },
      eligible: true,
      rejected: offset > 4e-8,
    })
    const coordinate = (0.4 + offset) / Math.SQRT2
    const vias = [0, coordinate].map((position, index) => ({
      connectionName: `via${index}`, traceThickness: 0.1, viaDiameter: 0.3,
      vias: [{ x: position, y: position }],
      route: [{ x: position, y: position, z: 0 }, { x: position, y: position, z: 1 }],
    }))
    cases.push({
      input: {
        ...movement, routes: vias, allowViaMovement: true,
        lockedPointIndices: vias.map(() => [false, false]),
        srj: { ...movement.srj, obstacles: [] },
      },
      eligible: true,
      rejected: offset > 4e-8,
    })
  }
  const farBounds = { ...movement.bounds, minX: movement.bounds.minX + 20_000, maxX: movement.bounds.maxX + 20_000 }
  cases.push({
    input: {
      ...movement, bounds: farBounds,
      routes: movement.routes.map((route) => ({
        ...route, route: route.route.map((point) => ({ ...point, x: point.x + 20_000 })),
      })),
      srj: {
        ...movement.srj, bounds: farBounds,
        obstacles: movement.srj.obstacles.map((obstacle) => ({
          ...obstacle, center: { ...obstacle.center, x: obstacle.center.x + 20_000 },
        })),
      },
    }, eligible: false,
  })
  const wideBounds = { minX: -20_000, maxX: 20_000, minY: -20_000, maxY: 20_000 }
  cases.push({
    input: { ...movement, bounds: wideBounds, srj: { ...movement.srj, bounds: wideBounds } },
    eligible: false,
  })
  let reactivatedPairs = 0
  for (const fixture of cases) {
    const baseline = new RelaxTraceClearanceSolver(fixture.input)
    const indexed = new Pipeline9IndexedRelaxTraceClearanceSolver(fixture.input)
    const diagnostic = indexed as unknown as SolverDiagnostic
    const everSeparated = new Set<PairDiagnostic>()
    let rejected = false
    while (!baseline.solved && !baseline.failed) {
      baseline.step()
      indexed.step()
      expect(indexed.stats).toEqual(baseline.stats)
      expect(indexed.progress).toBe(baseline.progress)
      expect(indexed.solved).toBe(baseline.solved)
      expect(indexed.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
      for (const pair of diagnostic.pairs) {
        if (pair.separated) {
          everSeparated.add(pair)
          rejected = true
        } else if (everSeparated.delete(pair)) {
          reactivatedPairs++
        }
      }
    }
    expect(indexed.failed).toBeFalse()
    expect(indexed.getOutput()).toEqual(baseline.getOutput())
    expect(indexed.iterations).toBe(baseline.iterations)
    expect(indexed.stats.sweepCount).toBe(256)
    expect(diagnostic.canRejectSeparatedPairs).toBe(fixture.eligible)
    if (fixture.rejected !== undefined) expect(rejected).toBe(fixture.rejected)
    if (!fixture.eligible) expect(rejected).toBeFalse()
    if (fixture.movement) {
      expect(rejected).toBeTrue()
      expect(indexed.getOutput()[0]!.route[1]!.y).toBeLessThan(-0.01)
    }
  }
  expect(reactivatedPairs).toBeGreaterThanOrEqual(4)
})
