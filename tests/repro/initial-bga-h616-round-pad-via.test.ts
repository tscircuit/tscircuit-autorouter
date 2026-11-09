import { expect, test } from "bun:test"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"

// Actual H616 U1 R2/R3/T2/T3 pads from the published 3124 native board.
const pads: Obstacle[] = [
  [221, "connectivity_net139", 1.3399999999999972, 16.049999999999997],
  [222, "connectivity_net133", 1.3399999999999972, 15.399999999999997],
  [234, "connectivity_net12", 0.6899999999999977, 16.049999999999997],
  [235, "connectivity_net1136", 0.6899999999999977, 15.399999999999997],
].map(([id, net, x, y]) => ({
  type: "rect", shape: "circle", componentId: "pcb_component_0", layers: ["top"],
  center: { x: Number(x), y: Number(y) }, width: 0.35, height: 0.35,
  connectedTo: [`pcb_smtpad_${id}`, String(net)],
}))

test("H616 source43 can use the physical round-pad gap as a through-via column", async (): Promise<void> => {
  const srj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.093, minViaPadDiameter: 0.35, minViaHoleDiameter: 0.15,
    minViaEdgeToPadEdgeClearance: 0.1, minBoardEdgeClearance: 0.2,
    bounds: { minX: -13.25, maxX: 13.25, minY: -36.25, maxY: 36.25 },
    obstacles: pads, connections: [],
  }
  const before = structuredClone(srj)
  const column = { x: 1.015, y: 15.725 }
  const solver = new InitialBgaTopologySolver({
    srj, componentId: "pcb_component_0", markedComponentObstacles: pads,
    unmarkedComponentObstacles: [],
    componentBounds: { minX: 0.515, maxX: 1.515, minY: 15.225, maxY: 16.225 },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(srj).toEqual(before)
  const cohorts = solver.getOutput().filter((node) =>
    !node._containsObstacle && Math.hypot(
      node.center.x - column.x, node.center.y - column.y,
    ) < 1e-9,
  )
  expect([...new Set(cohorts.flatMap((node) => node.availableZ))].sort()).toEqual(Array.from({ length: srj.layerCount }, (_, z) => z))
  const gap = Math.min(...pads.map((pad) => Math.hypot(
    column.x - pad.center.x, column.y - pad.center.y,
  ) - pad.width / 2 - srj.minViaPadDiameter! / 2))
  expect(gap).toBeGreaterThanOrEqual(srj.minViaEdgeToPadEdgeClearance!)
  const graphics: GraphicsObject = {
    rects: [
      { center: column, width: 0.3, height: 0.3, fill: "none", stroke: "#94a3b8" },
      ...cohorts.map((node) => ({
        center: { x: 2.15, y: 16.05 - 0.12 * (Math.min(...node.availableZ) + Math.max(...node.availableZ)) },
        width: 0.6, height: 0.18 + 0.24 * (Math.max(...node.availableZ) - Math.min(...node.availableZ)),
        fill: "rgba(56,189,248,0.18)", stroke: "#0284c7",
      })),
    ],
    circles: [
      ...pads.map((pad) => ({ center: pad.center, radius: pad.width / 2, fill: "#fecaca", stroke: "#dc2626" })),
      { center: column, radius: 0.275, fill: "none", stroke: "#93c5fd" },
      { center: column, radius: srj.minViaPadDiameter! / 2, fill: "#bfdbfe", stroke: "#2563eb" },
      { center: column, radius: 0.075, fill: "white", stroke: "#2563eb" },
    ],
    texts: [
      { x: 0.35, y: 16.55, text: "H616 U1 crop: source_trace_43 through-via", fontSize: 0.1, anchorSide: "center_left" },
      { x: 0.35, y: 16.39, text: "Native pads Ø0.350; pitch 0.650 mm; via Ø0.350 mm", fontSize: 0.075, anchorSide: "center_left" },
      { x: 0.35, y: 14.99, text: `Via edge gap ${gap.toFixed(4)} mm ≥ declared 0.100 mm`, fontSize: 0.08, anchorSide: "center_left" },
      { x: 0.35, y: 14.84, text: "Probe at board XY (1.015, 15.725) mm; 0.300 mm cell outlined", fontSize: 0.065, anchorSide: "center_left" },
      { x: 1.83, y: 16.25, text: "Topology layer groups (schematic)", fontSize: 0.075, anchorSide: "center_left" },
      ...Array.from({ length: srj.layerCount }, (_, z) => ({
        x: 2.55, y: 16.05 - z * 0.24, text: `z${z}`, fontSize: 0.09,
      })),
      { x: 1.83, y: 15.07, text: `${cohorts.length} region(s) at via`, fontSize: 0.08, anchorSide: "center_left" },
    ],
  }
  await expect(getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }))
    .toMatchSvgSnapshot(import.meta.path)
})
