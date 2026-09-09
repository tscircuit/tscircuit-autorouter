import type {
  ConnectionHgWithSimpleRouteConnection,
  HyperGraphHg,
  RawPort,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

type CapturedHyperGraphInput = {
  regions: Array<Omit<RegionHg, "ports"> & { ports: string[] }>
  ports: Array<
    Omit<RegionPortHg, "region1" | "region2" | "d"> & {
      region1: string
      region2: string
      d: Omit<RawPort, "regions"> & { regions: string[] }
    }
  >
  connections: Array<
    Omit<ConnectionHgWithSimpleRouteConnection, "startRegion" | "endRegion"> & {
      startRegion: string
      endRegion: string
    }
  >
}

/** Preserve every fixture record while expressing cyclic topology by its IDs. */
export function captureUnassignedHyperGraphInput(
  graph: HyperGraphHg,
  connections: ConnectionHgWithSimpleRouteConnection[],
): CapturedHyperGraphInput {
  const regions = graph.regions.map(
    ({ ports, ...region }): CapturedHyperGraphInput["regions"][number] => {
      if (region.assignments !== undefined) {
        throw new Error("The source graph fixture must remain unassigned")
      }
      return { ...region, ports: ports.map((port): string => port.d.portId) }
    },
  )
  const ports = graph.ports.map(
    ({
      region1,
      region2,
      d,
      ...port
    }): CapturedHyperGraphInput["ports"][number] => {
      if (region1 === undefined || region2 === undefined) {
        throw new Error("The source graph fixture requires both port regions")
      }
      return {
        ...port,
        region1: region1.regionId,
        region2: region2.regionId,
        d: {
          ...d,
          regions: d.regions.map((region): string => region.regionId),
        },
      }
    },
  )
  const capturedConnections = connections.map(
    ({
      startRegion,
      endRegion,
      ...connection
    }): CapturedHyperGraphInput["connections"][number] => ({
      ...connection,
      startRegion: startRegion.regionId,
      endRegion: endRegion.regionId,
    }),
  )
  // Data records are cloned once; comparison never walks region→port→region.
  return structuredClone({ regions, ports, connections: capturedConnections })
}
