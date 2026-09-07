import { expect, test } from "bun:test"
import {
  applyPipeline9PadTraceForce,
  getPipeline9PadTraceForceMovablePointIndexes,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceForce"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 pad-wire motion preserves via stacks, terminals and metadata", (): void => {
  const cases = [
    "free-wire",
    "variable-width",
    "terminal",
    "through-span",
    "protected-point",
    "terminal-prefix",
    "terminal-suffix",
    "coincident-via-stack",
    "contact",
    "wrong-layer",
  ] as const
  for (const name of cases) {
    const route: HighDensityRoute = {
      connectionName: "wire",
      rootConnectionName: "wire-root",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.4, y: -0.35, z: 0 },
        { x: 0.1, y: -0.2, z: 0, traceThickness: 0.1 },
        { x: 0.2, y: 0.05, z: 0 },
        { x: 0.2, y: 0.05, z: 1 },
        { x: 0.8, y: 0.05, z: 1 },
        { x: 0.9, y: 0.5, z: 1 },
      ],
      vias: [{ x: 0.2, y: 0.05 }],
    }
    const protectedPointIndexes = new Set<number>()
    if (name === "variable-width") route.route[1]!.traceThickness = 0.2
    if (name === "terminal") route.route[1]!.pcb_port_id = "wire-terminal"
    if (name === "through-span") {
      route.route[0]!.toNextSegmentType = "through_obstacle"
      route.route[0]!.toNextSegmentCircuitJsonMetadata = {
        pcb_plated_hole_id: "connected-through-pad",
      }
    }
    if (name === "protected-point") protectedPointIndexes.add(1)
    if (name === "terminal-prefix") {
      route.route[0] = { ...route.route[1]! }
    }
    if (name === "terminal-suffix") {
      route.route = [route.route[0]!, route.route[1]!, { ...route.route[1]! }]
      route.vias = []
    }
    if (name === "coincident-via-stack") {
      route.route.splice(2, 0, { ...route.route[2]! })
      // Exercise the transition-stack provenance, not the explicit via list.
      route.vias = []
    }
    if (name === "contact") {
      route.route[1] = { x: -0.05, y: 0, z: 0 }
    }
    const pad = {
      type: "pcb_smtpad",
      pcb_smtpad_id: "foreign-pad",
      shape: "rect",
      x: -0.5,
      y: 0,
      width: 1,
      height: 0.2,
      layer: name === "wrong-layer" ? "inner2" : "top",
    }
    const obstacles: Obstacle[] = [
      {
        type: "rect",
        center: { x: pad.x, y: pad.y },
        width: pad.width,
        height: pad.height,
        layers: [pad.layer],
        connectedTo: [pad.pcb_smtpad_id],
      },
    ]
    const original = structuredClone({ route, pad, obstacles })
    const originalPoints = [...route.route]
    const target = getPipeline9PadCopperForceTarget({
      pad,
      route,
      obstacles,
      layerCount: 4,
    })
    if (name === "wrong-layer") {
      expect(target, name).toBeUndefined()
      expect({ route, pad, obstacles }, name).toEqual(original)
      continue
    }
    expect(target, name).toBeDefined()
    const shouldMove =
      name === "free-wire" ||
      name === "variable-width" ||
      name === "coincident-via-stack"
    if (name === "contact") {
      expect(target!.distance, name).toBe(0)
    } else {
      expect(target!.distance, name).toBeGreaterThan(0)
      expect(
        getPipeline9PadTraceForceMovablePointIndexes({
          route,
          target: target!,
          protectedPointIndexes,
        }),
        name,
      ).toEqual(shouldMove ? [1] : [])
    }
    expect(
      applyPipeline9PadTraceForce({
        route,
        target: target!,
        protectedPointIndexes,
        minimumClearance: 0.15,
        scale: 1,
      }),
      name,
    ).toBe(shouldMove)
    expect(route.route, name).toHaveLength(original.route.route.length)
    for (const [index, point] of route.route.entries()) {
      expect(point, name).toBe(originalPoints[index])
      if (shouldMove && index === 1) {
        expect(point.x, name).toBeGreaterThan(original.route.route[index]!.x)
        expect(point.y, name).toBeLessThan(original.route.route[index]!.y)
        expect(
          {
            ...point,
            x: original.route.route[index]!.x,
            y: original.route.route[index]!.y,
          },
          name,
        ).toEqual(original.route.route[index])
        expect(point.traceThickness, name).toBe(
          original.route.route[index]!.traceThickness,
        )
      } else {
        expect(point, name).toEqual(original.route.route[index])
      }
    }
    expect(route.vias, name).toEqual(original.route.vias)
    expect(pad, name).toEqual(original.pad)
    expect(obstacles, name).toEqual(original.obstacles)
  }
})
