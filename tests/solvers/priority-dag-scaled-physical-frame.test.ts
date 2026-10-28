import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("scaled priority candidates retain manufactured copper and same-owner drill clearances", (): void => {
  const solver = new PriorityDagIntraNodeSolver({
    ...priorityParams(),
    priorityCoordinateScale: 2,
    connMap: new ConnectivityMap({ a: ["a"], b: ["b"], c: ["c"] }),
  })
  const route = {
    connectionName: "a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    vias: [] as { x: number; y: number }[],
  }
  const witnesses = [
    { route, ancestors: [] },
    { route: { ...route, connectionName: "b", route: route.route.map((p) => ({ ...p, y: 0.3 })) }, ancestors: [] },
    undefined,
  ]
  const options = Reflect.get(solver, "getOptions").call(solver, 0, {
    witnesses,
    ancestors: [new Set(), new Set(), new Set()],
  })
  expect(options.traceThickness).toBe(0.2)
  expect(options.viaDiameter).toBe(0.6)
  expect(options.obstacleMargin).toBe(0.2)
  expect(options.hyperParameters.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE).toBe(0.2)
  // A 0.3mm centerline gap in the enlarged frame becomes 0.15mm on the board;
  // 0.1mm wires therefore have only 0.05mm of the requested 0.1mm clearance.
  expect(Reflect.get(solver, "pairConflict").call(solver, 0, 1, { witnesses })).toBeTrue()
  witnesses[1] = { ...witnesses[1]!, route: { ...witnesses[1]!.route, route: witnesses[1]!.route.route.map((p) => ({ ...p, y: 0.5 })) } }
  expect(Reflect.get(solver, "pairConflict").call(solver, 0, 1, { witnesses })).toBeFalse()

  const sameOwner = new PriorityDagIntraNodeSolver({
    ...priorityParams(),
    priorityCoordinateScale: 2,
    connMap: new ConnectivityMap({ shared: ["a", "b", "c"] }),
  })
  witnesses[0]!.route.vias = [{ x: 0, y: 0 }]
  witnesses[1]!.route.vias = [{ x: 0.4, y: 0 }]
  expect(Reflect.get(sameOwner, "pairConflict").call(sameOwner, 0, 1, { witnesses })).toBeTrue()
  witnesses[1]!.route.vias = [{ x: 0, y: 0 }]
  expect(Reflect.get(sameOwner, "pairConflict").call(sameOwner, 0, 1, { witnesses })).toBeFalse()
})
