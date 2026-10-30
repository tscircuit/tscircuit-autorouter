import { expect, test } from "bun:test"
import { selectIslandEndpoints, snapIslandEndpointToNearestTerminal } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

test("gated terminal identity preserves Z while default endpoint tie rules remain legacy", () => {
  const top = { x: 0, y: 0, z: 0, pcb_port_id: "top" }
  const bottom = { x: 0, y: 0, z: 3, pcb_port_id: "bottom" }
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: bottom, terminals: [top, bottom] })).toBe(top)
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: bottom, terminals: [top, bottom], requireSameLayerTerminalIdentity: true })).toBe(bottom)
  expect(snapIslandEndpointToNearestTerminal({ islandEndpoint: bottom, terminals: [top], requireSameLayerTerminalIdentity: true })).toBe(bottom)
  const legacy = selectIslandEndpoints({ possibleEndpoints: [top, bottom], globalStart: bottom, globalEnd: top })
  const actual = selectIslandEndpoints({ possibleEndpoints: [top, bottom], globalStart: bottom, globalEnd: top, preferSameLayerTerminalIdentity: true })
  expect(legacy.start).toBe(top)
  expect(actual.start).toBe(bottom)
  expect(actual.end).toBe(top)
})
