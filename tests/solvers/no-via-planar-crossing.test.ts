import { expect, test } from "bun:test"
import { getNoViaPlanarCrossingFeasibility } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getNoViaPlanarCrossingFeasibility"
import type {
  CrosscutBoundaryContact,
  PlanarCrosscutDemand,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getViaApproachCrosscutFeasibility"

test("only forced same-layer alternation with two proven empty via domains is rejected", (): void => {
  const bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  const empty = { minX: 1, maxX: 0, minY: 0, maxY: 1 }
  const wires: PlanarCrosscutDemand[] = [
    {
      owner: "A",
      layer: 1,
      viaBounds: empty,
      routeIds: [0, 4],
      candidate: false,
      first: { side: "left", normal: 0, min: 0.7, max: 0.9 },
      second: { side: "right", normal: 1, min: 0.1, max: 0.3 },
    },
    {
      owner: "B",
      layer: 1,
      viaBounds: empty,
      routeIds: [],
      candidate: true,
      first: { side: "left", normal: 0, min: 0.1, max: 0.3 },
      second: { side: "right", normal: 1, min: 0.7, max: 0.9 },
    },
  ]
  const input = { bounds, wires, minimumTraceSpacing: 0.195, slack: 1e-9 }
  const snapshot = structuredClone(input)
  expect(getNoViaPlanarCrossingFeasibility(input)).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[0, 4]],
  })
  expect(
    getNoViaPlanarCrossingFeasibility({
      ...input,
      wires: [wires[0]!, { ...wires[1]!, layer: 2 }],
    }),
  ).toEqual({ feasible: true })
  expect(
    getNoViaPlanarCrossingFeasibility({
      ...input,
      wires: [wires[0]!, { ...wires[1]!, owner: "A" }],
    }),
  ).toEqual({ feasible: true })
  expect(
    getNoViaPlanarCrossingFeasibility({
      ...input,
      wires: [wires[0]!, { ...wires[1]!, viaBounds: bounds }],
    }),
  ).toEqual({ feasible: true })
  expect(
    getNoViaPlanarCrossingFeasibility({
      ...input,
      wires: [
        wires[0]!,
        { ...wires[1]!, second: { ...wires[1]!.second, min: 0.02, max: 0.08 } },
      ],
    }),
  ).toEqual({ feasible: true })
  expect(
    getNoViaPlanarCrossingFeasibility({
      ...input,
      wires: [
        { ...wires[0]!, first: { ...wires[0]!.first, min: 0.2, max: 0.8 } },
        wires[1]!,
      ],
    }),
  ).toEqual({ feasible: true })
  expect(
    getNoViaPlanarCrossingFeasibility({
      ...input,
      wires: [
        { ...wires[0]!, first: { ...wires[0]!.first, normal: 0.01 } },
        wires[1]!,
      ],
    }),
  ).toEqual({ feasible: true })
  const rotate = (
    contact: CrosscutBoundaryContact,
  ): CrosscutBoundaryContact => {
    const side = {
      left: "bottom",
      right: "top",
      bottom: "left",
      top: "right",
    } as const
    return {
      ...contact,
      side: side[contact.side],
    }
  }
  expect(
    getNoViaPlanarCrossingFeasibility({
      ...input,
      wires: wires.map((wire) => ({
        ...wire,
        first: rotate(wire.first),
        second: rotate(wire.second),
      })),
    }),
  ).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[0, 4]] })
  const fourSides: PlanarCrosscutDemand[] = [
    {
      ...wires[0]!,
      first: { side: "top", normal: 1, min: 0.1, max: 0.2 },
      second: { side: "bottom", normal: 0, min: 0.7, max: 0.8 },
    },
    {
      ...wires[1]!,
      first: { side: "right", normal: 1, min: 0.7, max: 0.8 },
      second: { side: "left", normal: 0, min: 0.1, max: 0.2 },
    },
  ]
  expect(
    getNoViaPlanarCrossingFeasibility({ ...input, wires: fourSides }),
  ).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[0, 4]] })
  expect(input).toEqual(snapshot)
})
