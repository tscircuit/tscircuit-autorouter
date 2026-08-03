import { expect, test } from "bun:test"
import { SafePostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/SafePostProcessingSolver"

test("Pipeline7 preserves routed copper when opposite-side pair terminals cannot be coupled", () => {
  const createPad = (x: number, y: number, connectionName?: string) => ({
    type: "rect" as const,
    layers: ["top"],
    center: { x, y },
    width: 1,
    height: 0.6,
    connectedTo: connectionName ? [connectionName] : [],
  })
  const params = {
    hdRoutes: [
      {
        connectionName: "source_trace_1",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: -7.15, y: 0.635, z: 0, traceThickness: 0.15 },
          {
            x: -6.410152979700772,
            y: -0.10484702029922843,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: 6.619847020299229,
            y: -0.10484702029922849,
            z: 0,
            traceThickness: 0.15,
          },
          { x: 7.15, y: -0.635, z: 0, traceThickness: 0.15 },
        ],
        vias: [],
      },
      {
        connectionName: "source_trace_0",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: -7.15, y: 1.905, z: 0, traceThickness: 0.15 },
          {
            x: -6.61985218617334,
            y: 2.4351478138266605,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: 2.3198521861733394,
            y: 2.4351478138266605,
            z: 0,
            traceThickness: 0.15,
          },
          { x: 2.85, y: 1.905, z: 0, traceThickness: 0.15 },
        ],
        vias: [],
      },
    ],
    differentialPairs: [
      {
        connectionNames: ["source_trace_0", "source_trace_1"] as [
          string,
          string,
        ],
        lengthTolerance: 0.05,
      },
    ],
    obstacles: [
      createPad(-7.15, 1.905, "source_trace_0"),
      createPad(-7.15, 0.635, "source_trace_1"),
      createPad(-7.15, -0.635),
      createPad(-7.15, -1.905),
      createPad(-2.85, -1.905),
      createPad(-2.85, -0.635),
      createPad(-2.85, 0.635),
      createPad(-2.85, 1.905),
      createPad(2.85, 1.905, "source_trace_0"),
      createPad(2.85, 0.635),
      createPad(2.85, -0.635),
      createPad(2.85, -1.905),
      createPad(7.15, -1.905),
      createPad(7.15, -0.635, "source_trace_1"),
      createPad(7.15, 0.635),
      createPad(7.15, 1.905),
    ],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    layerCount: 2,
  }
  const originalRoutes = structuredClone(params.hdRoutes)
  const solver = new SafePostProcessingSolver(params)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.usedFallback).toBe(true)
  expect(solver.stats).toEqual({
    phase: "fallback",
    reason: "no-valid-candidate",
    pair: "source_trace_0/source_trace_1",
  })
  expect(solver.getOutput().hdRoutes).toEqual(originalRoutes)
})
