import type {
  TinyStaticReachabilityCertificate,
  TinyStaticRouteCertificate,
} from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"

export type TinyStaticCertificateCapture = {
  diagnostic: string
  status: string
  nativeInstances: {
    source: string
    nativeSolverClass: string
    failed: boolean
    setupStatus: string
    initialAssignmentsStatus: string
    topology: {
      portCount: number
      regionCount: number
      incidentPortRegion: number[][]
      regionIncidentPorts: number[][]
      portX: number[]
      portY: number[]
      portZ: number[]
      regionCenterX: number[]
      regionCenterY: number[]
      regionWidth: number[]
      regionHeight: number[]
      regionAvailableZMask: number[]
      portMetadata: {
        serializedPortId: string
        data: { physicalCutId: string | null; sourcePortPointId: string }
      }[]
      regionMetadata: { serializedRegionId: string; data: { nodeId: string } }[]
    }
    problem: {
      routeCount: number
      regionNetId: number[]
      portSectionMask: number[]
      routeStartPort: number[]
      routeEndPort: number[]
      routeNet: number[]
      routeMetadata: { connectionId: string; pcbPortIds: string[] }[]
      initialAssignments: unknown[] | null
    }
    setup: {
      portEndpointReservationNetId: number[]
      portEndpointNetIds: number[][]
    }
    fixedCopperContext: { canonicalNetIdByNetId: [number, string][] }
    fixedCopperPortReservations: number[]
    routeAttemptCountByRouteId: number[]
    routeSuccessCountByRouteId: number[]
  }[]
}

type CapturedTopology =
  TinyStaticCertificateCapture["nativeInstances"][number]["topology"]
type CapturedPortMetadata = CapturedTopology["portMetadata"][number]
type CapturedRegionMetadata = CapturedTopology["regionMetadata"][number]

/** A linear directed native graph; the goal has no onward region. */
export function createTinyStaticCertificateCapture(
  regionCount: number = 3,
): TinyStaticCertificateCapture {
  const portCount = regionCount + 1
  const incidentPortRegion: number[][] = []
  const regionIncidentPorts: number[][] = []
  const reservations = Array<number>(portCount).fill(-1)
  const endpointNets = Array.from({ length: portCount }, (): number[] => [])
  for (let port = 0; port < portCount; port++) {
    const incident: number[] = []
    if (port > 0) incident.push(port - 1)
    if (port < regionCount) incident.push(port)
    incidentPortRegion.push(incident)
  }
  for (let region = 0; region < regionCount; region++) {
    regionIncidentPorts.push([region, region + 1])
  }
  reservations[0] = 0
  reservations[portCount - 1] = 0
  endpointNets[0] = [0]
  endpointNets[portCount - 1] = [0]
  return {
    diagnostic: "tiny-failure",
    status: "loaded-tiny-state",
    nativeInstances: [
      {
        source: "captured-native-child",
        nativeSolverClass:
          "SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments",
        failed: true,
        setupStatus: "already-computed-own-data",
        initialAssignmentsStatus: "captured-array",
        topology: {
          portCount,
          regionCount,
          incidentPortRegion,
          regionIncidentPorts,
          portX: Array.from({ length: portCount }, (_, index): number => index),
          portY: Array<number>(portCount).fill(0),
          portZ: Array<number>(portCount).fill(0),
          regionCenterX: Array.from(
            { length: regionCount },
            (_, index): number => index + 0.5,
          ),
          regionCenterY: Array<number>(regionCount).fill(0),
          regionWidth: Array<number>(regionCount).fill(1),
          regionHeight: Array<number>(regionCount).fill(1),
          regionAvailableZMask: Array<number>(regionCount).fill(1),
          portMetadata: Array.from(
            { length: portCount },
            (_, index): CapturedPortMetadata => ({
              serializedPortId: `port-${index}`,
              data: {
                physicalCutId: index === 1 ? "physical-cut-a" : null,
                sourcePortPointId: `source-${index}`,
              },
            }),
          ),
          regionMetadata: Array.from(
            { length: regionCount },
            (_, index): CapturedRegionMetadata => ({
              serializedRegionId: `region-${index}`,
              data: { nodeId: `node-${index}` },
            }),
          ),
        },
        problem: {
          routeCount: 1,
          regionNetId: Array<number>(regionCount).fill(-1),
          portSectionMask: Array<number>(portCount).fill(1),
          routeStartPort: [0],
          routeEndPort: [portCount - 1],
          routeNet: [0],
          routeMetadata: [{ connectionId: "route-a", pcbPortIds: ["a", "b"] }],
          initialAssignments: [],
        },
        setup: {
          portEndpointReservationNetId: reservations,
          portEndpointNetIds: endpointNets,
        },
        fixedCopperContext: {
          canonicalNetIdByNetId: [
            [0, "net-a"],
            [1, "net-b"],
          ],
        },
        fixedCopperPortReservations: [...reservations],
        routeAttemptCountByRouteId: [2],
        routeSuccessCountByRouteId: [0],
      },
    ],
  }
}

export function getOnlyTinyStaticRoute(
  certificate: TinyStaticReachabilityCertificate,
): TinyStaticRouteCertificate {
  const instance = certificate.instances[0]
  if (instance?.status !== "complete" || instance.routes.length !== 1) {
    throw new Error(
      `Expected one complete route certificate: ${JSON.stringify(certificate)}`,
    )
  }
  return instance.routes[0]!
}
