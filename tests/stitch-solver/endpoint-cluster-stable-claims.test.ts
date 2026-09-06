import { expect, test } from "bun:test"
import { getRouteStitchEndpoint } from "lib/solvers/RouteStitchingSolver/getRouteStitchEndpoint"
import type { StitchTerminal } from "lib/solvers/RouteStitchingSolver/getStitchTerminal"
import { EndpointClusterIndex } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("endpoint claims preserve established cluster geometry and reject conflicting route metadata", (): void => {
  const connectionName = "stable-claim-net"
  const anonymousA: StitchTerminal = { x: 0, y: 0, z: 0 }
  const anonymousB: StitchTerminal = { x: -0.09, y: 0, z: 0 }
  const claimedC: StitchTerminal = {
    x: 0.09,
    y: 0,
    z: 0,
    pcb_port_id: "port-c",
  }
  const claimedD: StitchTerminal = {
    x: 0,
    y: 0,
    z: 0,
    pcb_port_id: "port-d",
  }
  const index = new EndpointClusterIndex()
  const originalKey = index.getEndpointKey(connectionName, anonymousA)
  expect(index.getEndpointKey(connectionName, anonymousB)).toBe(originalKey)
  expect(index.getEndpointKey(connectionName, claimedC)).toBe(originalKey)
  expect(index.getClusters(connectionName)).toEqual([
    {
      key: originalKey,
      point: { x: 0, y: 0, z: 0, pcb_port_id: "port-c" },
    },
  ])
  expect(index.getEndpointKey(connectionName, anonymousA)).toBe(originalKey)
  expect(index.getEndpointKey(connectionName, anonymousB)).toBe(originalKey)

  const distinctKey = index.getEndpointKey(connectionName, claimedD)
  expect(distinctKey).not.toBe(originalKey)
  expect(index.getEndpointKey(connectionName, claimedD)).toBe(distinctKey)
  expect(index.getEndpointKey(connectionName, claimedC)).toBe(originalKey)
  expect(index.getEndpointKey(connectionName, anonymousA)).toBe(originalKey)
  expect(index.getEndpointKey(connectionName, anonymousB)).toBe(originalKey)

  // A new claimed cluster can be geometrically closer to a previously seen
  // anonymous boundary. Existing graph keys must not change on a later lookup.
  const closerClaim: StitchTerminal = {
    ...anonymousB,
    pcb_port_id: "port-e",
  }
  const closerKey = index.getEndpointKey(connectionName, closerClaim)
  expect(closerKey).not.toBe(originalKey)
  expect(closerKey).not.toBe(distinctKey)
  expect(index.getEndpointKey(connectionName, { ...anonymousA })).toBe(
    originalKey,
  )
  expect(index.getEndpointKey(connectionName, { ...anonymousB })).toBe(
    originalKey,
  )
  expect(index.getClusters(connectionName)[0]!.point).toEqual({
    x: 0,
    y: 0,
    z: 0,
    pcb_port_id: "port-c",
  })

  const route: HighDensityIntraNodeRoute = {
    connectionName,
    startPcbPortId: "port-c",
    endPcbPortId: "port-d",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [{ ...claimedC }, { ...claimedD }],
    vias: [],
  }
  const conflictingRoute: HighDensityIntraNodeRoute = {
    ...route,
    startPcbPortId: "conflicting-port",
  }
  const inputSnapshot = structuredClone({ route, conflictingRoute })
  expect(getRouteStitchEndpoint(route, "first")).toEqual(claimedC)
  expect(getRouteStitchEndpoint(route, "last")).toEqual(claimedD)
  expect((): StitchTerminal =>
    getRouteStitchEndpoint(conflictingRoute, "first"),
  ).toThrow("conflicting PCB terminal identities")
  expect({ route, conflictingRoute }).toEqual(inputSnapshot)
  expect(anonymousA).toEqual({ x: 0, y: 0, z: 0 })
  expect(anonymousB).toEqual({ x: -0.09, y: 0, z: 0 })
  expect(claimedC).toEqual({ x: 0.09, y: 0, z: 0, pcb_port_id: "port-c" })
  expect(claimedD).toEqual({ x: 0, y: 0, z: 0, pcb_port_id: "port-d" })
})
