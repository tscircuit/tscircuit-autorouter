import { expect, test } from "bun:test"
import { HighDensitySolverA13EventTiles } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13EventTiles"

test("event routes retain fixed-copper ownership validation and physical board-outline rejection", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "event-physical-guard",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0],
      portPoints: [
        { connectionName: "signal", x: -2, y: 0, z: 0 },
        { connectionName: "signal", x: 2, y: 0, z: 0 },
      ],
    },
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
    layerCount: 2,
    obstacles: [{
      type: "rect" as const,
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["foreign-pad"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad", pcb_port_id: "foreign-pad" },
    }],
  }
  const foreign = new HighDensitySolverA13EventTiles(params)
  foreign.solve()
  expect(foreign.stats.eventSearchQueries).toBeGreaterThan(0)
  expect(foreign.failed).toBe(true)
  expect(foreign.solved).toBe(false)
  expect(foreign.error).toContain("board copper validation")
  expect(foreign.stats.boardDrcIssueCount).toBeGreaterThan(0)
  const connected = new HighDensitySolverA13EventTiles({
    ...params,
    obstacles: params.obstacles.map((obstacle) => ({ ...obstacle, connectedTo: ["signal"] })),
  })
  connected.solve()
  expect(connected.solved).toBe(true)
  expect(connected.stats.boardDrcIssueCount).toBe(0)
  const outsideBoard = new HighDensitySolverA13EventTiles({
    ...params,
    obstacles: [],
    boardGeometry: {
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      outline: [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: -1 }, { x: -1, y: 3 }, { x: -3, y: 3 }],
      minBoardEdgeClearance: 0.2,
    },
    nodeWithPortPoints: {
      ...params.nodeWithPortPoints,
      portPoints: [{ connectionName: "signal", x: -1, y: 1, z: 0 }, { connectionName: "signal", x: 1, y: 1, z: 0 }],
    },
  })
  outsideBoard.solve()
  expect(outsideBoard.stats.eventSearchQueries).toBeGreaterThan(0)
  expect(outsideBoard.failed).toBe(true)
  expect(outsideBoard.solved).toBe(false)
  expect(outsideBoard.stats.boardDrcIssueCount).toBeGreaterThan(0)
})
