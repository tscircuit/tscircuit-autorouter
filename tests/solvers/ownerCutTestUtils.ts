import type { OwnerCutHighDensitySolverProps } from "lib/solvers/HighDensitySolver/OwnerCutHighDensitySolver"

export function ownerCutParams(): OwnerCutHighDensitySolverProps {
  const paths = [
    [{ x: -0.9, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0 }],
    [{ x: 0, y: -0.9, z: 0 }, { x: 0, y: 0.9, z: 0 }],
  ]
  return { nodeWithPortPoints: {
    capacityMeshNodeId: "owner-cut-region", center: { x: 0, y: 0 },
    width: 2, height: 2, availableZ: [0, 1],
    portPoints: paths.flatMap((points, index) => points.map((point) => ({
      ...point, connectionName: `signal-${index}`, rootConnectionName: `signal-${index}`,
    }))),
  }, cellSizeMm: 0.1, viaDiameter: 0.3, viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1, layerCount: 2,
    traceThickness: 0.1, traceMargin: 0.1, obstacles: [],
    ownerCutDiagnostics: {} }
}
