import { expect, test } from "bun:test"
import { resolvePipeline9PadAreaTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PadAreaTerminals"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9PadAreaTerminalInput } from "./fixtures/createPipeline9PadAreaTerminalInput"

test("eligible pad-area terminals fail honestly when foreign copper or board clearance excludes the supported landing set", (): void => {
  for (const variant of ["foreign-copper", "board-clearance"] as const) {
    const originalSrj = createPipeline9PadAreaTerminalInput()
    if (variant === "foreign-copper") {
      originalSrj.obstacles[1] = {
        ...originalSrj.obstacles[1]!,
        // Cover the own pad without sharing its electrical coordinate key.
        center: { x: 0.25, y: 0 },
        width: 4,
        height: 4,
      }
      const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
      expect(connMap.areIdsConnected("own-pad", "pcb-a")).toBe(true)
      expect(connMap.areIdsConnected("foreign-pad", "foreign-net")).toBe(true)
      expect(connMap.areIdsConnected("pcb-a", "foreign-net")).toBe(false)
    } else {
      originalSrj.obstacles.pop()
      originalSrj.bounds = { minX: -0.2, maxX: 0.2, minY: -0.2, maxY: 0.2 }
      originalSrj.minBoardEdgeClearance = 0.1
    }
    const routingSrj = structuredClone(originalSrj)
    const originalBefore = structuredClone(originalSrj)
    const routingBefore = structuredClone(routingSrj)
    expect((): void => {
      resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })
    }).toThrow("no legal candidate in the supported landing set")
    expect(originalSrj).toEqual(originalBefore)
    expect(routingSrj).toEqual(routingBefore)
    expect(routingSrj.connections[0]!.pointsToConnect[0]!.x).toBe(0.875)
  }
})
