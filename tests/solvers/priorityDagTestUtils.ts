import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

export function priorityParams(): ConstructorParameters<typeof PriorityDagIntraNodeSolver>[0] {
  const connections = [
    { name: "a", points: [{ x: -2.8, y: 0, z: 0 }, { x: 2.8, y: 0, z: 0 }] },
    { name: "b", points: [{ x: 0, y: -2.8, z: 0 }, { x: 0, y: 1.1, z: 0 }] },
    { name: "c", points: [{ x: 1.5, y: 2.2, z: 0 }, { x: 2.7, y: 2.2, z: 0 }] },
  ]
  const nodeWithPortPoints: NodeWithPortPoints = { capacityMeshNodeId: "region", center: { x: 0, y: 0 }, width: 6, height: 6,
    availableZ: [0, 1], portPoints: connections.flatMap((t) => t.points.map((p, i) => ({ ...p, connectionName: t.name,
      rootConnectionName: `root-${t.name}`, pcb_port_id: `${t.name}-${i}` }))) }
  return { nodeWithPortPoints, viaDiameter: 0.3, viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    traceWidth: 0.1, obstacleMargin: 0.1, layerCount: 2, captureSearchDebug: false, priorityFamilySize: 6 }
}

export function detailedPriority(run: () => void): void {
  const previous = PriorityDagIntraNodeSolver.detailedWorkDiagnostics
  PriorityDagIntraNodeSolver.detailedWorkDiagnostics = true
  try { run() } finally { PriorityDagIntraNodeSolver.detailedWorkDiagnostics = previous }
}
