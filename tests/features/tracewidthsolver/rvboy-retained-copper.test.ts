import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  TraceWidthSolver,
  type TraceWidthSolverInput,
} from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { renderRvboyRoutingView } from "../../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

type Capture = Omit<TraceWidthSolverInput, "connMap"> & {
  connMap: Record<string, string[]>
}

const minimumGap = (
  route: HighDensityRoute,
  retained: HighDensityRoute[],
): number => {
  let gap = Infinity
  for (let i = 1; i < route.route.length; i++) {
    const a = route.route[i - 1]!,
      b = route.route[i]!
    if (a.z !== b.z) continue
    for (const other of retained)
      for (let j = 1; j < other.route.length; j++) {
        const c = other.route[j - 1]!,
          d = other.route[j]!
        if (c.z !== d.z || a.z !== c.z) continue
        gap = Math.min(
          gap,
          segmentToSegmentMinDistance(a, b, c, d) -
            (a.traceThickness ?? route.traceThickness) / 2 -
            (c.traceThickness ?? other.traceThickness) / 2,
        )
      }
  }
  return gap
}

test("RVboy ground width clears previously routed VSYS copper", async (): Promise<void> => {
  // Exact full width-stage input. Crop only the comparison view, never the solve.
  const [capture] = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../../fixtures/rvboy-width-retained-copper.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as [Capture]
  const original = structuredClone(capture)
  const params = { ...capture, connMap: new ConnectivityMap(capture.connMap) }
  const beforeSolver = new TraceWidthSolver({ ...params, otherHdRoutes: [] })
  beforeSolver.solve()
  const afterSolver = new TraceWidthSolver(params)
  afterSolver.solve()
  expect(afterSolver.solved).toBe(true)
  expect(afterSolver.failed).toBe(false)
  expect(capture).toEqual(original)
  expect(afterSolver.getHdRoutesWithWidths()).toHaveLength(
    capture.hdRoutes.length,
  )
  const retained = capture.otherHdRoutes!.filter(
    (r) => r.rootConnectionName === "source_trace_115",
  )
  expect(retained.length).toBeGreaterThan(0)
  const names = [52, 58, 59].map(
    (n) =>
      `source_trace_121__source_trace_122__source_trace_134__source_trace_135__source_trace_136__source_net_0_mst${n}`,
  )
  for (const name of names) {
    const before = beforeSolver
      .getHdRoutesWithWidths()
      .find((r) => r.connectionName === name)!
    const after = afterSolver
      .getHdRoutesWithWidths()
      .find((r) => r.connectionName === name)!
    expect(minimumGap(before, retained)).toBeLessThan(0.1)
    expect(minimumGap(after, retained)).toBeGreaterThanOrEqual(0.1 - 1e-9)
    expect(after.route[0]!.x).toBe(before.route[0]!.x)
    expect(after.route[0]!.y).toBe(before.route[0]!.y)
    expect(after.route.at(-1)!.x).toBe(before.route.at(-1)!.x)
    expect(after.route.at(-1)!.y).toBe(before.route.at(-1)!.y)
  }
  const viewbox = { minX: -31.2, maxX: -29.2, minY: 19.8, maxY: 21.5 }
  for (const [name, solver] of [
    ["before", beforeSolver],
    ["after", afterSolver],
  ] as const) {
    const routes = [
      ...retained,
      ...solver
        .getHdRoutesWithWidths()
        .filter((r) => r.connectionName === names[2]),
    ]
    const graphics = convertSrjToGraphicsObject({
      bounds: viewbox,
      layerCount: 4,
      minTraceWidth: 0.1,
      connections: [],
      obstacles: capture.obstacles!.filter(
        (o) =>
          !o.isCopperPour &&
          o.center.x + o.width / 2 >= viewbox.minX &&
          o.center.x - o.width / 2 <= viewbox.maxX &&
          o.center.y + o.height / 2 >= viewbox.minY &&
          o.center.y - o.height / 2 <= viewbox.maxY,
      ),
      traces: routes.map((r) => ({
        type: "pcb_trace" as const,
        pcb_trace_id: r.connectionName,
        connection_name: r.connectionName,
        route: convertHdRouteToSimplifiedRoute(r, 4),
      })),
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: ground width beside retained VSYS",
        name === "before"
          ? "Before: widening ignores the existing supply trace"
          : "After: width selection preserves clearance to existing copper",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
