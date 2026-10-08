import { expect, test } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { VisualizedGlobalDrcForceImproveSolver } from "high-density-repair03/fixture-support/VisualizedGlobalDrcForceImproveSolver"
import type { HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"

test("snapshots shared ground via repair beside the STM32 VCAP pad", async (): Promise<void> => {
  // C12 geometry translated to the origin from the STM32 LCD support phase.
  const via = { x: -0.775001, y: 0.166451906949 }
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 1, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    minViaEdgeToPadEdgeClearance: 0.1,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.95,
        height: 0.8,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_154", "VCAP_2"],
      },
    ],
    connections: [
      {
        name: "ground-a",
        rootConnectionName: "GND",
        pointsToConnect: [
          { x: -1.5, y: -0.7, layer: "top" },
          { x: -1.5, y: 0.7, layer: "bottom" },
        ],
      },
      {
        name: "ground-b",
        rootConnectionName: "GND",
        pointsToConnect: [
          { x: -1.7, y: 0, layer: "top" },
          { x: -1.7, y: 0.9, layer: "bottom" },
        ],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "ground-a",
      rootConnectionName: "GND",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      vias: [via],
      route: [
        { x: -1.5, y: -0.7, z: 0 },
        { ...via, z: 0 },
        { ...via, z: 1 },
        { x: -1.5, y: 0.7, z: 1 },
      ],
    },
    {
      connectionName: "ground-b",
      rootConnectionName: "GND",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      vias: [via],
      route: [
        { x: -1.7, y: 0, z: 0 },
        { ...via, z: 0 },
        { ...via, z: 1 },
        { x: -1.7, y: 0.9, z: 1 },
      ],
    },
  ]
  const solver = new VisualizedGlobalDrcForceImproveSolver({
    srj,
    hdRoutes: structuredClone(routes),
    enablePostSolveClearanceRelaxation: false,
  })
  solver.solve()
  const output = solver.getOutput()
  const copperGap =
    pointToBoxDistance(output[0]!.vias[0]!, srj.obstacles[0]!) - 0.3

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.initialDrcIssueCount).toBeGreaterThan(0)
  expect(output[0]!.vias[0]).toEqual(output[1]!.vias[0])
  for (const [index, route] of output.entries()) {
    expect(route.route[0]).toEqual(routes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(routes[index]!.route.at(-1))
  }
  const graphics = solver.visualize()
  graphics.texts = [
    {
      x: -0.6,
      y: 1.25,
      text: `Copper gap: ${copperGap.toFixed(6)} mm / 0.10 mm required`,
      fontSize: 0.1,
      anchorSide: "center",
    },
    {
      x: 0,
      y: 0.65,
      text: "C12 VCAP_2 pad",
      fontSize: 0.1,
      anchorSide: "center",
    },
    {
      x: -1,
      y: -0.95,
      text: "Shared GND via: 0.60 mm copper diameter",
      fontSize: 0.08,
      anchorSide: "center",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path)
})
