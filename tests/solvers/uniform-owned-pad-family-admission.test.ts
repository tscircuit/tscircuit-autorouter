import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { createPortPointPositionValidator } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPortReservationNetIds"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

// Actual sample24 ce46655 family, extracted from Uniform constructor SHA256
// df1a3778f2f1bad0bc31029fa3dad04fa5179c59e1fd0c5b3a3abf4c90e1a567.
const actualFamily = (): UniformPortDistributionSolverInput => {
  const owners: [string, string] = ["new-cmn_3-127__sub_0_2", "topology_merge_6998__sub_0_0"]
  const ports: PortPoint[] = [
    { portPointId: "ce46655_pp0_z7::7", x: 123.22975199999999, y: 144.73876829,
      z: 7, connectionName: "source_net_altium_pcb_408_mst89", rootConnectionName: "source_net_altium_pcb_408" },
    { portPointId: "ce46655_pp0_z7::7::dup2", x: 123.22975199999999, y: 144.77210162333333,
      z: 7, connectionName: "source_net_altium_pcb_45_mst0", rootConnectionName: "source_net_altium_pcb_45" },
  ]
  const nodes: NodeWithPortPoints[] = [
    { capacityMeshNodeId: owners[0], center: { x: 122.22356849999998, y: 144.73876829 },
      width: 2.0123670000000025, height: 0.42473858000005293, availableZ: [7],
      portPoints: ports.map((p) => ({ ...p })) },
    { capacityMeshNodeId: owners[1], center: { x: 123.686976265, y: 146.53533266666668 },
      width: 0.9144485300000014, height: 4.017867333333338,
      availableZ: [0, 1, 2, 3, 4, 5, 6, 7], portPoints: ports.map((p) => ({ ...p })) },
  ]
  const pad: Obstacle = {
    type: "rect", center: { x: 122.8297518, y: 145.25113698 },
    width: 0.8000009399999999, height: 0.5999987999999999, layers: ["bottom"],
    connectedTo: ["pcb_smtpad_altium_8566", "source_net_altium_pcb_89"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_altium_8566", source_component_name: "R133", source_port_name: "2" },
  }
  return {
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: nodes.map((node) => ({ ...node,
      portPoints: node.portPoints.map((p) => ({ ...p, connectionNodeIds: owners,
        distToCentermostPortOnZ: 0, cramped: false, connectsToOffBoardNode: false })),
    })),
    obstacles: [pad], layerCount: 8, useLayerAwareGeometry: true,
    preserveSolitaryPorts: false,
  }
}

const coordinates = (nodes: NodeWithPortPoints[]) =>
  nodes.map((node) => node.portPoints.map((p) => [p.portPointId, p.x, p.y, p.z]))

test("Uniform admits or declines the whole actual owner-pair layer family under physical pad rules", () => {
  const connMap = new ConnectivityMap({
    net408: ["source_net_altium_pcb_408", "source_net_altium_pcb_408_mst89"],
    net45: ["source_net_altium_pcb_45", "source_net_altium_pcb_45_mst0"],
    net89: ["source_net_altium_pcb_89", "pcb_smtpad_altium_8566"],
  })
  const input = actualFamily()
  const inputBefore = JSON.stringify(input)
  const allowed = createPortPointPositionValidator({ obstacles: input.obstacles,
    connMap, traceWidth: 0.1, traceToPadClearance: 0.1, layerCount: 8 })
  expect(input.nodeWithPortPoints[0]!.portPoints.every(allowed)).toBe(true)
  const legacy = new UniformPortDistributionSolver(input)
  legacy.solve()
  const proposals = legacy.getOutput()[0]!.portPoints
  expect(proposals[0]!.y).toBeCloseTo(144.632583645, 10)
  expect(proposals[1]!.y).toBeCloseTo(144.844952935, 10)
  expect(allowed(proposals[0]!)).toBe(true)
  expect(allowed(proposals[1]!)).toBe(false)

  const guarded = new UniformPortDistributionSolver({ ...input, isPortPointPositionAllowed: allowed })
  guarded.solve()
  expect(guarded.solved).toBe(true)
  expect(coordinates(guarded.getOutput())).toEqual(coordinates(input.nodeWithPortPoints))
  // The valid first proposal is declined too; do not mix old and new positions.
  expect(guarded.getOutput()[0]!.portPoints[0]!.y).not.toBe(proposals[0]!.y)
  expect(guarded.getOutput().every((n) => n.portPoints.every(allowed))).toBe(true)
  expect(JSON.stringify(input)).toBe(inputBefore)

  const accepted = new UniformPortDistributionSolver({ ...input,
    isPortPointPositionAllowed: createPortPointPositionValidator({ obstacles: [],
      connMap, traceWidth: 0.1, traceToPadClearance: 0.1, layerCount: 8 }),
  })
  accepted.solve()
  expect(coordinates(accepted.getOutput())).toEqual(coordinates(legacy.getOutput()))

  // Explicitly larger requested clearance makes these historical originals
  // invalid. Report that case rather than retaining invalid geometry.
  const stricter = new UniformPortDistributionSolver({ ...input,
    isPortPointPositionAllowed: createPortPointPositionValidator({ obstacles: input.obstacles,
      connMap, traceWidth: 0.1, traceToPadClearance: 0.2, layerCount: 8 }),
  })
  expect(() => stricter.solve()).toThrow()

  // Actual ce240881 is one of the nine new copper overlaps found after
  // Uniform, but its original point already violated the raw .1 edge rule.
  const historicalPoint: PortPoint = {
    portPointId: "ce240881_pp0_z7_cramped::7::dup1", x: 151.37399748,
    y: 81.34684246166667, z: 7, connectionName: "source_net_altium_pcb_293_mst1",
    rootConnectionName: "source_net_altium_pcb_293",
  }
  const historicalOwners: [string, string] = ["topology_merge_56319", "topology_merge_57187"]
  const historicalNodes: NodeWithPortPoints[] = [
    { capacityMeshNodeId: historicalOwners[0], center: { x: 150.47399674000002, y: 80.930175325 },
      width: 1.8000014800000201, height: 0.9000020099999801,
      availableZ: [0, 1, 2, 3, 4, 5, 6, 7], portPoints: [{ ...historicalPoint }] },
    { capacityMeshNodeId: historicalOwners[1], center: { x: 151.67399673999998, y: 81.330175795 },
      width: 0.5999985199999287, height: 0.10000106999999048,
      availableZ: [7], portPoints: [{ ...historicalPoint }] },
  ]
  const historicalPad: Obstacle = { type: "rect", center: { x: 151.67399688, y: 81.18017546 },
    width: 0.5999987999999999, height: 0.19999959999999997, layers: ["bottom"],
    connectedTo: ["pcb_smtpad_altium_7778", "source_net_altium_pcb_295"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_altium_7778" } }
  const historicalAllowed = createPortPointPositionValidator({ obstacles: [historicalPad],
    connMap, traceWidth: 0.1, traceToPadClearance: 0.1, layerCount: 8 })
  expect(historicalAllowed(historicalPoint)).toBe(false)
  const historical = new UniformPortDistributionSolver({ ...input,
    nodeWithPortPoints: historicalNodes,
    inputNodesWithPortPoints: historicalNodes.map((node) => ({ ...node,
      portPoints: node.portPoints.map((p) => ({ ...p, connectionNodeIds: historicalOwners,
        distToCentermostPortOnZ: 0, cramped: true, connectsToOffBoardNode: false })),
    })), obstacles: [historicalPad], isPortPointPositionAllowed: historicalAllowed,
  })
  expect(() => historical.solve()).toThrow("Original port point")
})
