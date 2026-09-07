import { expect, test } from "bun:test"
import { applyPipeline9PadTraceDetour } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceDetour"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("pad detours preserve adjacent protected spans and reject unavailable geometry without mutation", (): void => {
  const pad = {
    type: "pcb_smtpad",
    pcb_smtpad_id: "physical-pad",
    shape: "rect",
    x: 0,
    y: 0,
    width: 0.4,
    height: 0.4,
    layer: "top",
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
  const route: HighDensityRoute = {
    connectionName: "A",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    route: [
      { x: -2, y: 0, z: 1, pcb_port_id: "A-start" },
      {
        x: -2,
        y: 0,
        z: 1,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: {
          pcb_plated_hole_id: "connected-through-pad",
        },
      },
      { x: -1.5, y: 0, z: 0, traceThickness: 0.2 },
      { x: 1.5, y: 0, z: 0, traceThickness: 0.07 },
      { x: 1.5, y: 0, z: 1 },
      { x: 2, y: 0, z: 1, pcb_port_id: "A-end" },
    ],
    vias: [{ x: 1.5, y: 0 }],
  }
  const target = getPipeline9PadCopperForceTarget({
    pad,
    route,
    obstacles,
    layerCount: 2,
  })
  if (!target)
    throw new Error("The protected-span fixture needs its pad target")
  expect(target.segmentIndex).toBe(2)
  const original = structuredClone({ route, pad, obstacles, target })
  const candidate = structuredClone(route)
  const originalPoints = [...candidate.route]
  const originalVias = candidate.vias
  const bounds = { minX: -2, maxX: 2, minY: -1, maxY: 1 }
  const params = {
    route: candidate,
    target,
    pad,
    minimumClearance: 0.1,
    direction: "nearest" as const,
    bounds,
    layerCount: 2,
  }
  expect(applyPipeline9PadTraceDetour(params)).toBe(true)
  expect(candidate.route).toHaveLength(originalPoints.length + 4)
  for (const [index, point] of originalPoints.entries()) {
    expect(candidate.route[index <= 2 ? index : index + 4]).toBe(point)
    expect(point).toEqual(route.route[index])
  }
  expect(candidate.route[1]!.toNextSegmentCircuitJsonMetadata).toBe(
    originalPoints[1]!.toNextSegmentCircuitJsonMetadata,
  )
  expect(candidate.route[2]).toBe(originalPoints[2])
  expect(candidate.route[7]).toBe(originalPoints[3])
  expect(candidate.route[8]).toBe(originalPoints[4])
  expect(candidate.vias).toBe(originalVias)
  expect(candidate.vias).toEqual(route.vias)

  const invalidCases = [
    "through-edge",
    "layer-transition",
    "zero-length",
    "wrong-pad-layer",
    "endpoint-in-envelope",
    "no-in-domain-side",
  ] as const
  for (const name of invalidCases) {
    const unchanged = structuredClone(route)
    if (name === "through-edge") {
      unchanged.route[2]!.toNextSegmentType = "through_obstacle"
    }
    if (name === "layer-transition") unchanged.route[3]!.z = 1
    if (name === "zero-length") unchanged.route[3]!.x = -1.5
    if (name === "endpoint-in-envelope") unchanged.route[2]!.x = -0.3
    const before = structuredClone(unchanged)
    const beforePoints = [...unchanged.route]
    const beforeVias = unchanged.vias
    expect(
      applyPipeline9PadTraceDetour({
        ...params,
        route: unchanged,
        pad: name === "wrong-pad-layer" ? { ...pad, layer: "bottom" } : pad,
        bounds:
          name === "no-in-domain-side"
            ? { ...bounds, minY: -0.1, maxY: 0.1 }
            : bounds,
      }),
      name,
    ).toBe(false)
    expect(unchanged, name).toEqual(before)
    expect(unchanged.vias, name).toBe(beforeVias)
    for (const [index, point] of unchanged.route.entries()) {
      expect(point, name).toBe(beforePoints[index])
    }
  }

  // The nearest geometric side is above this trace but outside this node.
  // Asking for it must not silently try the opposite side instead.
  const asymmetric: HighDensityRoute = {
    ...route,
    route: [
      { x: -1.5, y: 0.27, z: 0 },
      { x: 1.5, y: 0.27, z: 0 },
    ],
    vias: [],
  }
  const asymmetricTarget = getPipeline9PadCopperForceTarget({
    pad,
    route: asymmetric,
    obstacles,
    layerCount: 2,
  })
  if (!asymmetricTarget) {
    throw new Error("The asymmetric fixture needs its target")
  }
  const asymmetricBefore = structuredClone(asymmetric)
  const asymmetricParams = {
    ...params,
    route: asymmetric,
    target: asymmetricTarget,
    bounds: { ...bounds, maxY: 0.3 },
  }
  expect(applyPipeline9PadTraceDetour(asymmetricParams)).toBe(false)
  expect(asymmetric).toEqual(asymmetricBefore)
  expect(
    applyPipeline9PadTraceDetour({
      ...asymmetricParams,
      direction: "opposite",
    }),
  ).toBe(true)

  for (const minimumClearance of [Number.NaN, Infinity, -0.1]) {
    const unchanged = structuredClone(route)
    expect(() =>
      applyPipeline9PadTraceDetour({
        ...params,
        route: unchanged,
        minimumClearance,
      }),
    ).toThrow("Pipeline9 pad detour requires official clearance and width")
    expect(unchanged).toEqual(route)
  }
  expect(() =>
    applyPipeline9PadTraceDetour({
      ...params,
      route: structuredClone(route),
      pad: { ...pad, pcb_smtpad_id: "different-physical-pad" },
    }),
  ).toThrow("Pipeline9 pad detour requires its exact physical copper")
  expect({ route, pad, obstacles, target }).toEqual(original)
})
