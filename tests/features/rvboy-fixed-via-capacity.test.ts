import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import {
  constrainBoundaryPortCapacity,
  type PortGeometry,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/constrainBoundaryPortCapacity"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

test("exact RVboy pad escape accounts for the retained via before admitting its net", async (): Promise<void> => {
  const captured: {
    graph: SerializedHyperGraph
    geometry: PortGeometry
    beforeAllowedNetIds: string[]
  } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-fixed-via-capacity.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(captured)
  const output = constrainBoundaryPortCapacity(
    captured.graph,
    captured.geometry,
  )
  const portId = "ce41527_pp0_z0_cramped::0"
  const port = output.ports.find((p) => p.portId === portId)!
  const connMap = new ConnectivityMap(captured.geometry.netMap)
  const signalNet = connMap.getNetConnectedToId("source_net_55")!
  expect(captured.beforeAllowedNetIds).toContain(signalNet)
  expect(port.d!.clearanceAllowedNetIds).not.toContain(signalNet)
  expect(port.d!.clearanceAllowedNetIds).toEqual(["connectivity_net73"])
  expect(JSON.stringify(captured)).toBe(original)
  const remaining = new Set(output.ports.map((p) => p.portId))
  expect(
    captured.graph.ports
      .filter(
        (p) =>
          p.d?._preloadedTracePortAssignments?.length &&
          typeof p.d?.duplicatedFromPortId !== "string",
      )
      .every((p) => remaining.has(p.portId)),
  ).toBeTrue()
  expect(
    output.regions.every((r) => r.pointIds.every((id) => remaining.has(id))),
  ).toBeTrue()
  // Movable preloads remain graph occupancy, not immutable clearance obstacles.
  const movable = constrainBoundaryPortCapacity(captured.graph, {
    ...captured.geometry,
    retainedRoutes: captured.geometry.retainedRoutes.map((r) => ({
      ...r,
      isFixed: false,
    })),
  })
  expect(
    movable.ports.find((p) => p.portId === portId)!.d!.clearanceAllowedNetIds,
  ).toContain(signalNet)
  const copper = captured.geometry.retainedRoutes.flatMap((r) =>
    r.isFixed ? [getPipeline9RouteCopperGeometry(r, captured.geometry)] : [],
  )
  for (const [name, allowed] of [
    ["before", captured.beforeAllowedNetIds],
    ["after", port.d!.clearanceAllowedNetIds as string[]],
  ] as const) {
    const permitted = allowed.includes(signalNet)
    const graphics: GraphicsObject = {
      rects: captured.geometry.obstacles
        .filter((o) => o.layers.includes("top") && o.width < 10)
        .map((o) => ({
          center: o.center,
          width: o.width,
          height: o.height,
          fill: "#cbd5e1",
          stroke: "#64748b",
        })),
      lines: copper.flatMap((g) =>
        g.wireSegments
          .filter((w) => w.z === 0)
          .map((w) => ({
            points: [w.start, w.end],
            strokeWidth: w.width,
            strokeColor: "#64748b",
          })),
      ),
      circles: copper.flatMap((g) =>
        g.viaSpans
          .filter((v) => v.minZ <= 0 && v.maxZ >= 0)
          .flatMap((v) => [
            {
              center: v.center,
              radius:
                v.diameter / 2 +
                captured.geometry.traceWidth / 2 +
                captured.geometry.clearance,
              fill: "#fed7aa",
              stroke: "#ea580c",
            },
            {
              center: v.center,
              radius: v.diameter / 2,
              fill: "#94a3b8",
              stroke: "#475569",
            },
          ]),
      ),
    }
    // This is the planner's boundary slot, not a fabricated copper route.
    graphics.lines!.push({
      points: [
        { x: 3.765, y: 6.325 },
        { x: 3.935, y: 6.325 },
      ],
      strokeColor: permitted ? "#dc2626" : "#16a34a",
      strokeWidth: 0.035,
    })
    graphics.circles!.push({
      center: { x: port.d!.x, y: port.d!.y },
      radius: 0.045,
      fill: permitted ? "#dc2626" : "#16a34a",
      stroke: "white",
    })
    if (!permitted)
      graphics.lines!.push(
        ...[
          [
            { x: 3.8, y: 6.275 },
            { x: 3.9, y: 6.375 },
          ],
          [
            { x: 3.8, y: 6.375 },
            { x: 3.9, y: 6.275 },
          ],
        ].map((points) => ({
          points,
          strokeWidth: 0.018,
          strokeColor: "#166534",
        })),
      )
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: 3.35,
        maxX: 4.5,
        minY: 5.65,
        maxY: 7.1,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
