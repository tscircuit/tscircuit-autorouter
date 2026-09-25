import { expect, test } from "bun:test"
import { addTerminalPcbPortIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("coincident high-density paths preserve paired endpoint identities", (): void => {
  const start: PortPoint = {
    x: 0,
    y: 0,
    z: 0,
    connectionName: "net",
    portPointId: "start",
    pcb_port_id: "pcb_start",
  }
  const end: PortPoint = {
    ...start,
    portPointId: "end",
    pcb_port_id: "pcb_end",
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [start, end],
    portPointsInPairs: [[{ ...start }, { ...end }]],
  }
  const solver = new IntraNodeRouteSolver({ nodeWithPortPoints: node })
  solver.solve()
  expect(solver.solvedRoutes).toHaveLength(1)
  expect(solver.solvedRoutes[0]!.route).toHaveLength(2)
  const genericSolver = new HighDensitySolver({
    nodePortPoints: [node],
    preserveTerminalPcbPortIds: true,
  })
  genericSolver.solve()
  expect(genericSolver.routes).toHaveLength(1)
  expect(genericSolver.routes[0]!.startPcbPortId).toBe("pcb_start")
  expect(genericSolver.routes[0]!.endPcbPortId).toBe("pcb_end")
  const [tagged] = addTerminalPcbPortIds(solver.solvedRoutes, node)
  expect(tagged!.startPcbPortId).toBe("pcb_start")
  expect(tagged!.endPcbPortId).toBe("pcb_end")
  const [reversed] = addTerminalPcbPortIds(
    [{ ...tagged!, startPcbPortId: "pcb_end", endPcbPortId: "pcb_start" }],
    node,
  )
  expect(reversed!.startPcbPortId).toBe("pcb_end")
  expect(reversed!.endPcbPortId).toBe("pcb_start")
  expect(() =>
    addTerminalPcbPortIds(solver.solvedRoutes, {
      ...node,
      portPointsInPairs: undefined,
    }),
  ).toThrow("cannot identify distinct PCB terminals")
  expect(() =>
    addTerminalPcbPortIds(
      [{ ...tagged!, startPcbPortId: "unknown" }],
      node,
    ),
  ).toThrow('unknown PCB terminal "unknown"')

  const logicalPorts = node.portPoints.map(({ pcb_port_id, ...point }) => point)
  const logicalSolver = new IntraNodeRouteSolver({
    nodeWithPortPoints: {
      ...node,
      portPoints: logicalPorts,
      portPointsInPairs: [[logicalPorts[0]!, logicalPorts[1]!]],
    },
  })
  logicalSolver.solve()
  expect(logicalSolver.solvedRoutes).toHaveLength(1)
  expect(logicalSolver.solvedRoutes[0]!.route).toHaveLength(2)

  const repeatedPortSolver = new IntraNodeRouteSolver({
    nodeWithPortPoints: {
      ...node,
      portPoints: [start, { ...start }],
      portPointsInPairs: [[start, { ...start }]],
    },
  })
  repeatedPortSolver.solve()
  expect(repeatedPortSolver.solvedRoutes).toHaveLength(0)
})
