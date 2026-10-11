import {
  FindClearancePathSolver,
  type ClearancePathInput,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9DenseClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9DenseClearancePathSolver"
import { pathInput } from "../fixtures/repair04StepFixtures"

test("dense clearance paths preserve exact geometry and search accounting across grid and via policies", (): void => {
  const bounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 }
  const route = {
    connectionName: "wire",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1.8, y: 0, z: 0 },
      { x: 1.8, y: 0, z: 0 },
    ],
  }
  const layered: ClearancePathInput = {
    ...pathInput,
    bounds,
    srj: {
      bounds,
      layerCount: 4,
      minTraceWidth: 0.1,
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 0.4,
          height: 3.8,
          layers: ["top"],
          connectedTo: ["barrier"],
        },
      ],
    },
    routes: [route],
    start: route.route[0]!,
    end: route.route[1]!,
    allowLayerChanges: true,
    maxNodes: 12_000,
  }
  const smallBounds = { minX: 0, maxX: 0.2, minY: -2, maxY: 2 }
  const inputs: ClearancePathInput[] = [
    pathInput,
    { ...pathInput, heuristicWeight: 3, maxNodes: 3_000 },
    layered,
    { ...layered, heuristicWeight: 3 },
    {
      ...layered,
      srj: { ...layered.srj, allowBlindAndBuriedVias: true },
      heuristicWeight: 3,
    },
    {
      ...layered,
      end: { ...layered.end, z: 3 },
      heuristicWeight: 3,
    },
    {
      ...layered,
      bounds: smallBounds,
      srj: { ...layered.srj, bounds: smallBounds, obstacles: [] },
      gridSize: 0.1,
      start: { x: 0.05, y: -1.8, z: 0 },
      end: { x: 0.05, y: 1.8, z: 0 },
    },
    {
      ...layered,
      bounds: { minX: -200, maxX: 200, minY: -200, maxY: 200 },
      gridSize: 0.1,
      maxNodes: 512,
    },
  ]
  let found = 0
  for (const input of inputs) {
    const source = structuredClone({ srj: input.srj, routes: input.routes })
    const baseline = new FindClearancePathSolver(input)
    const dense = new Pipeline9DenseClearancePathSolver(input)
    while (!baseline.solved && !baseline.failed) {
      baseline.step()
      dense.step()
      expect(dense.stats).toEqual(baseline.stats)
      expect(dense.solved).toBe(baseline.solved)
    }
    expect(dense.failed).toBeFalse()
    expect(dense.getOutput()).toEqual(baseline.getOutput())
    expect(dense.iterations).toBe(baseline.iterations)
    expect(dense.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
    expect({ srj: input.srj, routes: input.routes }).toEqual(source)
    if (dense.getOutput()) found++
  }
  expect(found).toBeGreaterThan(3)
})
