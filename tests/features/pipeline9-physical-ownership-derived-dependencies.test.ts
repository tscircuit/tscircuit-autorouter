import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership, getPipeline9PhysicalRouteOwner } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { SimpleRouteJson } from "lib/types"

test("later resolved trace parents veto a conflicting derived child", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    connections: [
      { name: "a", pointsToConnect: [{ x: -4, y: 0, layer: "top", pointId: "point-a", pcb_port_id: "port-a" }] },
      { name: "b", pointsToConnect: [{ x: 4, y: 0, layer: "top", pointId: "point-b", pcb_port_id: "port-b" }] },
    ], obstacles: [],
  }
  const context = getPipeline9PhysicalOwnership({ originalSrj, derivedRouteAliases: [{ connectionName: "fixed-parent-piece", parentTraceId: "parent" }], derivedTraces: [
    { type: "pcb_trace", pcb_trace_id: "child", connection_name: "child-net", connectsTo: ["port-a", "parent"], route: [] },
    { type: "pcb_trace", pcb_trace_id: "parent", connection_name: "parent-net", connectsTo: ["port-b"], route: [] },
  ] })
  expect(getPipeline9PhysicalRouteOwner(context, { connectionName: "parent-net" })).toBe(getPipeline9PhysicalRouteOwner(context, { connectionName: "b" }))
  expect(getPipeline9PhysicalRouteOwner(context, { connectionName: "child-net" })).toBeUndefined()
  expect(getPipeline9PhysicalRouteOwner(context, { connectionName: "fixed-parent-piece" })).toBe(getPipeline9PhysicalRouteOwner(context, { connectionName: "b" }))
  expect(context.diagnostics.ambiguousDerivedAliases).toContain("child")
  expect(context.aliasOwners["port-a"]).toBe(getPipeline9PhysicalRouteOwner(context, { connectionName: "a" })!)
})
