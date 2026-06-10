import { expect, test } from "bun:test"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { createComponentObstacleSrj } from "lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import bugReport61 from "../fixtures/bug-reports/bugreport61-2936e1/bugreport61-2936e1.json" with {
  type: "json",
}
import bugReport62 from "../fixtures/bug-reports/bugreport62-0f6ca4/bugreport62-0f6ca4.json" with {
  type: "json",
}
import bugReport63 from "../fixtures/bug-reports/bugreport63-274be2/bugreport63-274be2.json" with {
  type: "json",
}

const createPad = ({
  componentId,
  obstacleId,
  x,
  y,
  width = 0.2,
  height = 0.2,
}: {
  componentId: string
  obstacleId: string
  x: number
  y: number
  width?: number
  height?: number
}): Obstacle => ({
  obstacleId,
  componentId,
  type: "rect",
  layers: ["top"],
  center: { x, y },
  width,
  height,
  connectedTo: [],
})

const createSrj = (obstacles: Obstacle[]): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles,
  connections: [],
  bounds: { minX: -2, maxX: 4, minY: -2, maxY: 4 },
})

const doNodeBoundsOverlap = (
  node: {
    center: { x: number; y: number }
    width: number
    height: number
  },
  other: {
    center: { x: number; y: number }
    width: number
    height: number
  },
) => {
  const nodeBounds = {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
  const otherBounds = {
    minX: other.center.x - other.width / 2,
    maxX: other.center.x + other.width / 2,
    minY: other.center.y - other.height / 2,
    maxY: other.center.y + other.height / 2,
  }

  const overlapWidth =
    Math.min(nodeBounds.maxX, otherBounds.maxX) -
    Math.max(nodeBounds.minX, otherBounds.minX)
  const overlapHeight =
    Math.min(nodeBounds.maxY, otherBounds.maxY) -
    Math.max(nodeBounds.minY, otherBounds.minY)

  return overlapWidth > 1e-6 && overlapHeight > 1e-6
}

const countSameLayerOverlaps = (
  nodes: Array<{
    center: { x: number; y: number }
    width: number
    height: number
    availableZ: number[]
  }>,
) => {
  let overlapCount = 0

  for (let indexA = 0; indexA < nodes.length; indexA++) {
    for (let indexB = indexA + 1; indexB < nodes.length; indexB++) {
      const nodeA = nodes[indexA]!
      const nodeB = nodes[indexB]!

      if (nodeA.availableZ.join(",") !== nodeB.availableZ.join(",")) continue
      if (!doNodeBoundsOverlap(nodeA, nodeB)) continue

      overlapCount += 1
    }
  }

  return overlapCount
}

const countComponentObstacles = (
  inputSrj: SimpleRouteJson,
  componentId: string,
) =>
  inputSrj.obstacles.filter((obstacle) => obstacle.componentId === componentId)
    .length

const createGridPads = ({
  componentId,
  rows,
  columns,
  xStep = 1,
  yStep = 1,
  includedIndexes,
}: {
  componentId: string
  rows: number
  columns: number
  xStep?: number
  yStep?: number
  includedIndexes?: number[]
}) =>
  Array.from(
    includedIndexes ??
      Array.from({ length: rows * columns }, (_, index) => index),
    (index) =>
      createPad({
        componentId,
        obstacleId: `${componentId}.${index + 1}`,
        x: (index % columns) * xStep,
        y: Math.floor(index / columns) * yStep,
      }),
  )

const createQfpPads = ({
  componentId,
  padsPerSide = 4,
}: {
  componentId: string
  padsPerSide?: number
}) => {
  const topPads = Array.from({ length: padsPerSide }, (_, index) =>
    createPad({
      componentId,
      obstacleId: `${componentId}.T${index + 1}`,
      x: index,
      y: -1,
      width: 0.2,
      height: 0.4,
    }),
  )
  const rightPads = Array.from({ length: padsPerSide }, (_, index) =>
    createPad({
      componentId,
      obstacleId: `${componentId}.R${index + 1}`,
      x: padsPerSide,
      y: index,
      width: 0.4,
      height: 0.2,
    }),
  )
  const bottomPads = Array.from({ length: padsPerSide }, (_, index) =>
    createPad({
      componentId,
      obstacleId: `${componentId}.B${index + 1}`,
      x: index,
      y: padsPerSide,
      width: 0.2,
      height: 0.4,
    }),
  )
  const leftPads = Array.from({ length: padsPerSide }, (_, index) =>
    createPad({
      componentId,
      obstacleId: `${componentId}.L${index + 1}`,
      x: -1,
      y: index,
      width: 0.4,
      height: 0.2,
    }),
  )

  return [...topPads, ...rightPads, ...bottomPads, ...leftPads]
}

const createPerfectlyBorderedQfpPads = ({
  componentId,
}: {
  componentId: string
}) => {
  const axisValues = [-0.7, 0.5, 1.7]
  const topPads = axisValues.map((x, index) =>
    createPad({
      componentId,
      obstacleId: `${componentId}.T${index + 1}`,
      x,
      y: -1,
      width: 0.2,
      height: 0.4,
    }),
  )
  const rightPads = axisValues.map((y, index) =>
    createPad({
      componentId,
      obstacleId: `${componentId}.R${index + 1}`,
      x: 2,
      y,
      width: 0.4,
      height: 0.2,
    }),
  )
  const bottomPads = axisValues.map((x, index) =>
    createPad({
      componentId,
      obstacleId: `${componentId}.B${index + 1}`,
      x,
      y: 2,
      width: 0.2,
      height: 0.4,
    }),
  )
  const leftPads = axisValues.map((y, index) =>
    createPad({
      componentId,
      obstacleId: `${componentId}.L${index + 1}`,
      x: -1,
      y,
      width: 0.4,
      height: 0.2,
    }),
  )

  return [...topPads, ...rightPads, ...bottomPads, ...leftPads]
}

test("component detection only creates regions for BGA-like components", () => {
  const passivePads = [
    createPad({ componentId: "R1", obstacleId: "R1.1", x: -1, y: 0 }),
    createPad({ componentId: "R1", obstacleId: "R1.2", x: 0, y: 0 }),
  ]
  const bgaPads = Array.from({ length: 9 }, (_, index) =>
    createPad({
      componentId: "U_BGA",
      obstacleId: `U_BGA.${index + 1}`,
      x: index % 3,
      y: Math.floor(index / 3),
    }),
  )
  const solver = new ComponentDetectionSolver({
    inputSrj: createSrj([...passivePads, ...bgaPads]),
  })

  solver.solve()

  const detectedComponents = solver.getOutput()
  const componentObstacleSrj = createComponentObstacleSrj({
    detectedComponents,
    inputSrj: createSrj([...passivePads, ...bgaPads]),
  })

  expect(detectedComponents.map((component) => component.componentId)).toEqual([
    "U_BGA",
  ])
  expect(
    componentObstacleSrj.obstacles.some(
      (obstacle) => obstacle.obstacleId === "R1.1",
    ),
  ).toBe(true)
  expect(
    componentObstacleSrj.obstacles.some(
      (obstacle) => obstacle.obstacleId === "R1.2_component_bounds",
    ),
  ).toBe(false)
  expect(
    componentObstacleSrj.obstacles.some(
      (obstacle) => obstacle.obstacleId === "U_BGA_component_bounds",
    ),
  ).toBe(true)
})

test("component detection accepts two-row and two-column BGA-like components", () => {
  const solver = new ComponentDetectionSolver({
    inputSrj: createSrj([
      ...createGridPads({ componentId: "U_2X4", rows: 2, columns: 4 }),
      ...createGridPads({ componentId: "U_4X2", rows: 4, columns: 2 }),
      ...createGridPads({ componentId: "U_2X5", rows: 2, columns: 5 }),
      ...createGridPads({ componentId: "U_2X3", rows: 2, columns: 3 }),
    ]),
  })

  solver.solve()

  expect(solver.getOutput().map((component) => component.componentId)).toEqual([
    "U_2X4",
    "U_2X5",
    "U_4X2",
  ])
})

test("component detection marks large-gap two-row and two-column grids as SOIC", () => {
  const solver = new ComponentDetectionSolver({
    inputSrj: {
      ...createSrj([
        ...createGridPads({
          componentId: "U_SOIC_ROWS",
          rows: 2,
          columns: 4,
          yStep: 2,
        }),
        ...createGridPads({
          componentId: "U_SOIC_COLUMNS",
          rows: 4,
          columns: 2,
          xStep: 2,
        }),
        ...createGridPads({ componentId: "U_TIGHT_2X4", rows: 2, columns: 4 }),
      ]),
      minViaPadDiameter: 0.3,
      defaultObstacleMargin: 0.15,
    },
  })

  solver.solve()

  expect(
    solver
      .getOutput()
      .map((component) => [component.componentId, component.componentKind]),
  ).toEqual([
    ["U_SOIC_COLUMNS", "soic"],
    ["U_SOIC_ROWS", "soic"],
    ["U_TIGHT_2X4", "bga"],
  ])
  expect(
    solver
      .visualize()
      .rects?.some((rect) => rect.label === "U_SOIC_ROWS SOIC region"),
  ).toBe(true)
})

test("component detection clearly labels QFP-like components", () => {
  const solver = new ComponentDetectionSolver({
    inputSrj: createSrj([
      ...createQfpPads({ componentId: "U_QFP" }),
      ...createQfpPads({ componentId: "U_QFP12", padsPerSide: 3 }),
      ...createGridPads({ componentId: "U_BGA", rows: 3, columns: 3 }),
    ]),
  })

  solver.solve()

  expect(
    solver
      .getOutput()
      .map((component) => [component.componentId, component.componentKind]),
  ).toEqual([
    ["U_BGA", "bga"],
    ["U_QFP", "qfp"],
    ["U_QFP12", "qfp"],
  ])
  expect(
    solver.visualize().rects?.some((rect) => rect.label === "U_QFP QFP region"),
  ).toBe(true)
})

test("component detection rejects grids with pad dimensions outside one percent", () => {
  const mismatchedPads = createGridPads({
    componentId: "U_MISMATCHED_PADS",
    rows: 3,
    columns: 3,
  })
  mismatchedPads[0] = {
    ...mismatchedPads[0]!,
    width: mismatchedPads[0]!.width * 1.011,
  }
  const solver = new ComponentDetectionSolver({
    inputSrj: createSrj([
      ...createGridPads({ componentId: "U_BGA", rows: 3, columns: 3 }),
      ...mismatchedPads,
    ]),
  })

  solver.solve()

  expect(solver.getOutput().map((component) => component.componentId)).toEqual([
    "U_BGA",
  ])
})

test("component detection does not require at least eight pads", () => {
  const solver = new ComponentDetectionSolver({
    inputSrj: createSrj([
      ...createGridPads({
        componentId: "U_SPARSE_2X4",
        rows: 2,
        columns: 4,
        includedIndexes: [0, 1, 2, 7],
      }),
    ]),
  })

  solver.solve()

  expect(solver.getOutput().map((component) => component.componentId)).toEqual([
    "U_SPARSE_2X4",
  ])
})

test("topology planning creates BGA component mesh nodes for two-row components", () => {
  const inputSrj = createSrj(
    createGridPads({ componentId: "U_2X4", rows: 2, columns: 4 }),
  )
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
  })
  topologyPlanningSolver.solve()

  const output = topologyPlanningSolver.getOutput()
  expect(output.componentMeshNodes).toHaveLength(1)
  expect(output.componentMeshNodes[0]!.length).toBeGreaterThan(0)
  expect(
    output.componentMeshNodes[0]!.every((node) =>
      node.capacityMeshNodeId.includes("U_2X4"),
    ),
  ).toBe(true)
})

test("BGA topology generator uses a fixed two-layer pattern and keeps pad obstacles on their real layer", () => {
  const inputSrj = {
    ...createSrj(createGridPads({ componentId: "U_BGA", rows: 3, columns: 3 })),
    layerCount: 4,
  }
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const solver = new BgaTopologyGeneratorSolver({
    inputSrj,
    detectedComponent: componentDetectionSolver.getOutput()[0]!,
  })
  solver.solve()

  const output = solver.getOutput()
  const obstacleNodes = output.routingRegions.filter(
    (node) => node._containsObstacle,
  )
  const freeNodes = output.routingRegions.filter(
    (node) => !node._containsObstacle,
  )

  expect(solver.stats.layerCount).toBe(2)
  expect(
    output.routingRegions.every((node) =>
      node.availableZ.every((z) => z === 0 || z === 1),
    ),
  ).toBe(true)
  expect(
    obstacleNodes.every(
      (node) => node.availableZ.length === 1 && node.availableZ[0] === 0,
    ),
  ).toBe(true)
  expect(freeNodes.some((node) => node.availableZ.length > 1)).toBe(true)
  expect(
    freeNodes.some(
      (node) => node.availableZ.length === 1 && node.availableZ[0] === 1,
    ),
  ).toBe(true)
})

test("BGA topology generator replaces ignored lower-layer mesh coverage with per-obstacle nodes", () => {
  const inputSrj = {
    ...createSrj([
      ...createGridPads({ componentId: "U_BGA", rows: 3, columns: 3 }),
      {
        obstacleId: "B1",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 0.95, y: 1 },
        width: 0.5,
        height: 0.5,
        connectedTo: [],
      },
      {
        obstacleId: "B2",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 1.55, y: 1 },
        width: 0.3,
        height: 0.4,
        connectedTo: [],
      },
    ]),
    layerCount: 4,
  }
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const solver = new BgaTopologyGeneratorSolver({
    inputSrj,
    detectedComponent: componentDetectionSolver.getOutput()[0]!,
  })
  solver.solve()

  const output = solver.getOutput()
  const replacementObstacleNodes = output.routingRegions.filter((node) =>
    node.capacityMeshNodeId.includes("replacement-obstacle") &&
    !node.capacityMeshNodeId.includes(":expansion:"),
  )
  const expansionNodes = output.routingRegions.filter((node) =>
    node.capacityMeshNodeId.includes(":expansion:"),
  )

  expect(solver.stats.replacementObstacleNodeCount).toBe(2)
  expect(replacementObstacleNodes).toHaveLength(2)
  expect(expansionNodes.length).toBeGreaterThan(0)
  expect(expansionNodes.every((node) => node.availableZ.length === 1)).toBe(true)
  expect(expansionNodes.every((node) => node.availableZ[0] === 1)).toBe(true)
  expect(
    replacementObstacleNodes.every((node) => node.availableZ[0] === 1),
  ).toBe(true)
  expect(replacementObstacleNodes.every((node) => node._containsObstacle)).toBe(
    true,
  )
  expect(
    output.routingRegions
      .filter(
        (node) =>
          !node._containsObstacle &&
          !node.capacityMeshNodeId.includes(":expansion:"),
      )
      .every(
        (node) =>
          !node.availableZ.includes(1) ||
          replacementObstacleNodes.every(
            (obstacleNode) => !doNodeBoundsOverlap(node, obstacleNode),
          ),
      ),
  ).toBe(true)
  expect(
    replacementObstacleNodes.every((replacementObstacleNode) =>
      output.routingRegions.some(
        (node) =>
          !node._containsObstacle &&
          node.availableZ.length === 1 &&
          node.availableZ[0] === 0 &&
          doNodeBoundsOverlap(node, replacementObstacleNode),
      ),
    ),
  ).toBe(true)
  expect(
    replacementObstacleNodes.some((replacementObstacleNode) =>
      expansionNodes.some((node) =>
        areNodesBordering(node as any, replacementObstacleNode as any),
      ),
    ),
  ).toBe(true)
  expect(countSameLayerOverlaps(output.routingRegions)).toBe(0)
})

test("BGA topology generator does not emit same-layer overlaps for lower-layer obstacle expansions", () => {
  const cases = [
    [
      {
        obstacleId: "B1",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 0.95, y: 1 },
        width: 0.5,
        height: 0.5,
        connectedTo: [],
      },
      {
        obstacleId: "B2",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 1.55, y: 1 },
        width: 0.3,
        height: 0.4,
        connectedTo: [],
      },
    ],
    [
      {
        obstacleId: "B1",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 1, y: 1 },
        width: 0.45,
        height: 0.45,
        connectedTo: [],
      },
      {
        obstacleId: "B2",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 2, y: 1 },
        width: 0.45,
        height: 0.45,
        connectedTo: [],
      },
    ],
    [
      {
        obstacleId: "B1",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 1, y: 0.5 },
        width: 0.45,
        height: 0.35,
        connectedTo: [],
      },
      {
        obstacleId: "B2",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 2, y: 0.5 },
        width: 0.45,
        height: 0.35,
        connectedTo: [],
      },
      {
        obstacleId: "B3",
        type: "rect" as const,
        layers: ["bottom"],
        center: { x: 3, y: 0.5 },
        width: 0.45,
        height: 0.35,
        connectedTo: [],
      },
    ],
  ]

  for (const [index, bottomObstacles] of cases.entries()) {
    const inputSrj = {
      ...createSrj([
        ...createGridPads({
          componentId: "U_BGA",
          rows: index === 2 ? 2 : 3,
          columns: index === 1 ? 4 : index === 2 ? 5 : 3,
        }),
        ...bottomObstacles,
      ]),
      layerCount: 4,
      bounds: { minX: -2, maxX: 6, minY: -2, maxY: 6 },
    }
    const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
    componentDetectionSolver.solve()

    const solver = new BgaTopologyGeneratorSolver({
      inputSrj,
      detectedComponent: componentDetectionSolver.getOutput()[0]!,
    })
    solver.solve()

    expect(countSameLayerOverlaps(solver.getOutput().routingRegions)).toBe(0)
  }
})

test("topology planning creates QFP central, gap, and corner mesh nodes", () => {
  const inputSrj = {
    ...createSrj(createQfpPads({ componentId: "U_QFP" })),
    layerCount: 4,
    minViaPadDiameter: 0.8,
    defaultObstacleMargin: 0.4,
  }
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
    viaDiameter: 0.8,
    obstacleMargin: 0.4,
  })
  topologyPlanningSolver.solve()

  const output = topologyPlanningSolver.getOutput()
  const qfpNodes = output.componentMeshNodes[0]!
  const centerNode = qfpNodes.find(
    (node) => node.capacityMeshNodeId === "qfp:U_QFP:center",
  )
  const sideGapNodes = qfpNodes.filter((node) =>
    node.capacityMeshNodeId.includes("-gap-"),
  )
  const cornerNodes = qfpNodes.filter((node) =>
    node.capacityMeshNodeId.includes(":corner-"),
  )
  const cornerRectIds = new Set(
    cornerNodes.map((node) => node.capacityMeshNodeId.replace(/:z\d+$/, "")),
  )

  expect(output.componentMeshNodes).toHaveLength(1)
  expect(centerNode?.availableZ).toEqual([0, 1, 2, 3])
  expect(sideGapNodes.length).toBeGreaterThan(0)
  expect(sideGapNodes.every((node) => node.availableZ.length === 1)).toBe(true)
  expect(cornerRectIds.size).toBe(12)
  expect(cornerNodes.every((node) => node.availableZ.length === 1)).toBe(true)
  expect(
    qfpNodes.every((node) => node.capacityMeshNodeId.includes("U_QFP")),
  ).toBe(true)
})

test("narrow QFP pad gap port points are marked cramped", () => {
  const inputSrj = {
    ...createSrj(createQfpPads({ componentId: "U_QFP" })),
    layerCount: 4,
    minViaPadDiameter: 0.8,
    defaultObstacleMargin: 0.4,
  }
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
    viaDiameter: 0.8,
    obstacleMargin: 0.4,
  })
  topologyPlanningSolver.solve()

  const qfpNodes = topologyPlanningSolver.getOutput().componentMeshNodes[0]!
  const narrowGapNodeIds = new Set(
    qfpNodes
      .filter((node) => node._qfpRegionType === "pad-gap")
      .filter((node) => node._isNarrowQfpPadGap)
      .map((node) => node.capacityMeshNodeId),
  )
  expect(narrowGapNodeIds.size).toBeGreaterThan(0)

  const edgeSolver = new CapacityMeshEdgeSolver2_NodeTreeOptimization(qfpNodes)
  edgeSolver.solve()
  const availableSegmentPointSolver = new AvailableSegmentPointSolver({
    nodes: qfpNodes,
    edges: edgeSolver.edges,
    traceWidth: inputSrj.minTraceWidth,
    obstacleMargin: inputSrj.defaultObstacleMargin,
    shouldReturnCrampedPortPoints: true,
  })
  availableSegmentPointSolver.solve()

  const narrowGapSegments = availableSegmentPointSolver
    .getOutput()
    .filter((segment) =>
      segment.nodeIds.some((nodeId) => narrowGapNodeIds.has(nodeId)),
    )
  expect(narrowGapSegments.length).toBeGreaterThan(0)
  expect(
    narrowGapSegments.every((segment) =>
      segment.portPoints.every((portPoint) => portPoint.cramped),
    ),
  ).toBe(true)

  const { graph } = buildHyperGraph({
    capacityMeshNodes: qfpNodes,
    layerCount: inputSrj.layerCount,
    segmentPortPoints: narrowGapSegments.flatMap(
      (segment) => segment.portPoints,
    ),
    simpleRouteJsonConnections: [],
  })
  expect(graph.ports.length).toBeGreaterThan(0)
  expect(graph.ports.every((port) => port.d.cramped)).toBe(true)
})

test("topology planning collapses perfectly bordered QFP corners", () => {
  const inputSrj = {
    ...createSrj(createPerfectlyBorderedQfpPads({ componentId: "U_BORDERED" })),
    bounds: { minX: -1.2, maxX: 2.2, minY: -1.2, maxY: 2.2 },
    layerCount: 4,
    minViaPadDiameter: 0.8,
    defaultObstacleMargin: 0.4,
  }
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
    viaDiameter: 0.8,
    obstacleMargin: 0.4,
  })
  topologyPlanningSolver.solve()

  const cornerNodes = topologyPlanningSolver
    .getOutput()
    .componentMeshNodes[0]!.filter((node) =>
      node.capacityMeshNodeId.includes(":corner-"),
    )
  const cornerRectIds = new Set(
    cornerNodes.map((node) => node.capacityMeshNodeId.replace(/:z\d+$/, "")),
  )

  expect(cornerRectIds.size).toBe(4)
  expect([...cornerRectIds].sort()).toEqual([
    "qfp:U_BORDERED:corner-ne-outer",
    "qfp:U_BORDERED:corner-nw-outer",
    "qfp:U_BORDERED:corner-se-outer",
    "qfp:U_BORDERED:corner-sw-outer",
  ])
})

test("topology planning creates SOIC central and pad-gap mesh nodes", () => {
  const inputSrj = {
    ...createSrj(
      createGridPads({
        componentId: "U_SOIC_ROWS",
        rows: 2,
        columns: 4,
        yStep: 2,
      }),
    ),
    layerCount: 4,
    minViaPadDiameter: 0.3,
    defaultObstacleMargin: 0.15,
  }
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
  })
  topologyPlanningSolver.solve()

  const soicNodes = topologyPlanningSolver.getOutput().componentMeshNodes[0]!
  const centerNode = soicNodes.find(
    (node) => node.capacityMeshNodeId === "soic:U_SOIC_ROWS:center",
  )
  const sideGapNodes = soicNodes.filter((node) =>
    node.capacityMeshNodeId.includes("-gap-"),
  )

  expect(componentDetectionSolver.getOutput()[0]?.componentKind).toBe("soic")
  expect(centerNode?.availableZ).toEqual([0, 1, 2, 3])
  expect(sideGapNodes.length).toBeGreaterThan(0)
  expect(
    soicNodes.every((node) => node.capacityMeshNodeId.includes("U_SOIC_ROWS")),
  ).toBe(true)
})

test("bugreport61 SOIC8 footprints use SOIC topology planning", () => {
  const inputSrj = bugReport61.simple_route_json as SimpleRouteJson
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  expect(
    componentDetectionSolver
      .getOutput()
      .map((component) => [component.componentId, component.componentKind]),
  ).toEqual([
    ["pcb_component_0", "soic"],
    ["pcb_component_1", "soic"],
  ])
  expect(
    componentDetectionSolver
      .visualize()
      .rects?.some((rect) => rect.label === "pcb_component_0 SOIC region"),
  ).toBe(true)

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
  })
  topologyPlanningSolver.solve()

  const output = topologyPlanningSolver.getOutput()
  expect(output.componentMeshNodes).toHaveLength(2)
  expect(output.componentMeshNodes.every((nodes) => nodes.length > 0)).toBe(
    true,
  )
  expect(
    output.componentMeshNodes.every((nodes) =>
      nodes.every((node) => node.capacityMeshNodeId.startsWith("soic:")),
    ),
  ).toBe(true)
})

test("bugreport62 QFP footprints are clearly detected", () => {
  const inputSrj = bugReport62.simple_route_json as SimpleRouteJson
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  expect(
    componentDetectionSolver
      .getOutput()
      .map((component) => [
        component.componentId,
        component.componentKind,
        countComponentObstacles(inputSrj, component.componentId),
      ]),
  ).toEqual([
    ["pcb_component_0", "qfp", 12],
    ["pcb_component_1", "qfp", 32],
  ])
})

test("bugreport63 QFP thermal-pad footprints are detected as qfp_thermalpad", () => {
  const inputSrj = bugReport63.simple_route_json as SimpleRouteJson
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  expect(
    componentDetectionSolver
      .getOutput()
      .map((component) => [
        component.componentId,
        component.componentKind,
        countComponentObstacles(inputSrj, component.componentId),
      ]),
  ).toEqual([
    ["pcb_component_0", "qfp_thermalpad", 13],
    ["pcb_component_1", "qfp_thermalpad", 33],
  ])
})

test("topology planning creates QFP thermal-pad inner and outer regions", () => {
  const inputSrj = bugReport63.simple_route_json as SimpleRouteJson
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const topologyPlanningSolver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    componentDetectionOutput: componentDetectionSolver.getOutput(),
  })
  topologyPlanningSolver.solve()

  const output = topologyPlanningSolver.getOutput()
  const firstQfpNodes = output.componentMeshNodes[0]!
  const secondQfpNodes = output.componentMeshNodes[1]!
  const allQfpNodeIds = output.componentMeshNodes.flatMap((nodes) =>
    nodes.map((node) => node.capacityMeshNodeId),
  )

  expect(output.componentMeshNodes).toHaveLength(2)
  expect(
    allQfpNodeIds.some((nodeId) =>
      nodeId.startsWith("qfp_thermalpad:pcb_component_0:thermal-pad:"),
    ),
  ).toBe(true)
  expect(
    allQfpNodeIds.some((nodeId) =>
      nodeId.startsWith("qfp_thermalpad:pcb_component_1:thermal-pad:"),
    ),
  ).toBe(true)
  expect(
    allQfpNodeIds.some((nodeId) => nodeId.includes(":inner-corner-nw")),
  ).toBe(true)
  expect(
    allQfpNodeIds.some((nodeId) => nodeId.includes(":corner-nw-outer")),
  ).toBe(true)
  expect(
    allQfpNodeIds.some((nodeId) => nodeId.includes(":inner-left-pad-")),
  ).toBe(true)
  expect(allQfpNodeIds.some((nodeId) => nodeId.endsWith(":center"))).toBe(false)
  expect(
    new Set(
      firstQfpNodes
        .filter((node) => node.capacityMeshNodeId.includes(":inner-corner-"))
        .map((node) => node.capacityMeshNodeId.replace(/:z\d+$/, "")),
    ).size,
  ).toBe(12)
  expect(
    firstQfpNodes
      .filter((node) => node.capacityMeshNodeId.includes(":inner-"))
      .every((node) => node.availableZ.length === 1),
  ).toBe(true)
  expect(
    secondQfpNodes.some(
      (node) =>
        node.capacityMeshNodeId.includes(":inner-corner-") &&
        node.availableZ.length > 1,
    ),
  ).toBe(true)
})
