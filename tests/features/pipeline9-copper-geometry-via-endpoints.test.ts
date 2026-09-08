import { expect, test } from "bun:test"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 copper geometry follows either explicit transition endpoint", (): void => {
  for (const viaAtStart of [true, false]) {
    for (const startZ of [0, 2]) {
      const start = { x: 0, y: 0, z: startZ }
      const end = { x: 2, y: 1, z: 2 - startZ }
      const viaPoint = viaAtStart ? start : end
      const wireZ = viaAtStart ? end.z : start.z
      const hdRoute: HighDensityRoute = {
        connectionName: "explicit-transition-endpoint",
        traceThickness: 0.15,
        viaDiameter: 0.55,
        route: [start, end],
        vias: [{ x: viaPoint.x, y: viaPoint.y }],
      }
      const originalRoute = structuredClone(hdRoute)
      const geometry = getPipeline9RouteCopperGeometry(hdRoute)

      expect(geometry.viaSpans).toEqual([
        {
          center: { x: viaPoint.x, y: viaPoint.y },
          minZ: 0,
          maxZ: 2,
          diameter: 0.55,
        },
      ])
      expect(geometry.wireSegments).toEqual([
        {
          start: { ...start, z: wireZ },
          end: { ...end, z: wireZ },
          z: wireZ,
          width: 0.15,
        },
      ])
      const materializedRoute = materializePipeline9HdRouteVias([hdRoute])[0]!
      expect(getPipeline9RouteCopperGeometry(materializedRoute)).toEqual(geometry)
      expect(hdRoute).toEqual(originalRoute)
    }
  }
})
