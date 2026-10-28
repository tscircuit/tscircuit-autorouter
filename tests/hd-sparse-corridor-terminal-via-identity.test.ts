import { expect, test } from "bun:test"
import { SparseVisibilityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/SparseVisibilityIntraNodeSolver"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("a via at a sparse terminal keeps its PCB ID only on the true endpoint and respects outer tagging policy", () => {
  const solver = new SparseVisibilityIntraNodeSolver({
    layerCount: 2, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1,
    nodeWithPortPoints: {
      capacityMeshNodeId: "terminal-via", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
      portPoints: [
        { x: -2, y: 0, z: 0, connectionName: "a", pcb_port_id: "a-start" },
        { x: 2, y: 0, z: 1, connectionName: "a", pcb_port_id: "a-end" },
        { x: -2, y: 2, z: 0, connectionName: "b" },
        { x: 2, y: 2, z: 0, connectionName: "b" },
      ],
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const route = solver.solvedRoutes.find((candidate) => candidate.connectionName === "a")!
  expect(route.vias.some((via) => (via.x === -2 || via.x === 2) && via.y === 0)).toBe(true)
  expect(route.route[0]).toMatchObject({ x: -2, y: 0, z: 0, pcb_port_id: "a-start" })
  expect(route.route.at(-1)).toMatchObject({ x: 2, y: 0, z: 1, pcb_port_id: "a-end" })
  expect(route.route.filter((point) => point.pcb_port_id !== undefined)).toHaveLength(2)
  expect(route.route.slice(1, -1).every((point) => Object.keys(point).sort().join(",") === "x,y,z")).toBe(true)
  expect(route.startPcbPortId).toBeUndefined()
  expect(route.endPcbPortId).toBeUndefined()
  const stitcher = new SingleHighDensityRouteStitchSolver3({
    connectionName: "a", hdRoutes: [route], start: route.route[0]!, end: route.route.at(-1)!,
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })
  stitcher.solve()
  expect(stitcher.solved).toBe(true)
  expect(stitcher.mergedHdRoute.startPcbPortId).toBe("a-start")
  expect(stitcher.mergedHdRoute.endPcbPortId).toBe("a-end")
})
