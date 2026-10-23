import { expect, test } from "bun:test"
import type { SimpleRouteConnection } from "../../lib/types/srj-types"
import type { HgPortPointPathingSolverParams, RegionHg, RegionPortHg } from "../../lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createSymbolicCorridorGraph } from "../fixtures/createSymbolicCorridorGraph"
import template from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"

test("P9 symbolic compiler completes before Tiny search and preserves terminal and interface identities", () => {
  const serialized = createSymbolicCorridorGraph()
  const regions = serialized.regions.filter((r) => !r.regionId.startsWith("tiny-terminal:")).map((r) => ({ regionId: r.regionId, d: r.d, ports: [] })) as RegionHg[]
  const byId = new Map(regions.map((r) => [r.regionId, r]))
  const ports = serialized.ports.filter((p) => !p.d._tinyTerminal).map((p) => ({ portId: p.portId, region1: byId.get(p.region1Id)!, region2: byId.get(p.region2Id)!, d: { ...p.d, distToCentermostPortOnZ: Math.abs(p.d.y), regions: [byId.get(p.region1Id)!, byId.get(p.region2Id)!] } })) as RegionPortHg[]
  for (const port of ports) { port.region1.ports.push(port); port.region2.ports.push(port) }
  const params = structuredClone(template) as unknown as HgPortPointPathingSolverParams
  params.graph = { regions, ports }
  params.flags.USE_SYMBOLIC_CORRIDOR_COMPILER = true
  params.preserveTerminalPcbPortIds = true
  params.connections = serialized.connections!.map((connection) => {
    const simpleRouteConnection = structuredClone((connection as typeof connection & { simpleRouteConnection: SimpleRouteConnection }).simpleRouteConnection)
    simpleRouteConnection.pointsToConnect[0]!.pcb_port_id = `start-${connection.connectionId}`
    simpleRouteConnection.pointsToConnect[1]!.pcb_port_id = `end-${connection.connectionId}`
    return { ...connection, startRegion: byId.get(connection.startRegionId)!, endRegion: byId.get(connection.endRegionId)!, simpleRouteConnection, mutuallyConnectedNetworkId: connection.connectionId }
  })
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBe(0)
  expect(solver.stats.symbolicCorridorAcceptedProblems).toBe(1)
  expect(solver.stats.symbolicCorridorCapacityEdges).toBe(3)
  expect(solver.stats.symbolicLaneCrossingsAfter).toBe(0)
  const output = solver.getOutput()
  expect(output.nodesWithPortPoints).toHaveLength(4)
  expect(output.changedPreloadedTraceSections).toEqual([])
  expect(output.nodesWithPortPoints.flatMap((n) => n.portPoints).filter((p) => p.pcb_port_id).map((p) => p.pcb_port_id).sort()).toEqual(["end-A", "end-B", "start-A", "start-B"])
  for (const value of solver.computeNodePfMap().values()) expect(value === null || value === 0).toBe(true)
})
