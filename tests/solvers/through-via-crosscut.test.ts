import { expect, test } from "bun:test"
import { getThroughViaCrosscutFeasibility } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getThroughViaCrosscutFeasibility"

test("two through vias can separate opposite faces despite fitting as an isolated barrel pair", (): void => {
  const bounds = { minX: 279.29855748, maxX: 279.831957, minY: 68.585798, maxY: 69.07170082 }
  const domain = { minX: 279.29855748, maxX: 279.64920018, minY: 68.585798, maxY: 68.92170083 }
  const input = {
    bounds,
    vias: [
      { owner: "A", bounds: domain, routeIds: [1, 4], candidate: false },
      { owner: "B", bounds: domain, routeIds: [], candidate: true },
    ],
    wires: [{ owner: "C", axis: "x" as const, routeIds: [0], candidate: false }],
    radius: 0.295 - 1e-9, minimumViaSpacing: 0.399999 - 1e-9, slack: 1e-9,
  }
  const snapshot = structuredClone(input)
  expect(getThroughViaCrosscutFeasibility(input)).toEqual({
    feasible: false, alternativeBlockerRouteIdSets: [[1, 4], [0]],
  })
  expect(getThroughViaCrosscutFeasibility({ ...input, wires: [] })).toEqual({ feasible: true })
  expect(getThroughViaCrosscutFeasibility({ ...input, vias: [] })).toEqual({ feasible: true })
  expect(getThroughViaCrosscutFeasibility({ ...input, vias: input.vias.slice(0, 1) })).toEqual({ feasible: true })
  expect(getThroughViaCrosscutFeasibility({ ...input, wires: [{ ...input.wires[0]!, owner: "A" }] }))
    .toEqual({ feasible: true })
  expect(getThroughViaCrosscutFeasibility({ ...input, minimumViaSpacing: 0.395 }))
    .toEqual({ feasible: true })
  expect(getThroughViaCrosscutFeasibility({ ...input, radius: 0.293 }))
    .toEqual({ feasible: true })
  const rotate = (box: typeof bounds): typeof bounds => {
    return {
      minX: box.minY,
      maxX: box.maxY,
      minY: box.minX,
      maxY: box.maxX,
    }
  }
  expect(getThroughViaCrosscutFeasibility({
    ...input, bounds: rotate(bounds),
    vias: input.vias.map((via) => ({ ...via, bounds: rotate(via.bounds) })),
    wires: [{ ...input.wires[0]!, axis: "y" }],
  })).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1, 4], [0]] })
  expect(getThroughViaCrosscutFeasibility({
    ...input, vias: input.vias.map((via) => ({ ...via, candidate: true })),
    wires: [{ ...input.wires[0]!, candidate: true }],
  })).toEqual({ feasible: false, blockerRouteIds: [] })
  expect(input).toEqual(snapshot)
})
