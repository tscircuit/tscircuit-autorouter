import { expect, test } from "bun:test"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import { resolvePipeline9PadAreaTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PadAreaTerminals"
import type { Obstacle } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9PadAreaTerminalInput } from "./fixtures/createPipeline9PadAreaTerminalInput"

test("pad-area terminals choose the closest legal interior landing in original rotated rectangles and circles", (): void => {
  for (const shape of ["rect", "circle"] as const) {
    for (const rotation of [0, 30, 90]) {
      const translation = { x: 2, y: -1 }
      const originalSrj = createPipeline9PadAreaTerminalInput(
        rotation,
        translation,
      )
      if (shape === "circle") {
        originalSrj.obstacles[0] = {
          ...originalSrj.obstacles[0]!,
          type: "oval",
        } as unknown as Obstacle
      }
      const routingSrj = structuredClone(originalSrj)
      const originalBefore = structuredClone(originalSrj)
      const routingBefore = structuredClone(routingSrj)
      const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
      const netId = connMap.getNetConnectedToId("net-a")
      if (!netId) throw new Error("Pad-area fixture requires its canonical net")
      const clearance = createPipeline9FixedPadClearance({
        obstacles: originalSrj.obstacles,
        connMap,
        layerCount: 2,
        traceToPadClearance: 0.1,
        viaToPadClearance: 0.1,
      })
      const source = originalSrj.connections[0]!.pointsToConnect[0]!
      expect(
        clearance.traceClearanceIndex.isPointClear({
          point: { x: source.x, y: source.y, z: 0 },
          copperDiameter: 0.25,
          canonicalNetId: netId,
        }),
      ).toBeFalse()
      const result = resolvePipeline9PadAreaTerminals({
        originalSrj,
        routingSrj,
      })
      const landing = result.connections[0]!.pointsToConnect[0]!
      const angle = (rotation * Math.PI) / 180
      expect(landing.x).toBeCloseTo(translation.x + 0.63 * Math.cos(angle), 12)
      expect(landing.y).toBeCloseTo(translation.y + 0.63 * Math.sin(angle), 12)
      expect(landing.pcb_port_id).toBe("pcb-a")
      expect(landing.pointId).toBe("logical-a")
      expect("layer" in landing && landing.layer).toBe("top")
      expect(
        clearance.traceClearanceIndex.isPointClear({
          point: { x: landing.x, y: landing.y, z: 0 },
          copperDiameter: 0.25,
          canonicalNetId: netId,
        }),
      ).toBeTrue()
      const dx = landing.x - translation.x
      const dy = landing.y - translation.y
      const localX = dx * Math.cos(angle) + dy * Math.sin(angle)
      const localY = -dx * Math.sin(angle) + dy * Math.cos(angle)
      if (shape === "circle") {
        expect(Math.hypot(localX, localY) + 0.125).toBeLessThan(1)
      } else {
        expect(Math.abs(localX) + 0.125).toBeLessThan(1)
        expect(Math.abs(localY) + 0.125).toBeLessThan(1)
      }
      expect(
        resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj }),
      ).toEqual(result)
      expect(originalSrj).toEqual(originalBefore)
      expect(routingSrj).toEqual(routingBefore)
    }
  }
})
