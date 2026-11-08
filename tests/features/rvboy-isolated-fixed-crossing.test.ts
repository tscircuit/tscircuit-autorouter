import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  constrainBoundaryPortCapacity,
  type PortGeometry,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/constrainBoundaryPortCapacity"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { SimpleRouteJson } from "lib/types"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy fixed crossings remain owned without a serialized region assignment", async (): Promise<void> => {
  const fixture: {
    input: SimpleRouteJson
    beforeGraph: SerializedHyperGraph
    geometry: PortGeometry
    beforeSegments: Array<Array<{ x: number; y: number }>>
  } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-isolated-fixed-crossing.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(fixture)
  const portId = "ce24213_retained0_z0::0"
  const before = fixture.beforeGraph.ports.find(
    (port) => port.portId === portId,
  )!
  expect(before.d!.clearanceAllowedNetIds).toBeUndefined()
  expect(
    fixture.beforeGraph.regions
      .flatMap((region) => region.assignments ?? [])
      .some(
        (assignment) =>
          assignment.regionPort1Id === portId ||
          assignment.regionPort2Id === portId,
      ),
  ).toBe(false)
  const constrained = constrainBoundaryPortCapacity(
    fixture.beforeGraph,
    fixture.geometry,
  )
  const after = constrained.ports.find((port) => port.portId === portId)!
  expect(after.d!.clearanceAllowedNetIds).toEqual(["connectivity_net30"])
  expect(after.d!.clearanceAllowedNetIds).not.toContain("connectivity_net11")
  // Movable retained copper must remain negotiable graph occupancy.
  const movableGraph = structuredClone(fixture.beforeGraph)
  for (const port of movableGraph.ports)
    for (const assignment of port.d?._preloadedTracePortAssignments ?? [])
      assignment.isFixed = false
  const movable = constrainBoundaryPortCapacity(movableGraph, {
    ...fixture.geometry,
    retainedRoutes: fixture.geometry.retainedRoutes.map((route) => ({
      ...route,
      isFixed: false,
    })),
  })
  expect(
    movable.ports.find((port) => port.portId === portId)!.d!
      .clearanceAllowedNetIds,
  ).toBeUndefined()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.input,
    { effort: 5, cacheProvider: null },
  )
  while (!solver.highDensityRouteSolver && !solver.failed && !solver.solved)
    solver.step()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.uniformPortDistributionSolver!.solved).toBe(true)
  expect(
    solver
      .uniformPortDistributionSolver!.getOutput()
      .flatMap((node) => node.portPoints)
      .filter(
        (port) =>
          port.portPointId === portId &&
          port.connectionName ===
            "source_trace_41__source_trace_42__source_trace_43_mst2",
      ),
  ).toHaveLength(0)
  expect(JSON.stringify(fixture)).toBe(original)
  for (const [name, port] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const owned = port.d!.clearanceAllowedNetIds !== undefined
    const graphics: GraphicsObject = { lines: [], circles: [], rects: [] }
    for (const route of fixture.geometry.retainedRoutes) {
      if (!route.isFixed) continue
      const copper = getPipeline9RouteCopperGeometry(route, fixture.geometry)
      graphics.lines!.push(
        ...copper.wireSegments
          .filter((wire) => wire.z === 0)
          .map((wire) => ({
            points: [wire.start, wire.end],
            strokeWidth: wire.width,
            strokeColor: "#fdba74",
          })),
      )
    }
    graphics.lines!.push({
      points: [
        { x: -30.8998371, y: -29.550001 },
        { x: -30.6498249, y: -29.550001 },
      ],
      strokeColor: "#334155",
      strokeWidth: 0.012,
    })
    graphics.circles!.push({
      center: { x: port.d!.x, y: port.d!.y },
      radius: 0.05,
      fill: owned ? "#16a34a" : "#dc2626",
      stroke: "white",
    })
    if (!owned)
      graphics.lines!.push(
        ...fixture.beforeSegments.map((points) => ({
          points,
          strokeColor: "#dc2626",
          strokeWidth: fixture.geometry.traceWidth,
        })),
      )
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: -31.1, maxX: -30.55, minY: -29.85, maxY: -29.25 },
        "RVboy: one fixed crossing, no serialized route segment",
        owned
          ? "After: crossing belongs only to the fixed net; foreign route excluded"
          : "Before: foreign power net admitted onto the fixed copper crossing",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
