import { expect, test } from "bun:test"
import type { Point3 } from "@tscircuit/math-utils"
import { snapIslandEndpointToNearestTerminal } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"

// snapIslandEndpointToNearestTerminal used to initialize closestTerminal from
// a sorted copy of the terminals while iterating the unsorted original's
// slice(1), so whenever terminals[0] was not the comparePoints-first element
// it was never examined and the endpoint could snap to a farther terminal.
test("snapIslandEndpointToNearestTerminal picks the nearest terminal regardless of terminal order", () => {
  // terminals[0] sorts after terminals[1] (comparePoints orders by z, x, y)
  const terminals: Point3[] = [
    { x: 26, y: -1, z: 0 },
    { x: 25, y: -1, z: 0 },
  ]
  // 0.1mm from (26,-1), 0.9mm from (25,-1) — both within the stitch gap
  const islandEndpoint: Point3 = { x: 25.9, y: -1, z: 0 }

  const snapped = snapIslandEndpointToNearestTerminal({
    islandEndpoint,
    terminals,
  })

  expect(snapped).toEqual({ x: 26, y: -1, z: 0 })
})
