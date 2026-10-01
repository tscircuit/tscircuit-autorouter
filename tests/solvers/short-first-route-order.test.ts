import { expect, test } from "bun:test"
import {
  getShortFirstRouteOrder,
  type RouteOrderConnection,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getShortFirstRouteOrder"

test("short-first order keeps every route and contiguous nets with stable ties", () => {
  const connections: RouteOrderConnection[] = [
    { routeId: 0, netId: 1, start: { x: -4, y: 0 }, end: { x: 4, y: 0 } },
    { routeId: 1, netId: 2, start: { x: 0, y: -2 }, end: { x: 0, y: 2 } },
    { routeId: 2, netId: 3, start: { x: 8, y: 8 }, end: { x: 9, y: 8 } },
    { routeId: 3, netId: 1, start: { x: -4, y: 0 }, end: { x: -4, y: 1 } },
    { routeId: 4, netId: 4, start: { x: 0, y: 8 }, end: { x: 1, y: 8 } },
  ]
  const before = structuredClone(connections)
  const order = getShortFirstRouteOrder(connections)
  expect(order).toEqual([2, 4, 1, 3, 0])
  expect(getShortFirstRouteOrder(connections)).toEqual(order)
  expect([...order].sort()).toEqual([0, 1, 2, 3, 4])
  expect(connections).toEqual(before)
  expect(getShortFirstRouteOrder([])).toEqual([])
})
