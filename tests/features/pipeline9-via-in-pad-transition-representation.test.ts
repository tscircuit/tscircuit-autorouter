import { expect, test } from "bun:test"
import { createViaInPadEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createViaInPadEvaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("via-in-pad validation canonicalizes supported transition representations", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.45,
    minViaHoleDiameter: 0.2,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["pcb_port_other"],
        circuitJsonMetadata: { pcb_smtpad_id: "pad_other" },
      },
    ],
  }
  const evaluate = createViaInPadEvaluator({ srj, previousRoutes: [] })
  for (const x of [1e-8, 1]) {
    const route: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.45,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: 0, y: 0, z: 0 },
        { x, y: 0, z: 3 },
      ],
    }
    const original = structuredClone(route)
    expect(evaluate([route])).toBe(true)
    expect(
      createViaInPadEvaluator({ srj, previousRoutes: [route] })([route]),
    ).toBe(false)
    expect(route).toEqual(original)
  }
  expect(() =>
    evaluate([
      {
        connectionName: "invalid",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        vias: [],
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 3 },
        ],
      },
    ]),
  ).toThrow()
})
