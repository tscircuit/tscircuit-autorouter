import { RelaxTraceClearanceSolver, type RelaxTraceClearanceInput } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9IndexedRelaxTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9IndexedRelaxTraceClearanceSolver"
import { projectionInput } from "../fixtures/repair04StepFixtures"

test("indexed projection preserves every logical pair batch, sweep and exact displacement", (): void => {
  const routes = Array.from({ length: 72 }, (_, index) => {
    const x = (index % 12) * 4 - 22
    const y = Math.floor(index / 12) * 4 - 10
    return {
      connectionName: `signal${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: x - 1, y, z: index % 2 },
        { x, y: y + 0.12, z: index % 2 },
        { x: x + 1, y, z: index % 2 },
      ],
    }
  })
  const bounds = { minX: -30, maxX: 30, minY: -15, maxY: 15 }
  const wide: RelaxTraceClearanceInput = {
    ...projectionInput,
    routes,
    bounds,
    srj: {
      bounds, layerCount: 2, minTraceWidth: 0.1, connections: [],
      obstacles: routes.map((route, index) => ({
        type: "rect" as const,
        center: { x: route.route[1]!.x, y: route.route[1]!.y + 0.23 },
        width: 0.4, height: 0.2,
        ccwRotationDegrees: index % 3 === 0 ? 1 : 0,
        layers: [index % 2 === 0 ? "top" : "bottom"],
        connectedTo: [`foreign${index}`],
      })),
    },
    lockedPointIndices: routes.map(() => [true, false, true]),
  }
  const far: RelaxTraceClearanceInput = {
    ...wide,
    routes: routes.map((route) => ({
      ...route, route: route.route.map((point) => ({ ...point, x: point.x + 20_000 })),
    })),
    srj: {
      ...wide.srj,
      obstacles: wide.srj.obstacles.map((obstacle) => ({
        ...obstacle, center: { ...obstacle.center, x: obstacle.center.x + 20_000 },
      })),
    },
    bounds: { ...bounds, minX: bounds.minX + 20_000, maxX: bounds.maxX + 20_000 },
  }
  const vias = [0, 0.1].map((x, index) => ({
    connectionName: `via${index}`, traceThickness: 0.095, viaDiameter: 0.3,
    vias: [{ x, y: index * 0.3 }],
    route: [
      { x: -1, y: index * 0.3, z: 0 },
      { x, y: index * 0.3, z: 0 },
      { x, y: index * 0.3, z: 1 },
      { x: 1, y: index * 0.3, z: 1 },
    ],
  }))
  const viaInput: RelaxTraceClearanceInput = {
    ...projectionInput, routes: vias,
    srj: { ...projectionInput.srj, layerCount: 2, obstacles: [
      { type: "rect", center: { x: 0, y: -0.35 }, width: 0.6, height: 0.2, layers: ["top"], connectedTo: ["foreign0"] },
      { type: "rect", center: { x: 0.1, y: 0.65 }, width: 0.6, height: 0.2, layers: ["top"], connectedTo: ["foreign1"] },
    ] },
    lockedPointIndices: vias.map(() => [true, false, false, true]),
    allowViaMovement: true,
  }
  let changed = 0
  let fullPairBatches = 0
  for (const input of [projectionInput, wide, far, viaInput]) {
    const original = structuredClone(input.routes)
    const baseline = new RelaxTraceClearanceSolver(input)
    const indexed = new Pipeline9IndexedRelaxTraceClearanceSolver(input)
    while (!baseline.solved && !baseline.failed) {
      baseline.step()
      indexed.step()
      expect(indexed.stats).toEqual(baseline.stats)
      expect(indexed.progress).toBe(baseline.progress)
      expect(indexed.solved).toBe(baseline.solved)
      expect(indexed.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
      if (baseline.stats.lastPreparedPairBatchCount === 4096) fullPairBatches++
    }
    expect(indexed.failed).toBeFalse()
    expect(indexed.getOutput()).toEqual(baseline.getOutput())
    expect(indexed.iterations).toBe(baseline.iterations)
    expect(indexed.stats.sweepCount).toBe(256)
    expect(input.routes).toEqual(original)
    if (JSON.stringify(indexed.getOutput()) !== JSON.stringify(original)) changed++
  }
  expect(fullPairBatches).toBeGreaterThan(2)
  expect(changed).toBeGreaterThan(2)
})
