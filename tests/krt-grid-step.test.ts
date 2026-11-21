import { expect, test } from "bun:test"
import { getKrtGridStep } from "lib/testing/getKrtGridStep"
import { KrtAutoroutingPipelineSolver } from "lib/testing/KrtAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/bug-reports/rp2350-xout-krt/input.srj.json"

test("KRT refines physically open terminal clearances and honors a caller's grid", (): void => {
  const input = structuredClone(fixture) as SimpleRouteJson
  expect(getKrtGridStep(input, 0.1)).toBe(0.1) // The coarse grid already fits.
  expect(getKrtGridStep(input, 0.2)).toBe(0.02)
  expect(getKrtGridStep(input, 0.3)).toBe(0.1) // Even the physical center is obstructed.

  const solver = new KrtAutoroutingPipelineSolver(input, {
    krtOptions: { gridStep: 0.1 },
  })
  expect(() => solver.solve()).toThrow(
    /found no route for connection source_net_29 segment 0/,
  )
})
