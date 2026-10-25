import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("actual caller drill gap protects own-route and same-owner sites independently of copper ownership", () =>
  detailedPriority(() => {
    const params = {
      ...priorityParams(),
      viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.35,
      connMap: new ConnectivityMap({ connected: ["a", "b", "c"] }),
    }
    const solver = new PriorityDagIntraNodeSolver(params)
    const route: HighDensityIntraNodeRoute = {
      connectionName: "c",
      rootConnectionName: "root-c",
      regionId: "region",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [
        { x: 1.8, y: 2.2 },
        { x: 2.2, y: 2.2 },
      ],
      route: [
        { x: 1.5, y: 2.2, z: 0 },
        { x: 1.8, y: 2.2, z: 0 },
        { x: 1.8, y: 2.2, z: 1 },
        { x: 2.2, y: 2.2, z: 1 },
        { x: 2.2, y: 2.2, z: 0 },
        { x: 2.7, y: 2.2, z: 0 },
      ],
    }
    const witness = { route, ancestors: [] }
    const state = {
      ancestors: [new Set(), new Set(), new Set()],
      witnesses: [witness, undefined, undefined],
    }
    const getOptions = Reflect.get(solver, "getOptions").bind(solver)
    const native = new Native(getOptions(0, state))
    let parent = null as
      | Parameters<Native["isNodeTooCloseToObstacle"]>[0]
      | null
    for (const point of route.route) {
      const n = { ...point, g: 0, h: 0, f: 0, parent }
      if (parent && n.z !== parent.z)
        expect(native.isNodeTooCloseToObstacle(n, 0.2, true)).toBe(false)
      parent = n
    }
    expect(Reflect.get(solver, "validateRoute").call(solver, 0, state)).toBe(
      false,
    )
    expect(solver.priorityDiagnostics.priorityFinalDrillPairs).toBe(1)
    const left = { route: { ...route, vias: [route.vias[0]] }, ancestors: [] }
    const right = {
      route: { ...route, connectionName: "b", vias: [route.vias[1]] },
      ancestors: [],
    }
    const pair = { ...state, witnesses: [left, right, undefined] }
    expect(Reflect.get(solver, "pairConflict").call(solver, 0, 1, pair)).toBe(
      true,
    )
    right.route.vias = [route.vias[0]]
    expect(Reflect.get(solver, "pairConflict").call(solver, 0, 1, pair)).toBe(
      false,
    )
  }))
