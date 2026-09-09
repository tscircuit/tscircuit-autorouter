import { expect, test } from "bun:test"
import { createsTraceCrossing } from "lib/solvers/ClearanceProjectionSolver/createsTraceCrossing"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("projection rejects new foreign vertex contacts and collinear overlaps", (): void => {
  for (const offset of [0, -17.3, 42]) {
    for (const transpose of [false, true]) {
      const makeRoute = (
        connectionName: string,
        points: [number, number][],
      ): HighDensityRoute => ({
        connectionName,
        traceThickness: 0.15,
        viaDiameter: 0.3,
        vias: [],
        route: points.map(([x, y]): HighDensityRoute["route"][number] => ({
          x: offset + (transpose ? y : x),
          y: offset + (transpose ? x : y),
          z: 0,
        })),
      })
      const wire = makeRoute("horizontal", [
        [-1, 0],
        [1, 0],
      ])
      const separated = makeRoute("foreign", [
        [-0.75, 1],
        [-0.5, 0.2],
        [0.5, 0.2],
        [0.75, 1],
      ])
      const vertexContact = makeRoute("foreign", [
        [-0.75, 1],
        [0, 0],
        [0.5, 0.2],
        [0.75, 1],
      ])
      const overlap = makeRoute("foreign", [
        [-0.75, 1],
        [-0.5, 0],
        [0.5, 0],
        [0.75, 1],
      ])
      const disjoint = makeRoute("foreign", [
        [2, 0],
        [3, 0],
      ])
      expect(
        createsTraceCrossing([wire, separated], [wire, vertexContact]),
      ).toBe(true)
      expect(createsTraceCrossing([wire, separated], [wire, overlap])).toBe(
        true,
      )
      expect(createsTraceCrossing([wire, overlap], [wire, overlap])).toBe(false)
      expect(createsTraceCrossing([wire, disjoint], [wire, disjoint])).toBe(
        false,
      )
      expect(
        createsTraceCrossing(
          [wire, separated],
          [wire, { ...overlap, rootConnectionName: "horizontal" }],
        ),
      ).toBe(false)
    }
  }
})
