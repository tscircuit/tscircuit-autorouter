import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("same-net recognized pad fragments attach to mesh-route vias through root connectivity without PCB ports", (): void => {
  const a = columnRoute("a_mst1", [
    { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 1 },
  ], [{ x: 0, y: 0 }])
  a.rootConnectionName = "a"
  const b = columnRoute("b", [{ x: -4, y: 4, z: 0 }, { x: 4, y: 4, z: 0 }])
  for (const shape of ["smt", "plated"] as const) {
    const baseId = `pcb_${shape}_same`
    const obstacles = [0.35, 0.3].map((x) => ({
      type: "rect" as const, center: { x, y: 0 }, width: 0.2, height: 0.2,
      layers: shape === "smt" ? ["top"] : ["top", "bottom"],
      __zLayers: shape === "smt" ? [0] : [0, 3], connectedTo: [baseId],
      circuitJsonMetadata: shape === "smt" ? { pcb_smtpad_id: baseId } : { pcb_plated_hole_id: baseId },
    }))
    const same = columnPool([a, b], { obstacles, viaToPadClearance: 0.4,
      connMap: new ConnectivityMap({ same: ["a", baseId] }) })
    same.offerRoute(a, "native")
    expect(same.params.diagnostics.routeColumnAcceptedColumns).toBe(1)
    const unrelated = columnPool([a, b], { obstacles, viaToPadClearance: 0.4,
      connMap: new ConnectivityMap({ other: ["other", baseId] }) })
    unrelated.offerRoute(a, "native")
    expect(unrelated.params.diagnostics.routeColumnAcceptedColumns ?? 0).toBe(0)
    expect(unrelated.params.diagnostics.routeColumnRejectedStatic).toBe(1)
  }
})
