import { expect, test } from "bun:test"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import bugReport61 from "../fixtures/bug-reports/bugreport61-2936e1/bugreport61-2936e1.json" with {
  type: "json",
}
import bugReport62 from "../fixtures/bug-reports/bugreport62-0f6ca4/bugreport62-0f6ca4.json" with {
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

  const output = solver.getOutput()
  expect(output.components.map((component) => component.componentId)).toEqual([
    "U_BGA",
  ])
  expect(
    output.global.obstacles.some((obstacle) => obstacle.obstacleId === "R1.1"),
  ).toBe(true)
  expect(
    output.global.obstacles.some(
      (obstacle) => obstacle.obstacleId === "component-region:R1",
    ),
  ).toBe(false)
  expect(
    output.global.obstacles.some(
      (obstacle) => obstacle.obstacleId === "component-region:U_BGA",
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

  expect(
    solver.getOutput().components.map((component) => component.componentId),
  ).toEqual(["U_2X4", "U_2X5", "U_4X2"])
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

  const output = solver.getOutput()
  expect(
    output.components.map((component) => [
      component.componentId,
      component.componentKind,
    ]),
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

  expect(
    solver.getOutput().components.map((component) => component.componentId),
  ).toEqual(["U_BGA"])
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

  expect(
    solver.getOutput().components.map((component) => component.componentId),
  ).toEqual(["U_SPARSE_2X4"])
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

test("bugreport61 SOIC8 footprints use BGA topology planning", () => {
  const inputSrj = bugReport61.simple_route_json as SimpleRouteJson
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  const detectedComponentIds = componentDetectionSolver
    .getOutput()
    .components.map((component) => component.componentId)
  expect(detectedComponentIds).toEqual(["pcb_component_0", "pcb_component_1"])

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
})

test("bugreport62 QFP footprints are clearly detected", () => {
  const inputSrj = bugReport62.simple_route_json as SimpleRouteJson
  const componentDetectionSolver = new ComponentDetectionSolver({ inputSrj })
  componentDetectionSolver.solve()

  expect(
    componentDetectionSolver.getOutput().components.map((component) => [
      component.componentId,
      component.componentKind,
      component.memberObstacles.length,
    ]),
  ).toEqual([
    ["pcb_component_0", "qfp", 12],
    ["pcb_component_1", "qfp", 32],
  ])
})
