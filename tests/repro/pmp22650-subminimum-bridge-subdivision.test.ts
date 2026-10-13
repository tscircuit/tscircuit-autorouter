import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode } from "lib/types"

const minimumNodeArea = 0.1 ** 2

const pmp22650Bridge: CapacityMeshNode = {
  capacityMeshNodeId: "new-cmn_225-3208",
  center: { x: 20.106765499999995, y: 139.061108 },
  width: 5.0599390000000035,
  height: 0.002759999999966567,
  layer: "bottom",
  availableZ: [7],
}

const getBridgeCrossSectionGraphics = (
  outputNodes: CapacityMeshNode[],
): GraphicsObject => ({
  coordinateSystem: "cartesian",
  rects: [
    {
      center: { x: pmp22650Bridge.center.x, y: 0.6 },
      width: pmp22650Bridge.width,
      height: 0.4,
      fill: "#fed7aa",
      stroke: "#c2410c",
    },
    ...outputNodes.map((node) => ({
      center: { x: node.center.x, y: -0.6 },
      width: node.width,
      height: 0.4,
      fill: "#bae6fd",
      stroke: "#0369a1",
    })),
  ],
  points: [],
  lines: [],
  circles: [],
  texts: [
    {
      x: pmp22650Bridge.center.x,
      y: 1,
      text: "PMP22650 bridge cross-section before subdivision",
      fontSize: 0.16,
      anchorSide: "bottom_center",
    },
    {
      x: pmp22650Bridge.center.x,
      y: -0.2,
      text: `cross-section after subdivision: ${outputNodes.length} node${outputNodes.length === 1 ? "" : "s"}`,
      fontSize: 0.16,
      anchorSide: "bottom_center",
    },
  ],
})

test("reproduces PMP22650 sub-minimum bridge subdivision", () => {
  const solver = new NodeDimensionSubdivisionSolver(
    [pmp22650Bridge],
    15,
    6,
    minimumNodeArea,
  )

  solver.solve()

  expect(solver.outputNodes).toHaveLength(1)
  expect(
    solver.outputNodes.every(
      (node) => node.width * node.height >= minimumNodeArea,
    ),
  ).toBe(true)
  expect(
    getSvgFromGraphicsObject(
      getBridgeCrossSectionGraphics(solver.outputNodes),
      {
        backgroundColor: "white",
        svgWidth: 1200,
        svgHeight: 500,
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
