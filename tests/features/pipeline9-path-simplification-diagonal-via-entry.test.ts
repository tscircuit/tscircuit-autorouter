import { expect, test } from "bun:test"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { Pipeline9LayerPreservingPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9LayerPreservingPathSolver"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

type CopperProjection = {
  wires: Array<{ start: number[]; end: number[]; z: number; width: number }>
  vias: ReturnType<typeof getPipeline9RouteCopperGeometry>["viaSpans"]
}

const copperProjection = (route: HighDensityRoute): CopperProjection => {
  const geometry = getPipeline9RouteCopperGeometry(route, { layerCount: 4 })
  return {
    wires: geometry.wireSegments.map((wire) => ({
      start: [wire.start.x, wire.start.y, wire.start.z],
      end: [wire.end.x, wire.end.y, wire.end.z],
      z: wire.z,
      width: wire.width,
    })),
    vias: geometry.viaSpans,
  }
}

test("path entry materializes explicit endpoint vias without narrowing copper or duplicating identities", () => {
  for (const viaAtStart of [true, false])
    for (const reversed of [false, true])
      for (const startWide of [true, false]) {
        const start = {
          x: 0,
          y: 0,
          z: reversed ? 3 : 1,
          traceThickness: startWide ? 0.5 : 0.1,
          pcb_port_id: "original-start",
          retainedIdentity: "start-identity",
        }
        const end = {
          x: 1,
          y: 0,
          z: reversed ? 1 : 3,
          traceThickness: startWide ? 0.1 : 0.5,
          pcb_port_id: "original-end",
          retainedIdentity: "end-identity",
        }
        const route: HighDensityRoute = {
          connectionName: "endpoint-via",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [start, end],
          vias: [{ x: viaAtStart ? start.x : end.x, y: 0 }],
        }
        const original = structuredClone(route)
        const canonical = canonicalizePipeline9HdRoutes([route])[0]!
        expect(copperProjection(canonical)).toEqual(copperProjection(route))
        expect(canonical.route[0]).toEqual(start)
        expect(canonical.route.at(-1)).toEqual(end)
        expect(canonical.route[1]).not.toHaveProperty("pcb_port_id")
        expect(canonical.route[1]).not.toHaveProperty("retainedIdentity")
        const solver = new Pipeline9LayerPreservingPathSolver({
          unsimplifiedHdRoutes: [route],
          obstacles: [],
        })
        solver.solve()
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        expect(copperProjection(solver.simplifiedHdRoutes[0]!)).toEqual(
          copperProjection(route),
        )
        expect(solver.simplifiedHdRoutes[0]!.route[0]).toEqual(start)
        expect(solver.simplifiedHdRoutes[0]!.route.at(-1)).toEqual(end)
        expect(solver.simplifiedHdRoutes[0]!.vias).toEqual(route.vias)
        expect(route).toEqual(original)
      }
  const nearby: HighDensityRoute = {
    connectionName: "nearby",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, traceThickness: 0.1 },
      { x: 0.75e-6, y: 0, z: 1, traceThickness: 0.5 },
    ],
    vias: [],
  }
  expect(
    copperProjection(canonicalizePipeline9HdRoutes([nearby])[0]!),
  ).toEqual(copperProjection(nearby))
  const throughObstacle: HighDensityRoute = {
    ...nearby,
    route: [
      { ...nearby.route[0]!, toNextSegmentType: "through_obstacle" },
      nearby.route[1]!,
    ],
  }
  expect(canonicalizePipeline9HdRoutes([throughObstacle])[0]!.route).toEqual(
    throughObstacle.route,
  )
})
