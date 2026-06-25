import { expect, test } from "bun:test"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import {
  filterMeshNodesInsideComponentAreas,
  filterRectDiffNodeRectsInsideComponentAreas,
  mergeMeshNodes,
} from "lib/solvers/TopologyPlanningSolver/topologyPlanningShared"

const createNode = (
  capacityMeshNodeId: string,
  center: { x: number; y: number },
  width = 1,
  height = 1,
): CapacityMeshNode => ({
  capacityMeshNodeId,
  center,
  width,
  height,
  layer: "top",
  availableZ: [0],
})

const createComponent = (
  componentId: string,
  componentKind: SerializedTopologyComponentInput["componentKind"],
  center: { x: number; y: number },
  width = 10,
  height = 10,
): SerializedTopologyComponentInput => {
  const replacementObstacle: Obstacle & { obstacleId: string } = {
    obstacleId: `${componentId}_replacement`,
    type: "rect",
    layers: ["top"],
    center,
    width,
    height,
  }

  return {
    componentId,
    componentKind,
    memberObstacleIds: [],
    memberObstacles: [],
    replacementObstacle,
  }
}

test("topology component filtering uses spatial candidates without changing containment", () => {
  const components = [
    createComponent("far", "bga", { x: 1_000, y: 1_000 }),
    createComponent("near", "qfp", { x: 0, y: 0 }),
  ]
  const meshNodes = [
    createNode("inside", { x: 0, y: 0 }, 2, 2),
    createNode("overlap-but-not-contained", { x: 5.25, y: 0 }, 2, 2),
    createNode("outside", { x: 20, y: 0 }, 2, 2),
  ]

  expect(
    filterMeshNodesInsideComponentAreas({ meshNodes, components }).map(
      (node) => node.capacityMeshNodeId,
    ),
  ).toEqual(["overlap-but-not-contained", "outside"])
})

test("mergeMeshNodes replaces only matching global component regions", () => {
  const components = [
    createComponent("bga", "bga", { x: 0, y: 0 }),
    createComponent("qfp", "qfp", { x: 50, y: 50 }),
  ]
  const componentMeshNodes = [[createNode("local-bga", { x: 0, y: 0 })]]
  const mergedNodes = mergeMeshNodes({
    globalMeshNodes: [
      createNode("exact-bga-replacement", { x: 0, y: 0 }, 10, 10),
      createNode("qfp-center-region", { x: 51, y: 51 }, 1, 1),
      createNode("ordinary-global", { x: 100, y: 100 }, 1, 1),
    ],
    components,
    componentMeshNodes,
    mergeStrategy: "concat",
  })

  expect(mergedNodes.map((node) => node.capacityMeshNodeId)).toEqual([
    "ordinary-global",
    "local-bga",
  ])
})

test("visual RectDiff node filtering keeps non-node graphics and partial overlaps", () => {
  const components = [createComponent("qfp", "qfp", { x: 0, y: 0 })]
  const rects = [
    { label: "node inside", center: { x: 0, y: 0 }, width: 2, height: 2 },
    { label: "node partial", center: { x: 5.25, y: 0 }, width: 2, height: 2 },
    { label: "component overlay", center: { x: 0, y: 0 }, width: 2, height: 2 },
  ]

  expect(
    filterRectDiffNodeRectsInsideComponentAreas({ rects, components })?.map(
      (rect) => rect.label,
    ),
  ).toEqual(["node partial", "component overlay"])
})
