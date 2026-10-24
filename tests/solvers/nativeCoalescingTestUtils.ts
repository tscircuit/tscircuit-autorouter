import type { NativeCoalescedIntraNodeSolver } from "lib/solvers/HighDensitySolver/NativeCoalescedIntraNodeSolver"

export function nativeCoalescingParams(): ConstructorParameters<typeof NativeCoalescedIntraNodeSolver>[0] {
  const connections = [
    { name: "a", y: -1 }, { name: "b", y: 0 }, { name: "c", y: 1 },
  ]
  return { nodeWithPortPoints: { capacityMeshNodeId: "region", center: { x: 0, y: 0 }, width: 6, height: 6,
    availableZ: [0, 1], portPoints: connections.flatMap((t) => [-2.8, 2.8].map((x, i) => ({ x, y: t.y, z: 0,
      connectionName: t.name, rootConnectionName: `root-${t.name}`, pcb_port_id: `${t.name}-${i}` }))) },
    viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.1, layerCount: 2, captureSearchDebug: false,
    cacheProvider: null, nativeOrderingFamilySize: 6 }
}
