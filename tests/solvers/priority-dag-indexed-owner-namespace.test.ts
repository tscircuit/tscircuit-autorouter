import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams, detailedPriority } from "./priorityDagTestUtils"

test("indexed owner membership is charged and canonical net names never alias unregistered literal connections", () =>
  detailedPriority(() => {
    const params = priorityParams()
    params.nodeWithPortPoints.portPoints =
      params.nodeWithPortPoints.portPoints.map((p) =>
        p.connectionName === "a" ? { ...p, connectionName: "net0" } : p,
      )
    const connMap = new ConnectivityMap({ net0: ["b"] })
    const solver = new PriorityDagIntraNodeSolver({ ...params, connMap })
    expect(Reflect.get(solver, "owner")).toEqual([
      JSON.stringify(["literal", "c"]),
      JSON.stringify(["registered", "net0"]),
      JSON.stringify(["literal", "net0"]),
    ])
    const wire = {
      connectionName: "b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    }
    const state = {
      ancestors: [new Set(), new Set(), new Set()],
      witnesses: [
        undefined,
        { id: 0, task: 1, route: wire, ancestors: [] },
        { id: 1, task: 2, route: { ...wire, connectionName: "net0" }, ancestors: [] },
      ],
    }
    expect(Reflect.get(solver, "pairConflict").call(solver, 1, 2, state)).toBe(
      true,
    )
    const duplicate = new ConnectivityMap({ one: ["a", "x"], two: ["a", "b"] })
    const authority = new PriorityDagIntraNodeSolver({
      ...priorityParams(),
      connMap: duplicate,
    })
    expect(duplicate.getNetConnectedToId("a")).toBe("two")
    expect(Reflect.get(authority, "owner")[1]).toBe(
      Reflect.get(authority, "owner")[2],
    )
    const stale = new ConnectivityMap({ one: ["a"] })
    stale.netMap.one = []
    expect(
      () =>
        new PriorityDagIntraNodeSolver({ ...priorityParams(), connMap: stale }),
    ).toThrow("Stale indexed priority owner")
    const unrelated = new PriorityDagIntraNodeSolver({
      ...priorityParams(),
      connMap: new ConnectivityMap(
        Object.fromEntries(
          Array.from({ length: 4000 }, (_, i) => [`n${i}`, [`p${i}`]]),
        ),
      ),
    })
    expect(unrelated.priorityDiagnostics.priorityOwnerLookups).toBe(3)
    expect(
      unrelated.priorityDiagnostics.priorityOwnerMemberVisits,
    ).toBeUndefined()
    expect(unrelated.iterations).toBeLessThan(100)
  }))
