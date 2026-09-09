import { expect, test } from "bun:test"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 rejects missing and ambiguous non-colocated transition vias", (): void => {
  const cases = [
    { vias: [], message: "without an explicit via" },
    { vias: [{ x: 1, y: 0.5 }], message: "without an explicit via" },
    {
      vias: [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
      ],
      message: "ambiguous layer transition",
    },
  ]
  for (const { vias, message } of cases) {
    const hdRoute: HighDensityRoute = {
      connectionName: "invalid-transition",
      traceThickness: 0.15,
      viaDiameter: 0.55,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 1, z: 1 },
      ],
      vias,
    }
    const originalRoute = structuredClone(hdRoute)
    expect(() => getPipeline9RouteCopperGeometry(hdRoute)).toThrow(message)
    expect(() => materializePipeline9HdRouteVias([hdRoute])).toThrow(message)
    expect(hdRoute).toEqual(originalRoute)
  }
})
