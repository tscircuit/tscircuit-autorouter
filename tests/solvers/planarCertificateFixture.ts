import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

export function createPlanarCertificateFixture(
  enabled: boolean,
): SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "route", rootConnectionName: "net", regionId: "certificate-region",
    connMap: new ConnectivityMap({ net: ["route", "shared"], other: ["foreign"] }),
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    A: { x: -2.5, y: 0, z: 0 }, B: { x: 2.5, y: 0.5, z: 0 },
    availableZ: [0, 1, 2, 3], layerCount: 4,
    traceThickness: 0.1, obstacleMargin: 0.15, viaDiameter: 0.3,
    minDistBetweenEnteringPoints: 0.1, captureSearchDebug: false,
    obstacleRoutes: [
      { connectionName: "foreign", rootConnectionName: "other", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: 0, y: -1.5, z: 0 }, { x: 0, y: 0.8, z: 0 }],
        vias: [{ x: 0.7, y: 0.5 }] },
      { connectionName: "foreign", rootConnectionName: "other", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: -1, y: -1, z: 2 }, { x: 1.5, y: 1, z: 2 }], vias: [] },
      { connectionName: "shared", rootConnectionName: "net", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: -1, y: 0.5, z: 0 }, { x: 2, y: 0.5, z: 0 }],
        vias: [{ x: 1.4, y: -0.5 }] },
    ],
    futureConnections: [
      { connectionName: "future", points: [{ x: -0.5, y: 1.4, z: 0 }, { x: 1.5, y: -1.4, z: 1 }] },
    ],
  })
  solver.planarClearanceCertificatesEnabled = enabled
  return solver
}
