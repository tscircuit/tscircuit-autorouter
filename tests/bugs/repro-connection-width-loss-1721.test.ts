import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver, convertSrjToGraphicsObject } from "lib"
import type { SimpleRouteJson } from "lib/types"

/**
 * Repro for #1721: per-connection nominalTraceWidth is lost when connections
 * sharing a point are merged.
 *
 * Two connections share the pad at (4, 0), so mergeConnections combines them
 * into one group. The merged group keeps the FIRST nominalTraceWidth it
 * encounters (mergeConnections.ts, "Take the nominalTraceWidth from the first
 * connection"), so the 0.25mm sense-branch width wins and the 0.8mm power
 * connection is routed at 0.25mm.
 *
 * The assertions below pin the CURRENT (buggy) behavior so the width loss is
 * observable; the snapshot shows the power trace rendered at branch width.
 */
const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  bounds: { minX: -6, maxX: 6, minY: -5, maxY: 5 },
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: -4, y: 0 },
      width: 1.2,
      height: 1.2,
      connectedTo: ["power_thick"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 4, y: 0 },
      width: 1.2,
      height: 1.2,
      connectedTo: ["power_thick", "branch_to_sense"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 4, y: 3 },
      width: 0.25,
      height: 0.25,
      connectedTo: ["branch_to_sense"],
    },
  ],
  connections: [
    // Listed first → its 0.25mm width is applied to the whole merged group
    {
      name: "branch_to_sense",
      nominalTraceWidth: 0.25,
      pointsToConnect: [
        { x: 4, y: 0, layer: "top" },
        { x: 4, y: 3, layer: "top" },
      ],
    },
    {
      name: "power_thick",
      nominalTraceWidth: 0.8,
      pointsToConnect: [
        { x: -4, y: 0, layer: "top" },
        { x: 4, y: 0, layer: "top" },
      ],
    },
  ],
}

test("repro-connection-width-loss-1721", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(solver.failed).toBe(false)

  const out = solver.getOutputSimpleRouteJson()
  const wireWidths = new Set<number>()
  for (const trace of out.traces ?? []) {
    for (const seg of trace.route) {
      if (seg.route_type === "wire") wireWidths.add(seg.width)
    }
  }
  const widths = [...wireWidths].sort((a, b) => a - b)
  console.log("requested widths: [0.25, 0.8] — output wire widths:", widths)

  // BUG(#1721): the requested 0.8mm width never appears in the routed output…
  expect(widths.some((w) => w >= 0.8)).toBe(false)
  // …every wire is emitted at the 0.25mm width of the branch connection that
  // happened to be listed first. Once the width is preserved, this test should
  // be flipped to assert the power_thick wires ARE 0.8mm.
  expect(widths).toEqual([0.25])

  expect(
    getSvgFromGraphicsObject(convertSrjToGraphicsObject(out), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
