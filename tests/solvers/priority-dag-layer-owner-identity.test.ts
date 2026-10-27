import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("priority pair guards use full via span, exact registered owners, and strict route identities", () =>
  detailedPriority(() => {
    const route = (
      name: string,
      points: Array<{ x: number; y: number; z: number }>,
      vias: Array<{ x: number; y: number }>,
    ) => ({
      connectionName: name,
      rootConnectionName: `root-${name}`,
      regionId: "region",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: points,
      vias,
    })
    const wire = route(
      "c",
      [
        { x: -1, y: 0, z: 2 },
        { x: 1, y: 0, z: 2 },
      ],
      [],
    )
    const via = route(
      "b",
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      [{ x: 0, y: 0 }],
    )
    for (const blind of [false, true]) {
      const solver = new PriorityDagIntraNodeSolver({
        ...priorityParams(),
        layerCount: 4,
        allowBlindAndBuriedVias: blind,
      })
      const state = {
        ancestors: [new Set(), new Set(), new Set()],
        witnesses: [
          { id: 0, task: 0, route: wire, ancestors: [] },
          { id: 1, task: 1, route: via, ancestors: [] },
          undefined,
        ],
      }
      expect(
        Reflect.get(solver, "pairConflict").call(solver, 0, 1, state),
      ).toBe(!blind)
    }
    const params = priorityParams()
    // Canonical net key net0 is also a member of another net. Resolve the actual
    // registered connection, never root-name alias recursion.
    const solver = new PriorityDagIntraNodeSolver({
      ...params,
      connMap: new ConnectivityMap({ net0: ["c"], net1: ["b", "net0"] }),
    })
    const crossing = {
      ancestors: [new Set(), new Set(), new Set()],
      witnesses: [
        { id: 0, task: 0, route: wire, ancestors: [] },
        { id: 1, task: 1, route: { ...wire, connectionName: "b" }, ancestors: [] },
        undefined,
      ],
    }
    expect(
      Reflect.get(solver, "pairConflict").call(solver, 0, 1, crossing),
    ).toBe(true)
    const state = {
      ancestors: [new Set(), new Set(), new Set()],
      witnesses: [undefined, undefined, undefined],
    }
    const valid = route(
      "c",
      [
        { x: 1.5, y: 2.2, z: 0 },
        { x: 2.7, y: 2.2, z: 0 },
      ],
      [],
    )
    const store = Reflect.get(solver, "storeRoute").bind(solver)
    expect(() =>
      store({ ...valid, rootConnectionName: undefined }, state, 0),
    ).toThrow("route identity")
    expect(() => store({ ...valid, regionId: "elsewhere" }, state, 0)).toThrow(
      "route identity",
    )
    expect(() =>
      store({ ...valid, route: [...valid.route].reverse() }, state, 0),
    ).toThrow("route identity")
  }))
