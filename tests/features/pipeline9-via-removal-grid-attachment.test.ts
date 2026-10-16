import { expect, test } from "bun:test"
import { get45DegreeViaRemovalPath } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/get45DegreeViaRemovalPath"

test("via removal connects an off-grid anchor with an axis segment and a 45-degree bend", (): void => {
  const path = [
    { x: 0.013, y: 0.027, z: 0, pcb_port_id: "terminal" },
    { x: 0.1, y: 0.1, z: 0 },
  ]

  const result = get45DegreeViaRemovalPath(path)
  expect(result).toHaveLength(3)
  expect(result[0]).toBe(path[0])
  expect(result[1]!.x).toBeCloseTo(0.027, 12)
  expect(result[1]!.y).toBe(path[0]!.y)
  expect(result[1]!.pcb_port_id).toBeUndefined()
  expect(result[2]).toBe(path[1])
})
