import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { addBoundaryPortClearanceConflicts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/addBoundaryPortClearanceConflicts"
import { constrainBoundaryPortCapacity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/constrainBoundaryPortCapacity"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

test("exact RVboy graph cannot add a third signal slot in a two-trace pad opening", async (): Promise<void> => {
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-duplicate-port-capacity.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(captured)
  const before: SerializedHyperGraph = captured.graph
  const bounds = new Map<
    string,
    { minX: number; maxX: number; minY: number; maxY: number }
  >()
  const after = addBoundaryPortClearanceConflicts(
    constrainBoundaryPortCapacity(before, captured.geometry, bounds),
    bounds,
    captured.geometry.traceWidth + captured.geometry.clearance,
  )
  expect(
    after.ports.find((port) => port.portId === "ce39616_pp0_z0_cramped::0")!.d!
      .clearanceConflictPortIds,
  ).toContain("ce39613_pp0_z0_cramped::0")
  expect(JSON.stringify(captured)).toBe(original)
  const remaining = new Set(after.ports.map((port) => port.portId))
  const removed = new Set(
    before.ports.filter((p) => !remaining.has(p.portId)).map((p) => p.portId),
  )
  expect(removed.has("ce39176_pp1_z0::0::dup1")).toBeTrue()
  expect(removed.has("ce38889_pp0_z0::0::dup1")).toBeTrue()
  const regions = new Map(
    before.regions.map((region) => [region.regionId, region]),
  )
  expect(removed.has("ce39596_pp0_z0_cramped::0")).toBeTrue()
  expect(
    before.ports
      .filter(
        (port) =>
          typeof port.d?.duplicatedFromPortId !== "string" &&
          (!port.d?.cramped ||
            port.d?._preloadedTracePortAssignments?.length ||
            regions.get(port.region1Id)?.d?._containsTarget ||
            regions.get(port.region2Id)?.d?._containsTarget),
      )
      .every((port) => remaining.has(port.portId)),
  ).toBeTrue()
  expect(
    after.regions.every((region) =>
      region.pointIds.every((id) => remaining.has(id)),
    ),
  ).toBeTrue()
  const viewbox = { minX: -7.15, maxX: -6.15, minY: 14.35, maxY: 14.85 }
  for (const [name, graph] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const ports = graph.ports.filter(
      (p) =>
        p.d?.z === 0 &&
        p.region1Id !== p.region2Id &&
        [p.region1Id, p.region2Id].includes("new-cmn_68-141") &&
        [p.region1Id, p.region2Id].includes("cmn_68-outer-support-1"),
    )
    const graphics: GraphicsObject = {
      rects: captured.geometry.obstacles
        .filter(
          (o: { center: { x: number; y: number }; layers: string[] }) =>
            o.layers.includes("top") &&
            o.center.x > -8 &&
            o.center.x < -5.5 &&
            o.center.y > 13.9 &&
            o.center.y < 15,
        )
        .map(
          (o: {
            center: { x: number; y: number }
            width: number
            height: number
          }) => ({
            center: o.center,
            width: o.width,
            height: o.height,
            fill: "#cbd5e1",
            stroke: "#64748b",
          }),
        ),
      lines: [
        {
          points: [
            { x: -7.02, y: 14.595 },
            { x: -6.325, y: 14.595 },
          ],
          strokeColor: "#64748b",
          strokeWidth: 0.003,
        },
      ],
      circles: ports.map((port) => ({
        center: { x: port.d!.x, y: port.d!.y },
        radius: captured.geometry.traceWidth / 2,
        fill:
          typeof port.d?.duplicatedFromPortId === "string"
            ? "#dc2626"
            : "#2563eb",
      })),
    }
    await expect(
      renderPlanarShortcutView(graphics, viewbox),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
