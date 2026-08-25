import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 uses the standard high-density router without preloaded traces", () => {
  const start = {
    connectionName: "source_net_0_mst0",
    rootConnectionName: "connectivity_net0",
    portPointId: "start",
    pcb_port_id: "pcb_port_start",
    x: 0,
    y: 0,
    z: 0,
  }
  const end = {
    connectionName: "source_net_0_mst0",
    rootConnectionName: "connectivity_net0",
    portPointId: "end",
    pcb_port_id: "pcb_port_end",
    x: 2,
    y: 0,
    z: 0,
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "no-preloaded-traces-node",
    center: { x: 1, y: 0 },
    width: 2,
    height: 1,
    availableZ: [0, 1],
    portPoints: [start, end],
    portPointsInPairs: [[start, end]],
  }
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({
      connectivity_net0: ["source_net_0_mst0"],
    }),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    preserveTerminalPcbPortIds: true,
  })

  expect(solver.standardSolver).toBeInstanceOf(HighDensitySolver)
  expect(solver.stats.routingMode).toBe("standard")

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.routes).toHaveLength(1)
  expect([
    solver.routes[0]?.startPcbPortId,
    solver.routes[0]?.endPcbPortId,
  ].sort()).toEqual(["pcb_port_end", "pcb_port_start"])
  expect(solver.getUpdatedFixedHdRoutes()).toEqual([])
})
