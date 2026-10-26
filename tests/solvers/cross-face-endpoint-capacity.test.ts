import { expect, test } from "bun:test"
import {
  getCrossFaceEndpointFeasibility,
  type EndpointDomainEvent,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getCrossFaceEndpointFeasibility"

test("cross-face pitch preserves complete domains and port aliases", (): void => {
  const first: EndpointDomainEvent = {
    portId: 0,
    faceKey: "bottom",
    owner: "a",
    z: 1,
    bounds: { minX: 0, maxX: 0.1814576, minY: 0, maxY: 0 },
    routeIds: [],
    candidate: true,
  }
  const second: EndpointDomainEvent = {
    portId: 1,
    faceKey: "right",
    owner: "b",
    z: 1,
    bounds: {
      minX: 0.1814576,
      maxX: 0.1814576,
      minY: 0,
      maxY: 0.0638015,
    },
    routeIds: [4, 2, 4],
    candidate: false,
  }
  const rules = { minimumSpacing: 0.195, slack: 1e-8 }
  const events = [first, second]
  const snapshot = structuredClone(events)
  expect(getCrossFaceEndpointFeasibility({ ...rules, events })).toEqual({
    feasible: false,
    blockerRouteIds: [2, 4],
  })
  for (const transform of [
    (x: number, y: number): [number, number] => [x, y],
    (x: number, y: number): [number, number] => [-x, y],
    (x: number, y: number): [number, number] => [y, x],
    (x: number, y: number): [number, number] => [-y, -x],
  ]) {
    const rotated = events.map((event) => {
      const a = transform(event.bounds.minX, event.bounds.minY)
      const b = transform(event.bounds.maxX, event.bounds.maxY)
      return {
        ...event,
        bounds: {
          minX: Math.min(a[0], b[0]) + 280,
          maxX: Math.max(a[0], b[0]) + 280,
          minY: Math.min(a[1], b[1]) + 69,
          maxY: Math.max(a[1], b[1]) + 69,
        },
      }
    })
    expect(
      getCrossFaceEndpointFeasibility({ ...rules, events: rotated }),
    ).toEqual({
      feasible: false,
      blockerRouteIds: [2, 4],
    })
  }
  for (const peer of [
    { ...second, owner: first.owner },
    { ...second, z: 2 },
    { ...second, candidate: true },
    { ...second, faceKey: first.faceKey },
    { ...second, bounds: { ...second.bounds, maxY: 0.2 } },
    { ...second, bounds: { ...second.bounds, minX: -0.2 } },
  ]) {
    expect(
      getCrossFaceEndpointFeasibility({ ...rules, events: [first, peer] }),
    ).toEqual({ feasible: true })
  }
  expect(
    getCrossFaceEndpointFeasibility({
      ...rules,
      events: [first, { ...second, routeIds: [4] }],
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [4] })
  const farSameOwnerPort = {
    ...second,
    portId: 2,
    routeIds: [8],
    bounds: { minX: 1, maxX: 1, minY: 0, maxY: 0.1 },
  }
  expect(
    getCrossFaceEndpointFeasibility({
      ...rules,
      events: [...events, farSameOwnerPort],
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [2, 4] })
  const maximum = Math.hypot(0.1814576, 0.0638015)
  for (const delta of [-1e-9, 0, 1e-9]) {
    expect(
      getCrossFaceEndpointFeasibility({
        events,
        minimumSpacing: maximum + delta,
        slack: 0,
      }).feasible,
    ).toBe(delta <= 0)
  }
  expect(() =>
    getCrossFaceEndpointFeasibility({
      ...rules,
      events: [first, { ...second, routeIds: [] }],
    }),
  ).toThrow("A removable endpoint event has no committed routes")
  expect(events).toEqual(snapshot)
})
