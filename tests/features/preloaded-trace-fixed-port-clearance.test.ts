import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("fixed RVboy bypasses reserve clearance beside edges they do not cross", async (): Promise<void> => {
  const fixture: {
    srj: SimpleRouteJson
    sharedEdgeSegments: SharedEdgeSegment[]
  } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-fixed-port-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const before = structuredClone(
    fixture.sharedEdgeSegments.find((edge) => edge.edgeId === "ce42000")!,
  )
  const originalSrj = JSON.stringify(fixture.srj)
  const solver = new PreloadedTraceGraphSolver(
    fixture.sharedEdgeSegments,
    fixture.srj,
  )
  solver.solve()
  const after = solver
    .getOutput()
    .find((edge) => edge.edgeId === before.edgeId)!
  expect(solver.solved).toBe(true)
  expect(
    after.portPoints.filter((port) => port.availableZ.includes(0)),
  ).toHaveLength(0)
  expect(
    after.portPoints.filter((port) => port.availableZ.includes(3)),
  ).toEqual(before.portPoints.filter((port) => port.availableZ.includes(3)))
  expect(JSON.stringify(fixture.srj)).toBe(originalSrj)
  expect(solver.stats.fixedClearancePortLayerCount).toBeGreaterThan(0)
  const viewbox = { minX: 1.25, maxX: 2.18, minY: 4.2, maxY: 5.8 }
  for (const [name, edge] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const graphics: GraphicsObject = { lines: [], circles: [] }
    for (const trace of fixture.srj.traces!) {
      if (trace.isFixed !== true) continue
      for (let i = 1; i < trace.route.length; i++) {
        const a = trace.route[i - 1]!,
          b = trace.route[i]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== "top" ||
          b.layer !== "top"
        )
          continue
        graphics.lines!.push({
          points: [a, b],
          strokeColor: "#d97706",
          strokeWidth: a.width,
        })
      }
    }
    graphics.lines!.push({
      points: [edge.start, edge.end],
      strokeColor: "#64748b",
      strokeWidth: 0.008,
    })
    for (const port of edge.portPoints.filter((port) =>
      port.segmentPortPointId.endsWith("z0"),
    )) {
      graphics.circles!.push({
        center: port,
        radius: fixture.srj.minTraceWidth / 2,
        fill: port.availableZ.includes(0) ? "#0284c7" : "#e2e8f0",
        stroke: port.availableZ.includes(0) ? "#0284c7" : "#64748b",
      })
    }
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: fixed bypass beside a mesh boundary",
        name === "before"
          ? "Before: blue top-layer ports violate the bypass clearance"
          : "After: blocked top-layer ports; bottom-layer passage stays available",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
