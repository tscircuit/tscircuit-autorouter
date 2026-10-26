import { expect, test } from "bun:test"
import {
  getViaApproachCrosscutFeasibility,
  type CrosscutBoundaryContact,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getViaApproachCrosscutFeasibility"

test("approach crosscuts preserve orientation, via escapes, ordered contacts and resource alternatives", (): void => {
  const bounds = {
    minX: 281.07565578,
    maxX: 281.32565782,
    minY: 68.585798,
    maxY: 69.863401,
  }
  const pocket = {
    minX: 281.1663,
    maxX: 281.235,
    minY: 68.585798,
    maxY: 68.6274,
  }
  const input = {
    bounds,
    approaches: [
      {
        owner: "A",
        layer: 1,
        bounds: pocket,
        routeIds: [1, 4],
        candidate: false,
        contact: {
          side: "left" as const,
          normal: bounds.minX,
          min: 69.288401,
          max: bounds.maxY,
        },
      },
    ],
    wires: [
      {
        owner: "W",
        layer: 1,
        viaBounds: pocket,
        routeIds: [],
        candidate: true,
        first: {
          side: "left" as const,
          normal: bounds.minX,
          min: 68.8134006,
          max: 69.288401,
        },
        second: {
          side: "right" as const,
          normal: bounds.maxX,
          min: 69.288401,
          max: 69.540399,
        },
      },
    ],
    radius: 0.295 - 4e-9,
    minimumForeignViaSpacing: 0.399999,
    minimumSameOwnerViaSpacing: 0.249999,
    minimumTraceSpacing: 0.195,
    slack: 1e-9,
  }
  const snapshot = structuredClone(input)
  expect(getViaApproachCrosscutFeasibility(input)).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[1, 4]],
  })
  expect(
    getViaApproachCrosscutFeasibility({
      ...input,
      minimumSameOwnerViaSpacing: 0.05,
    }),
  ).toEqual({ feasible: true })
  expect(
    getViaApproachCrosscutFeasibility({
      ...input,
      wires: [{ ...input.wires[0]!, viaBounds: bounds }],
    }),
  ).toEqual({ feasible: true })
  expect(
    getViaApproachCrosscutFeasibility({
      ...input,
      approaches: [
        {
          ...input.approaches[0]!,
          contact: { ...input.approaches[0]!.contact, min: 69, max: 69.1 },
        },
      ],
    }),
  ).toEqual({ feasible: true })
  expect(
    getViaApproachCrosscutFeasibility({
      ...input,
      approaches: [{ ...input.approaches[0]!, layer: 2 }],
    }),
  ).toEqual({ feasible: true })
  expect(
    getViaApproachCrosscutFeasibility({
      ...input,
      wires: [{ ...input.wires[0]!, owner: "A" }],
    }),
  ).toEqual({ feasible: true })
  expect(getViaApproachCrosscutFeasibility({ ...input, radius: 0.15 })).toEqual(
    { feasible: true },
  )
  const rotateBounds = (box: typeof bounds): typeof bounds => {
    return {
      minX: box.minY,
      maxX: box.maxY,
      minY: box.minX,
      maxY: box.maxX,
    }
  }
  const rotateContact = (
    contact: CrosscutBoundaryContact,
  ): CrosscutBoundaryContact => {
    const sides = {
      left: "bottom",
      right: "top",
      bottom: "left",
      top: "right",
    } as const
    return {
      ...contact,
      side: sides[contact.side],
    }
  }
  expect(getViaApproachCrosscutFeasibility({
    ...input, bounds: rotateBounds(bounds),
    approaches: input.approaches.map((event) => ({ ...event, bounds: rotateBounds(event.bounds), contact: rotateContact(event.contact) })),
    wires: input.wires.map((event) => ({ ...event, viaBounds: rotateBounds(event.viaBounds), first: rotateContact(event.first), second: rotateContact(event.second) })),
  })).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1, 4]] })
  const reflectBounds = (box: typeof bounds): typeof bounds => {
    return {
      ...box,
      minY: bounds.minY + bounds.maxY - box.maxY,
      maxY: bounds.minY + bounds.maxY - box.minY,
    }
  }
  const reflectContact = (contact: CrosscutBoundaryContact): CrosscutBoundaryContact => {
    return {
      ...contact,
      min: bounds.minY + bounds.maxY - contact.max,
      max: bounds.minY + bounds.maxY - contact.min,
    }
  }
  expect(getViaApproachCrosscutFeasibility({
    ...input, approaches: input.approaches.map((event) => ({ ...event, bounds: reflectBounds(event.bounds), contact: reflectContact(event.contact) })),
    wires: input.wires.map((event) => ({ ...event, viaBounds: reflectBounds(event.viaBounds), first: reflectContact(event.first), second: reflectContact(event.second) })),
  })).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1, 4]] })
  const shifted = { ...input.approaches[0]!, contact: { ...input.approaches[0]!.contact, normal: bounds.minX + 0.5e-9 } }
  expect(getViaApproachCrosscutFeasibility({ ...input, approaches: [shifted] })).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1, 4]] })
  expect(getViaApproachCrosscutFeasibility({ ...input, approaches: [{ ...shifted, contact: { ...shifted.contact, normal: bounds.minX + 0.001 } }] })).toEqual({ feasible: true })
  expect(input).toEqual(snapshot)
})
