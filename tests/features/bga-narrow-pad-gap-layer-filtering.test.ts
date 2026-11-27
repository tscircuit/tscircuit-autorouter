import { expect, test } from "bun:test"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import pedometer from "../../fixtures/bug-reports/bugreport104-pedometer-v1.0.6.unrouted.srj.json" with {
  type: "json",
}

test("InitialBgaTopologySolver omits the pad layer on bugreport104 BGA gaps narrower than a trace channel while preserving inner and diagonal via layers", (): void => {
  const baseSrj = structuredClone(pedometer) as SimpleRouteJson
  const detector = new ComponentDetectionSolver({ inputSrj: baseSrj })
  detector.solve()
  const detectedBga = detector
    .getOutput()
    .find((component) => component.componentId === "pcb_component_7")
  expect(detectedBga).toBeDefined()

  const markedComponentObstacles = baseSrj.obstacles.filter(
    (obstacle) => obstacle.componentId === "pcb_component_7",
  )

  // Declared bugreport104 v1.0.6 rules: minTraceWidth = 0.10, minTraceToPadEdgeClearance = 0.05 (0.20 mm channel).
  // Row 1 -> Row 2 vertical gaps (including cmn_v_pcb_component_7_1_4) have clear height 0.199796 mm < 0.20 mm.
  const v106Solver = new InitialBgaTopologySolver({
    srj: baseSrj,
    componentBounds: detectedBga!.bounds,
    componentId: "pcb_component_7",
    markedComponentObstacles,
    unmarkedComponentObstacles: [],
    viaDiameter: baseSrj.minViaPadDiameter,
  })
  v106Solver.solve()
  expect(v106Solver.solved).toBe(true)

  const v106Nodes = v106Solver.getOutput()
  const narrowRow1To2Nodes = v106Nodes.filter((node) =>
    node.capacityMeshNodeId.includes("cmn_v_pcb_component_7_1_4"),
  )
  expect(narrowRow1To2Nodes).toHaveLength(3)
  expect(narrowRow1To2Nodes.flatMap((node) => node.availableZ).sort()).toEqual([
    1, 2, 3,
  ])
  expect(narrowRow1To2Nodes.some((node) => node.availableZ.includes(0))).toBe(
    false,
  )

  // Issue #4022 rules (minTraceWidth = 0.15, minTraceToPadEdgeClearance = 0.10 -> 0.35 mm channel):
  // all 31 inter-pad axis gaps (~0.20 mm) exclude z0 while keeping z1, z2, z3 and diagonal via columns.
  const stricterSrj: SimpleRouteJson = {
    ...baseSrj,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
  }
  const stricterSolver = new InitialBgaTopologySolver({
    srj: stricterSrj,
    componentBounds: detectedBga!.bounds,
    componentId: "pcb_component_7",
    markedComponentObstacles,
    unmarkedComponentObstacles: [],
    viaDiameter: stricterSrj.minViaPadDiameter,
  })
  stricterSolver.solve()
  expect(stricterSolver.solved).toBe(true)

  const stricterNodes = stricterSolver.getOutput()
  const axisGapNodes = stricterNodes.filter(
    (node) =>
      node.capacityMeshNodeId.startsWith("cmn_h_pcb_component_7_") ||
      node.capacityMeshNodeId.startsWith("cmn_v_pcb_component_7_"),
  )
  expect(axisGapNodes).toHaveLength(31 * 3)
  expect(axisGapNodes.some((node) => node.availableZ.includes(0))).toBe(false)

  const diagonalViaNodes = stricterNodes.filter((node) =>
    node.capacityMeshNodeId.startsWith("cmn_d_pcb_component_7_"),
  )
  expect(diagonalViaNodes.length).toBeGreaterThan(0)
  expect(diagonalViaNodes.every((node) => node.availableZ.includes(0))).toBe(
    true,
  )
})

test("InitialBgaTopologySolver measures orientation-specific adjacent pad clearance so 0.65 mm DDR escapes and off-size corner pads keep legal pad-layer channels", (): void => {
  // 0.65 mm pitch BGA with 0.28 mm balls (0.37 mm clear gap >= 0.30 mm required channel),
  // even though the along-channel pad dimension (0.28 mm) is < 0.30 mm and [0,0] has a 0.42 mm corner pad (0.29 mm < 0.30 mm).
  const coords = [0, 0.65, 1.3]
  const obstacles: Obstacle[] = []
  for (const [row, y] of coords.entries()) {
    for (const [col, x] of coords.entries()) {
      if (row === 2 && col === 2) continue // missing ball slot
      const isLargerCorner = row === 0 && col === 0
      const size = isLargerCorner ? 0.42 : 0.28
      obstacles.push({
        obstacleId: `pad_${row}_${col}`,
        componentId: "u_ddr",
        type: "rect",
        shape: "circle",
        layers: ["bottom"],
        center: { x, y },
        width: size,
        height: size,
        connectedTo: [`net_${row}_${col}`],
      })
    }
  }

  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    bounds: { minX: -2, maxX: 4, minY: -2, maxY: 4 },
    obstacles,
    connections: [],
  }

  const solver = new InitialBgaTopologySolver({
    srj,
    componentBounds: { minX: -0.3, maxX: 1.6, minY: -0.3, maxY: 1.6 },
    componentId: "u_ddr",
    markedComponentObstacles: obstacles,
    unmarkedComponentObstacles: [],
    viaDiameter: 0.3,
  })
  solver.solve()
  const nodes = solver.getOutput()

  // Adjacent to the 0.42 mm corner pad at (0,0) and 0.28 mm pad at (0,1):
  // clear gap is 0.65 - (0.42 + 0.28)/2 = 0.30 mm >= 0.30 mm -> bottom layer z3 stays open!
  // Now tighten clearance slightly to 0.105 (0.31 mm channel):
  const tighterSolver = new InitialBgaTopologySolver({
    ...solver.inputProblem,
    srj: { ...srj, minTraceToPadEdgeClearance: 0.105 },
  })
  tighterSolver.solve()
  const tighterNodes = tighterSolver.getOutput()

  // Corner (0,0)-(0,1) gap is 0.30 mm < 0.31 mm -> omits bottom pad layer z3, keeps z0, z1, z2.
  const cornerHorizLayers = tighterNodes
    .filter((node) => node.capacityMeshNodeId.startsWith("cmn_h_u_ddr_0_0_"))
    .flatMap((node) => node.availableZ)
    .sort()
  expect(cornerHorizLayers).toEqual([0, 1, 2])

  // Normal (1,0)-(1,1) ball gap is 0.65 - 0.28 = 0.37 mm >= 0.31 mm (despite height = 0.28 mm < 0.31 mm) -> keeps z3!
  const normalHorizLayers = tighterNodes
    .filter((node) => node.capacityMeshNodeId.startsWith("cmn_h_u_ddr_1_0_"))
    .flatMap((node) => node.availableZ)
    .sort()
  expect(normalHorizLayers).toEqual([0, 1, 2, 3])

  // Gap bordering missing slot (1,2)-(2,2) has isBetweenTwoPads = false -> keeps all layers [0, 1, 2, 3].
  const missingNeighborLayers = tighterNodes
    .filter((node) => node.capacityMeshNodeId.startsWith("cmn_v_u_ddr_1_2_"))
    .flatMap((node) => node.availableZ)
    .sort()
  expect(missingNeighborLayers).toEqual([0, 1, 2, 3])
  expect(nodes.length).toBeGreaterThan(tighterNodes.length)
})

test("InitialBgaTopologySolver preserves pad-layer channels on exact IEEE-754 clearance boundaries and rasterized strip footprints", (): void => {
  // 1) Exact boundary: 0.50 mm pitch - 0.20 mm pad = 0.30 mm clear width, while 0.1 + 2 * 0.1 === 0.30000000000000004 in IEEE-754.
  const exactBoundaryObstacles: Obstacle[] = []
  for (const [row, y] of [0, 0.5, 1.0].entries()) {
    for (const [col, x] of [0, 0.64, 1.28].entries()) {
      exactBoundaryObstacles.push({
        obstacleId: `ov_pad_${row}_${col}`,
        componentId: "u_ov9281",
        type: "rect",
        shape: "circle",
        layers: ["top"],
        center: { x, y },
        width: 0.2,
        height: 0.2,
        connectedTo: [`ov_net_${row}_${col}`],
      })
    }
  }
  const exactBoundarySolver = new InitialBgaTopologySolver({
    srj: {
      layerCount: 4,
      minTraceWidth: 0.1,
      minViaPadDiameter: 0.3,
      bounds: { minX: -1, maxX: 3, minY: -1, maxY: 3 },
      obstacles: exactBoundaryObstacles,
      connections: [],
    },
    componentBounds: { minX: -0.2, maxX: 1.5, minY: -0.2, maxY: 1.2 },
    componentId: "u_ov9281",
    markedComponentObstacles: exactBoundaryObstacles,
    unmarkedComponentObstacles: [],
    viaDiameter: 0.3,
  })
  exactBoundarySolver.solve()
  const verticalBoundaryNodes = exactBoundarySolver
    .getOutput()
    .filter((node) => node.capacityMeshNodeId.startsWith("cmn_v_u_ov9281_"))
  expect(verticalBoundaryNodes).toHaveLength(6 * 4)
  expect(
    verticalBoundaryNodes.some((node) => node.availableZ.includes(0)),
  ).toBe(true)

  // 2) Rasterized 1D strip slices (0.22 x 0.10 mm touching vertically at 0.10 mm Y-step, aspect > 1.5, zero diagonal gaps):
  // must keep all freeLayers rather than treating strip slices as 2D BGA ball gaps.
  const stripObstacles: Obstacle[] = []
  for (const [row, y] of [0, 0.1, 0.2, 0.3].entries()) {
    for (const [col, x] of [0, 0.5, 1.0].entries()) {
      stripObstacles.push({
        obstacleId: `strip_${row}_${col}`,
        componentId: "j_strips",
        type: "rect",
        layers: ["top"],
        center: { x, y },
        width: 0.22,
        height: 0.1,
        connectedTo: [`strip_net_${col}`],
      })
    }
  }
  const stripSolver = new InitialBgaTopologySolver({
    srj: {
      layerCount: 4,
      minTraceWidth: 0.15,
      minTraceToPadEdgeClearance: 0.1,
      minViaPadDiameter: 0.3,
      bounds: { minX: -1, maxX: 3, minY: -1, maxY: 3 },
      obstacles: stripObstacles,
      connections: [],
    },
    componentBounds: { minX: -0.3, maxX: 1.3, minY: -0.2, maxY: 0.5 },
    componentId: "j_strips",
    markedComponentObstacles: stripObstacles,
    unmarkedComponentObstacles: [],
    viaDiameter: 0.3,
  })
  stripSolver.solve()
  const stripHorizNodes = stripSolver
    .getOutput()
    .filter((node) => node.capacityMeshNodeId.startsWith("cmn_h_j_strips_"))
  expect(stripHorizNodes).toHaveLength(8 * 4)
  expect(stripHorizNodes.some((node) => node.availableZ.includes(0))).toBe(true)
})
