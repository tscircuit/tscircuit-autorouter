import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

type RectSpec = {
  id: string
  x: number
  y: number
  width: number
  height: number
  componentId?: string
  connectedTo?: string[]
}

type ForeignTargetSpec = {
  id: string
  x: number
  y: number
  width: number
  height: number
  outsideX: number
  outsideY: number
}

type MergedTopologySolveResult = {
  topologyPlanningSolver: MultiGraphTopologyPlannerSolver
  rawGlobalMeshNodes: CapacityMeshNode[]
}

type WalkthroughPanel = {
  title: string
  meshNodes: CapacityMeshNode[]
  overlayMeshNodes: CapacityMeshNode[]
  fill: string
  stroke: string
}

type GraphicsRect = NonNullable<GraphicsObject["rects"]>[number]
type GraphicsText = NonNullable<GraphicsObject["texts"]>[number]

const baseRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.12,
  minViaPadDiameter: 0.35,
  defaultObstacleMargin: 0.12,
  bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
}

function createObstacle({
  id,
  x,
  y,
  width,
  height,
  componentId,
  connectedTo = [],
}: RectSpec): Obstacle {
  return {
    obstacleId: id,
    componentId,
    type: "rect",
    layers: ["top"],
    zLayers: [0],
    center: { x, y },
    width,
    height,
    connectedTo,
  }
}

function createForeignTarget({ id, x, y, width, height }: ForeignTargetSpec) {
  const pointId = `${id}_port`

  return createObstacle({
    id,
    x,
    y,
    width,
    height,
    connectedTo: [pointId],
  })
}

function createForeignTargetConnections(
  targets: ForeignTargetSpec[],
): SimpleRouteJson["connections"] {
  return targets.map((target) => ({
    name: `${target.id}_net`,
    pointsToConnect: [
      {
        pointId: `${target.id}_port`,
        x: target.x,
        y: target.y,
        layer: "top",
      },
      {
        pointId: `${target.id}_outside`,
        x: target.outsideX,
        y: target.outsideY,
        layer: "top",
      },
    ],
  }))
}

function createRouteJson({
  obstacles,
  foreignTargets,
}: {
  obstacles: Obstacle[]
  foreignTargets: ForeignTargetSpec[]
}): SimpleRouteJson {
  return {
    ...baseRouteJson,
    obstacles: [
      ...obstacles,
      ...foreignTargets.map((target) => createForeignTarget(target)),
    ],
    connections: createForeignTargetConnections(foreignTargets),
  }
}

function createSoicVerticalPads(componentId: string): Obstacle[] {
  const pads: Obstacle[] = []
  const xs = [-1.8, 1.8]
  const ys = [-2.25, -0.75, 0.75, 2.25]

  for (const x of xs) {
    for (const y of ys) {
      pads.push(
        createObstacle({
          id: `${componentId}_${pads.length}`,
          componentId,
          x,
          y,
          width: 0.75,
          height: 0.55,
        }),
      )
    }
  }

  return pads
}

function createQfpPadRing(componentId: string): Obstacle[] {
  const pads: Obstacle[] = []
  const positions = [-1.2, 0, 1.2]

  for (const x of positions) {
    pads.push(
      createObstacle({
        id: `${componentId}_${pads.length}`,
        componentId,
        x,
        y: -2,
        width: 0.36,
        height: 0.9,
      }),
    )
    pads.push(
      createObstacle({
        id: `${componentId}_${pads.length}`,
        componentId,
        x,
        y: 2,
        width: 0.36,
        height: 0.9,
      }),
    )
  }

  for (const y of positions) {
    pads.push(
      createObstacle({
        id: `${componentId}_${pads.length}`,
        componentId,
        x: -2,
        y,
        width: 0.9,
        height: 0.36,
      }),
    )
    pads.push(
      createObstacle({
        id: `${componentId}_${pads.length}`,
        componentId,
        x: 2,
        y,
        width: 0.9,
        height: 0.36,
      }),
    )
  }

  return pads
}

function createBgaGrid(componentId: string): Obstacle[] {
  const pads: Obstacle[] = []
  const positions = [-1.5, -0.5, 0.5, 1.5]

  for (const x of positions) {
    for (const y of positions) {
      pads.push(
        createObstacle({
          id: `${componentId}_${pads.length}`,
          componentId,
          x,
          y,
          width: 0.25,
          height: 0.25,
        }),
      )
    }
  }

  return pads
}

export function createSoicVerticalMergedTopologySrj(): SimpleRouteJson {
  return createRouteJson({
    obstacles: createSoicVerticalPads("u_soic_vertical"),
    foreignTargets: [
      {
        id: "inner_top",
        x: 0,
        y: 0.65,
        width: 0.52,
        height: 0.42,
        outsideX: 3.2,
        outsideY: 3.1,
      },
      {
        id: "inner_bottom",
        x: 0,
        y: -0.65,
        width: 0.52,
        height: 0.42,
        outsideX: -3.2,
        outsideY: -3.1,
      },
    ],
  })
}

export function createQfpMergedTopologySrj(): SimpleRouteJson {
  return createRouteJson({
    obstacles: createQfpPadRing("u_qfp"),
    foreignTargets: [
      {
        id: "qfp_inner_a",
        x: -0.45,
        y: -0.25,
        width: 0.42,
        height: 0.42,
        outsideX: -3.2,
        outsideY: 0,
      },
      {
        id: "qfp_inner_b",
        x: 0.55,
        y: 0.55,
        width: 0.42,
        height: 0.42,
        outsideX: 3.2,
        outsideY: 0,
      },
    ],
  })
}

export function createQfpThermalPadMergedTopologySrj(): SimpleRouteJson {
  return createRouteJson({
    obstacles: [
      ...createQfpPadRing("u_qfp_thermal"),
      createObstacle({
        id: "u_qfp_thermal_thermal_pad",
        componentId: "u_qfp_thermal",
        x: 0,
        y: 0,
        width: 0.72,
        height: 0.72,
      }),
    ],
    foreignTargets: [
      {
        id: "thermal_inner_right",
        x: 1.15,
        y: 0.1,
        width: 0.36,
        height: 0.36,
        outsideX: 3.2,
        outsideY: 2.4,
      },
      {
        id: "thermal_inner_top",
        x: -0.35,
        y: -1.1,
        width: 0.36,
        height: 0.36,
        outsideX: -3.2,
        outsideY: -2.4,
      },
    ],
  })
}

export function createBgaMergedTopologySrj(): SimpleRouteJson {
  return createRouteJson({
    obstacles: createBgaGrid("u_bga"),
    foreignTargets: [
      {
        id: "bga_center_foreign",
        x: 0,
        y: 0,
        width: 0.28,
        height: 0.28,
        outsideX: 3.2,
        outsideY: 3.2,
      },
    ],
  })
}

function solveMergedTopology(
  inputSrj: SimpleRouteJson,
): MergedTopologySolveResult {
  const componentDetectionSolver = new ComponentDetectionSolver({
    inputSrj,
  })
  componentDetectionSolver.solve()

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
    viaDiameter: inputSrj.minViaPadDiameter,
    obstacleMargin: inputSrj.defaultObstacleMargin,
  })
  topologyPlanningSolver.solve()

  if (topologyPlanningSolver.failed) {
    throw new Error(
      topologyPlanningSolver.error ?? "Topology planning solver failed",
    )
  }

  const globalTopologyOutput = topologyPlanningSolver.getStageOutput<{
    meshNodes: CapacityMeshNode[]
  }>("globalTopologySolver")

  if (!globalTopologyOutput) {
    throw new Error(
      "Topology planning solver did not provide global mesh nodes",
    )
  }

  return {
    topologyPlanningSolver,
    rawGlobalMeshNodes: globalTopologyOutput.meshNodes,
  }
}

function createWalkthroughPanelRects({
  panel,
  panelIndex,
}: {
  panel: WalkthroughPanel
  panelIndex: number
}): GraphicsRect[] {
  const panelSpacing = 9
  const offsetX = panelIndex * panelSpacing
  const borderRect: GraphicsRect = {
    center: { x: offsetX, y: 0 },
    width: 8.35,
    height: 8.35,
    fill: "rgba(255,255,255,0)",
    stroke: "rgba(40,40,40,0.28)",
    layer: "walkthrough-frame",
    label: panel.title,
  }
  const baseRects = panel.meshNodes.map((node) => {
    const rect = createRectFromCapacityNode(node, { rectMargin: 0.01 })

    return {
      ...rect,
      center: { x: rect.center.x + offsetX, y: rect.center.y },
      fill: node._containsObstacle ? "rgba(235,60,45,0.18)" : panel.fill,
      stroke: node._containsObstacle ? "rgba(235,60,45,0.72)" : panel.stroke,
      label: `${panel.title}\n${node.capacityMeshNodeId}`,
    }
  })
  const overlayRects = panel.overlayMeshNodes.map((node) => {
    const rect = createRectFromCapacityNode(node, { rectMargin: 0.015 })

    return {
      ...rect,
      center: { x: rect.center.x + offsetX, y: rect.center.y },
      fill: node._containsObstacle
        ? "rgba(235,60,45,0.28)"
        : "rgba(255,165,0,0.22)",
      stroke: node._containsObstacle
        ? "rgba(235,60,45,0.86)"
        : "rgba(190,115,0,0.78)",
      label: `kept global region\n${node.capacityMeshNodeId}`,
    }
  })

  return [borderRect, ...baseRects, ...overlayRects]
}

function createWalkthroughPanelTexts(): GraphicsText[] {
  const panelSpacing = 9
  const titles = [
    "1 global topology",
    "2 component topology",
    "3 kept global regions",
    "4 merged topology",
  ]

  return titles.map((title, panelIndex) => ({
    x: panelIndex * panelSpacing - 3.85,
    y: 4.45,
    text: title,
    anchorSide: "top_left",
    fontSize: 0.34,
    color: "black",
  }))
}

export function getMergedTopologySvg(inputSrj: SimpleRouteJson): string {
  const { topologyPlanningSolver } = solveMergedTopology(inputSrj)
  const graphics = topologyPlanningSolver.finalVisualize()
  if (!graphics) {
    throw new Error("Topology planning solver did not provide visualization")
  }

  return getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
}

export function getMergedTopologyWalkthroughSvg(
  inputSrj: SimpleRouteJson,
): string {
  const { topologyPlanningSolver, rawGlobalMeshNodes } =
    solveMergedTopology(inputSrj)
  const output = topologyPlanningSolver.getOutput()
  const componentMeshNodes = output.componentMeshNodes.flat()
  const panels: WalkthroughPanel[] = [
    {
      title: "global topology",
      meshNodes: rawGlobalMeshNodes,
      overlayMeshNodes: [],
      fill: "rgba(70,80,95,0.12)",
      stroke: "rgba(70,80,95,0.42)",
    },
    {
      title: "component topology",
      meshNodes: componentMeshNodes,
      overlayMeshNodes: [],
      fill: "rgba(0,120,255,0.13)",
      stroke: "rgba(0,120,255,0.58)",
    },
    {
      title: "component plus kept global",
      meshNodes: componentMeshNodes,
      overlayMeshNodes: output.globalMeshNodes,
      fill: "rgba(0,120,255,0.09)",
      stroke: "rgba(0,120,255,0.36)",
    },
    {
      title: "merged topology",
      meshNodes: output.mergedMeshNodes,
      overlayMeshNodes: [],
      fill: "rgba(0,120,255,0.13)",
      stroke: "rgba(0,120,255,0.58)",
    },
  ]
  const rects = panels.flatMap((panel, panelIndex) =>
    createWalkthroughPanelRects({ panel, panelIndex }),
  )
  const graphics: GraphicsObject = {
    title: "Merged topology walkthrough",
    rects,
    lines: [],
    points: [],
    circles: [],
    texts: createWalkthroughPanelTexts(),
  }

  return getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
}
