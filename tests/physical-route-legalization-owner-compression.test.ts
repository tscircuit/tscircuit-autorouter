import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type AnnotatedPoint = HighDensityIntraNodeRoute["route"][number] & {
  connectionName?: string
  rootConnectionName?: string
  eventId?: string
}

test("redundant route owner annotations do not prevent exact compression or erase point identities", () => {
  const routes: HighDensityIntraNodeRoute[] = Array.from({ length: 9 }, (_, index) => {
    const connectionName = `route-${index}`, rootConnectionName = index === 8 ? undefined : `root-${index}`
    const route: AnnotatedPoint[] = [-1, 0, 1].map((x) => ({ x, y: index, z: 0,
      connectionName, rootConnectionName }))
    if (index === 1) route[1]!.eventId = "physical-event"
    if (index === 2) route[1]!.connectionName = "different-owner"
    if (index === 3) route[0]!.rootConnectionName = "different-root"
    if (index === 4) route[1]!.pcb_port_id = "interior-terminal"
    if (index === 7) route[1]!.traceThickness = 0.2
    return { connectionName, rootConnectionName, route, traceThickness: 0.1, viaDiameter: 0.3,
      vias: index === 5 ? [{ x: 0, y: index }] : [] }
  })
  const original = structuredClone(routes)
  const result = legalizeHighDensityRouteProposal({ routes, mode: "compression-only", layerCount: 2, clearance: 0.1,
    node: { capacityMeshNodeId: "owners", center: { x: 0, y: 4 }, width: 3, height: 10,
      portPoints: [{ connectionName: "route-6", x: 0, y: 6, z: 0 }] } })
  expect(result.status).toBe("compressed")
  expect(result.routes.map((route) => route.route.length)).toEqual([2, 3, 3, 3, 3, 3, 3, 3, 2])
  expect(result.routes[0]!.route).toEqual([original[0]!.route[0]!, original[0]!.route[2]!])
  expect(result.routes[8]!.route).toEqual([original[8]!.route[0]!, original[8]!.route[2]!])
  for (let index = 1; index < 8; index++) expect(result.routes[index]).toEqual(original[index])
  expect(result.routes.map(({ connectionName, rootConnectionName }) => ({ connectionName, rootConnectionName })))
    .toEqual(original.map(({ connectionName, rootConnectionName }) => ({ connectionName, rootConnectionName })))
  expect(routes).toEqual(original)
})
