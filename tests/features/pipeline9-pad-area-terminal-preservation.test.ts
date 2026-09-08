import { expect, test } from "bun:test"
import { resolvePipeline9PadAreaTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PadAreaTerminals"
import { createPipeline9PadAreaTerminalInput } from "./fixtures/createPipeline9PadAreaTerminalInput"

test("pad-area normalization preserves clear original terminals including valid wide traces on small own pads", (): void => {
  for (const variant of ["clear", "small-own-pad", "other-layer-blocker"]) {
    const originalSrj = createPipeline9PadAreaTerminalInput()
    if (variant === "other-layer-blocker") {
      originalSrj.obstacles[1]!.layers = ["bottom"]
    } else {
      originalSrj.obstacles.pop()
    }
    if (variant === "small-own-pad") {
      originalSrj.obstacles[0]!.width = 0.1
      originalSrj.obstacles[0]!.height = 0.1
      originalSrj.connections[0]!.pointsToConnect[0]!.x = 0
    }
    const routingSrj = structuredClone(originalSrj)
    const originalBefore = structuredClone(originalSrj)
    const routingBefore = structuredClone(routingSrj)
    const originalPoint = routingSrj.connections[0]!.pointsToConnect[0]!
    const result = resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })
    expect(result).toBe(routingSrj)
    expect(result.connections).toBe(routingSrj.connections)
    expect(result.connections[0]!.pointsToConnect[0]).toBe(originalPoint)
    expect(originalSrj).toEqual(originalBefore)
    expect(routingSrj).toEqual(routingBefore)
  }
})
