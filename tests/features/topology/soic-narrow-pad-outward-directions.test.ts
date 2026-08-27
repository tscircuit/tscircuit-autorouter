import { expect, test } from "bun:test"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { SoicTopologyGeneratorSolver } from "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

function getDenseSoicPadNodes(
  orientation: "vertical" | "horizontal",
): CapacityMeshNode[] {
  const primaryValues = [-0.6, -0.2, 0.2, 0.6]
  const sideValues = [-1, 1]
  const obstacles: Obstacle[] = sideValues.flatMap((side, sideIndex) =>
    primaryValues.map((primary, primaryIndex) => ({
      type: "rect" as const,
      obstacleId: `pad_${sideIndex}_${primaryIndex}`,
      obstacleRole: "pad" as const,
      componentId: "dense_soic",
      connectedTo: [`port_${sideIndex}_${primaryIndex}`],
      layers: ["top"],
      __zLayers: [0],
      center:
        orientation === "vertical"
          ? { x: side, y: primary }
          : { x: primary, y: side },
      width: orientation === "vertical" ? 0.5 : 0.18,
      height: orientation === "vertical" ? 0.18 : 0.5,
    })),
  )
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    defaultObstacleMargin: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles,
    connections: [],
  }
  const detectedComponent: DetectedComponent = {
    componentId: "dense_soic",
    componentKind: "soic",
    bounds: {
      __type: "rect",
      minX: -1.25,
      maxX: 1.25,
      minY: -1.25,
      maxY: 1.25,
    },
  }
  const solver = new SoicTopologyGeneratorSolver({
    inputSrj,
    detectedComponent,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  return solver
    .getOutput()
    .routingRegions.filter((node) => node._soicRegionType === "pad")
}

test("dense SOIC pads prefer the outward escape for either orientation", () => {
  const verticalPads = getDenseSoicPadNodes("vertical")
  const horizontalPads = getDenseSoicPadNodes("horizontal")

  expect(verticalPads).toHaveLength(16)
  expect(
    verticalPads.every(
      (node) =>
        node._soicPadOutwardDirection ===
        (node.center.x < 0 ? "left" : "right"),
    ),
  ).toBe(true)
  expect(horizontalPads).toHaveLength(16)
  expect(
    horizontalPads.every(
      (node) =>
        node._soicPadOutwardDirection ===
        (node.center.y < 0 ? "bottom" : "top"),
    ),
  ).toBe(true)
})
