import { expect, test } from "bun:test"
import { OwnershipGraphIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/OwnershipGraphIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("the exact bugreport107 interface overhang is ineligible before ownership graph construction", () => {
  const pairs: [PortPoint, PortPoint][] = [
    [
      { portPointId: "ce12406_pp2_z3::3", x: 4.75, y: 2.75, z: 3, connectionName: "source_trace_1__source_net_1_mst64", rootConnectionName: "connectivity_net189", nextPortPointId: "ce12509_pp0_z3::3" },
      { portPointId: "ce12509_pp0_z3::3", x: 5.95, y: 2.3, z: 3, connectionName: "source_trace_1__source_net_1_mst64", rootConnectionName: "connectivity_net189", prevPortPointId: "ce12406_pp2_z3::3" },
    ],
    [
      { portPointId: "ce12504_pp0_z2::2", x: 5.125, y: 2.3, z: 2, connectionName: "source_trace_74__source_net_74_mst0", rootConnectionName: "connectivity_net116", nextPortPointId: "ce12406_pp1_z2::2" },
      { portPointId: "ce12406_pp1_z2::2", x: 4.75, y: 2.525, z: 2, connectionName: "source_trace_74__source_net_74_mst0", rootConnectionName: "connectivity_net116", prevPortPointId: "ce12504_pp0_z2::2" },
    ],
    [
      { portPointId: "ce12406_pp2_z2::2", x: 4.75, y: 2.975, z: 2, connectionName: "source_trace_74__source_net_74_mst0", rootConnectionName: "connectivity_net116", nextPortPointId: "ce12506_pp0_z3::3" },
      { portPointId: "ce12506_pp0_z3::3", x: 5.05, y: 3.2, z: 3, connectionName: "source_trace_74__source_net_74_mst0", rootConnectionName: "connectivity_net116", prevPortPointId: "ce12406_pp2_z2::2" },
    ],
    [
      { portPointId: "ce12504_pp4_z2::2", x: 5.875, y: 2.3, z: 2, connectionName: "source_trace_72__source_net_72_mst0", rootConnectionName: "connectivity_net118", nextPortPointId: "ce12500_pp4_z2::2" },
      { portPointId: "ce12500_pp4_z2::2", x: 6.06625, y: 3.20005, z: 2, connectionName: "source_trace_72__source_net_72_mst0", rootConnectionName: "connectivity_net118", prevPortPointId: "ce12504_pp4_z2::2" },
    ],
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_927", center: { x: 5.5, y: 2.75 }, width: 1.5, height: 0.8999999999999999,
    portPoints: pairs.flat(), portPointsInPairs: pairs, availableZ: [0, 1, 2, 3],
  }
  const before = structuredClone(node)
  const params = { nodeWithPortPoints: node, traceWidth: 0.095, viaDiameter: 0.3, obstacleMargin: 0.15, layerCount: 4 }
  const candidate = new OwnershipGraphIntraNodeSolver(params)
  expect(candidate.failed).toBe(true)
  expect(candidate.error).toContain("ineligible")
  expect(candidate.engine).toBeNull()
  candidate.step()
  expect(candidate.engine).toBeNull()
  expect(candidate.stats.ownershipGraphOutOfDomainNodeCount).toBe(1)
  expect(candidate.stats.ownershipGraphUnsupportedPortCount).toBe(1)
  expect(candidate.stats.ownershipGraphCandidateCount).toBeUndefined()
  const portfolio = new PortfolioSingleIntraNodeSolver({ ...params, enableOwnershipGraphSearch: true })
  portfolio.initializeSolvers()
  const graphCandidate = portfolio.supervisedSolvers!.find(({ solver }) => solver instanceof OwnershipGraphIntraNodeSolver)!.solver as OwnershipGraphIntraNodeSolver
  expect(graphCandidate.failed).toBe(true)
  expect(graphCandidate.engine).toBeNull()
  expect(portfolio.supervisedSolvers!.some(({ solver }) => !(solver instanceof OwnershipGraphIntraNodeSolver) && !solver.failed)).toBe(true)
  expect(node).toEqual(before)
  expect(() => new OwnershipGraphIntraNodeSolver({ ...params, nodeWithPortPoints: { ...node, center: { x: NaN, y: 2.75 } } })).toThrow("finite node geometry")
})
