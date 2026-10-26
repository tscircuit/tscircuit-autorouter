import { expect, test } from "bun:test"
import {
  getOrderedSharedEdgeFeasibility,
  type OrderedSharedEdgeEvent,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getOrderedSharedEdgeFeasibility"

test("ordered conflicts remove one unique port event and preserve other same-owner ports", (): void => {
  const events: OrderedSharedEdgeEvent[] = [
    { portId: 0, serializedPortId: "a-left", position: 0, owner: "A", connectionName: "A", width: 0.1, allowed: [[0, 0.3]], routeIds: [], candidate: true },
    { portId: 1, serializedPortId: "b-middle", position: 1, owner: "B", connectionName: "B", width: 0.1, allowed: [[0, 0.3]], routeIds: [1, 4], candidate: false },
    { portId: 2, serializedPortId: "a-right", position: 2, owner: "A", connectionName: "A", width: 0.1, allowed: [[0, 0.3]], routeIds: [2], candidate: false },
  ]
  const input = { length: 0.3, events, minimumWidth: 0.1, traceClearance: 0.1, proofSlack: 1e-8 }
  const snapshot = structuredClone(input)
  expect(getOrderedSharedEdgeFeasibility(input)).toEqual({
    feasible: false, alternativeBlockerRouteIdSets: [[1, 4], [2]],
  })
  expect(getOrderedSharedEdgeFeasibility({ ...input, events: events.filter((event) => event.portId !== 1) }))
    .toEqual({ feasible: true })
  expect(getOrderedSharedEdgeFeasibility({ ...input, events: events.filter((event) => event.portId !== 2) }))
    .toEqual({ feasible: true })
  const allFixed = events.map((event) => ({ ...event, routeIds: [], candidate: true }))
  expect(getOrderedSharedEdgeFeasibility({ ...input, events: allFixed })).toEqual({
    feasible: false, blockerRouteIds: [],
  })
  expect(input).toEqual(snapshot)
})
