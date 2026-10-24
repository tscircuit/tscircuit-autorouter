import { expect, test } from "bun:test"
import { CollectiveClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/CollectiveClearanceSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("distinct same-net drill sites separate across disjoint blind spans while a shared physical site stays shared", (): void => {
  const routes: HighDensityRoute[] = [0, 0.25, 0].map((x, index) => {
    const lower = index === 1 ? 2 : 0
    return {
      connectionName: `branch_${index}`,
      rootConnectionName: "shared_net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x, y: -1, z: lower, pcb_port_id: `start_${index}` },
        { x, y: 0, z: lower },
        { x, y: 0, z: lower + 1 },
        { x, y: 1, z: lower + 1, pcb_port_id: `end_${index}` },
      ],
      vias: [{ x, y: 0 }],
    }
  })
  const srj = {
      layerCount: 4,
      allowBlindAndBuriedVias: true,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      minViaHoleDiameter: 0.2,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.25,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      obstacles: [],
      connections: [{
        name: "shared_net",
        mergedConnectionNames: routes.map((route): string => route.connectionName),
        pointsToConnect: [],
      }],
  } satisfies SimpleRouteJson
  const input: ConstructorParameters<typeof CollectiveClearanceSolver>[0] = {
    srj,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    boundaryMargin: 0,
    allowViaMovement: true,
    viaClearance: 0.05,
    routes,
    lockedPointIndices: routes.map((route): boolean[] => route.route.map((): boolean => false)),
  }
  const original = structuredClone(input)
  const solver = new CollectiveClearanceSolver(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  const a = output[0]!.vias[0]!
  const b = output[1]!.vias[0]!
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(0.45)
  expect(output[2]!.vias).toEqual(output[0]!.vias)
  expect(solver.stats.addedOwnerIndependentDrillPairs).toBe(1)
  const errors = getDrcErrors(convertToCircuitJson(srj, output), { viaClearance: 0.25 }).errors
  expect(errors.filter((error): boolean => error.type === "pcb_via_clearance_error")).toEqual([])
  for (let index = 0; index < routes.length; index++) {
    expect(output[index]!.route[0]).toEqual(routes[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(routes[index]!.route.at(-1))
    expect(output[index]!.rootConnectionName).toBe("shared_net")
  }
  expect(input).toEqual(original)
})
