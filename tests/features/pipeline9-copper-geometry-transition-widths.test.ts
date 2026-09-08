import { expect, test } from "bun:test"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 endpoint resolution preserves original per-point wire widths", (): void => {
  for (const viaAtStart of [true, false]) {
    for (const startWidth of [0.35, 0.7]) {
      const start = { x: 0, y: 0, z: 0, traceThickness: startWidth }
      const end = {
        x: 2,
        y: 1,
        z: 1,
        traceThickness: startWidth === 0.35 ? 0.7 : 0.35,
      }
      const viaPoint = viaAtStart ? start : end
      const hdRoute: HighDensityRoute = {
        connectionName: "variable-width-transition",
        traceThickness: 0.15,
        viaDiameter: 0.55,
        route: [start, end],
        vias: [{ x: viaPoint.x, y: viaPoint.y }],
      }
      const originalRoute = structuredClone(hdRoute)
      const geometry = getPipeline9RouteCopperGeometry(hdRoute)
      expect(geometry.wireSegments[0]!.width).toBe(0.7)
      expect(geometry.wireSegments[0]!.z).toBe(viaAtStart ? 1 : 0)
      expect(geometry.viaSpans[0]!.diameter).toBe(0.55)
      expect(hdRoute).toEqual(originalRoute)
    }
  }
})
