import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createSimplificationConnectivityMap } from "lib/solvers/TraceSimplificationSolver/createSimplificationConnectivityMap"

test("simplification metadata preserves merged nets and rejects contradictory memberships", (): void => {
  const connMap: ConnectivityMap = new ConnectivityMap({
    net_a: ["route_a", "pad_a"],
    old_net_a: ["old_route_a"],
    net_b: ["route_b", "pad_b"],
  })
  connMap.addConnections([["route_a", "old_route_a"]])
  const inputSnapshot: Record<string, string[]> = structuredClone(
    connMap.netMap,
  )
  const projected: ConnectivityMap = createSimplificationConnectivityMap(
    connMap,
    new Map([
      ["synthetic_a", "old_net_a"],
      ["synthetic_b", "net_b"],
      ["external_a", "external_net"],
      ["external_b", "external_net"],
    ]),
  )

  expect(projected.areIdsConnected("synthetic_a", "pad_a")).toBeTrue()
  expect(projected.areIdsConnected("synthetic_a", "old_route_a")).toBeTrue()
  expect(projected.areIdsConnected("synthetic_a", "pad_b")).toBeFalse()
  expect(projected.areIdsConnected("synthetic_b", "pad_b")).toBeTrue()
  expect(projected.areIdsConnected("external_a", "external_b")).toBeTrue()
  expect(projected.getNetConnectedToId("old_net_a")).toBeUndefined()
  expect(projected.getNetConnectedToId("external_net")).toBeUndefined()
  expect(connMap.netMap).toEqual(inputSnapshot)
  expect(connMap.getNetConnectedToId("synthetic_a")).toBeUndefined()
  expect(() =>
    createSimplificationConnectivityMap(
      connMap,
      new Map([["route_a", "net_b"]]),
    ),
  ).toThrow('route "route_a" belongs to "net_a", not declared net "net_b"')
})
