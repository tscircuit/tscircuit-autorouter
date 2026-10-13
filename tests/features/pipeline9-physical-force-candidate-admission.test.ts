import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  HighDensityForceImproveSolver,
  type ForceImproveCandidate,
} from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { createPipeline9ForceCandidateAdmission } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9ForceCandidateAdmission"
import {
  convertPreloadedTraceToHdRoutes,
  type PreloadedHighDensityRoute,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  getPipeline9RouteCopperGeometry,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { createPipeline9CopperAdmissionSerializer } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9CopperAdmissionSerializer"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

type RecordedFixture = {
  originalSrj: SimpleRouteJson
  nodeWithPortPoints: NodeWithPortPoints[]
  hdRoutes: HighDensityRoute[]
  totalStepsPerNode: number
  nodeAssignmentMargin: number
  recordedCandidateRoutes: HighDensityRoute[]
  recordedPublishedFixedRoutes?: PreloadedHighDensityRoute[]
  connMap?: {
    netMap: Record<string, string[]>
    idToNetMap: Record<string, string>
  }
}

const createCandidate = (
  original: HighDensityRoute[],
  proposed: HighDensityRoute[],
  routeIndexes: number[],
  node: NodeWithPortPoints,
): ForceImproveCandidate => ({
  node,
  routeIndexes,
  currentHdRoutes: original,
  originalRoutes: routeIndexes.map((index): HighDensityRoute => original[index]!),
  candidateRoutes: routeIndexes.map((index): HighDensityRoute => proposed[index]!),
})

const createWire = (
  name: string,
  y: number,
  z = 0,
): HighDensityRoute => ({
  connectionName: name,
  rootConnectionName: name,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0, y, z },
    { x: 1, y, z },
  ],
  vias: [],
})

const getMinimumCopperGap = (
  left: HighDensityRoute,
  rightRoutes: readonly HighDensityRoute[],
  srj: SimpleRouteJson,
): number => {
  let gap = Number.POSITIVE_INFINITY
  const leftGeometry = getPipeline9RouteCopperGeometry(left, srj)
  for (const right of rightRoutes) {
    const rightGeometry = getPipeline9RouteCopperGeometry(right, srj)
    for (const a of leftGeometry.wireSegments) {
      for (const b of rightGeometry.wireSegments) {
        if (a.z !== b.z) continue
        gap = Math.min(
          gap,
          minimumDistanceBetweenSegments(a.start, a.end, b.start, b.end) -
            a.width / 2 -
            b.width / 2,
        )
      }
    }
  }
  return gap
}

test(
  "Force admission protects current physical and retained copper before publication",
  (): void => {
    const fixture = JSON.parse(
      gunzipSync(
        new Uint8Array(
          readFileSync(
            new URL(
              "../fixtures/pipeline9-bug94-force-candidate.json.gz",
              import.meta.url,
            ),
          ),
        ),
      ).toString(),
    ) as RecordedFixture
    const connMap = getConnectivityMapFromSimpleRouteJson(fixture.originalSrj)
    const node = fixture.nodeWithPortPoints[0]!
    const original = structuredClone(fixture.hdRoutes)
    const unguarded = new HighDensityForceImproveSolver(fixture)
    unguarded.solve()
    expect(unguarded.solved).toBe(true)
    expect(unguarded.getOutput().slice(1)).toEqual(fixture.recordedCandidateRoutes)
    expect(doPipeline9RoutesHaveCopperConflict({
      left: fixture.hdRoutes[1]!,
      right: fixture.hdRoutes[2]!,
      clearance: 0,
      layerCount: 2,
    })).toBe(false)
    expect(doPipeline9RoutesHaveCopperConflict({
      left: unguarded.getOutput()[1]!,
      right: unguarded.getOutput()[2]!,
      clearance: 0,
      layerCount: 2,
    })).toBe(true)
    const admission = createPipeline9ForceCandidateAdmission({
      srj: fixture.originalSrj,
      connMap,
      physicalViaMode: true,
      currentFixedTraces: [],
    })
    if (!admission) throw new Error("Missing physical Force admission")
    const guarded = new HighDensityForceImproveSolver({
      ...fixture,
      candidateSolutionValidator: admission,
    })
    guarded.solve()
    expect(guarded.solved).toBe(true)
    expect(guarded.improvedRoutesByIndex.size).toBe(0)
    expect(guarded.getOutput()).toEqual(original)
    expect(guarded.stats.rejectedCandidateCount).toBe(1)
    expect(fixture.hdRoutes).toEqual(original)
    const inactive = createPipeline9ForceCandidateAdmission({
      srj: fixture.originalSrj,
      connMap,
      physicalViaMode: false,
      currentFixedTraces: [],
    })
    expect(inactive).toBe(false)
    const legacy = new HighDensityForceImproveSolver({
      ...fixture,
      candidateSolutionValidator: inactive,
    })
    legacy.solve()
    expect(legacy.getOutput()).toEqual(unguarded.getOutput())
    expect(legacy.getConstructorParams()).toEqual(unguarded.getConstructorParams())

    const clearSrj: SimpleRouteJson = { ...fixture.originalSrj, obstacles: [] }
    const simple = createPipeline9ForceCandidateAdmission({
      srj: clearSrj,
      connMap,
      physicalViaMode: true,
      currentFixedTraces: [],
    })
    if (!simple) throw new Error("Missing simple Force admission")
    const dirty = [
      createWire("source_trace_96", 0),
      createWire("source_trace_111", 0.1),
    ]
    const improved = [dirty[0]!, createWire("source_trace_111", 0.12)]
    const worse = [dirty[0]!, createWire("source_trace_111", 0.08)]
    expect(simple(createCandidate(dirty, dirty, [0, 1], node))).toBe(true)
    expect(simple(createCandidate(dirty, improved, [0, 1], node))).toBe(true)
    expect(simple(createCandidate(dirty, worse, [0, 1], node))).toBe(false)
    const changedTopology: HighDensityRoute = {
      ...dirty[1]!,
      route: [
        { x: 0, y: 0.1, z: 0 },
        { x: 0.5, y: 0.1, z: 0 },
        { x: 1, y: 0.1, z: 0 },
      ],
    }
    expect(
      simple(createCandidate(dirty, [dirty[0]!, changedTopology], [0, 1], node)),
    ).toBe(false)
    const clear = [dirty[0]!, createWire("source_trace_111", 0.2)]
    const closer = [dirty[0]!, createWire("source_trace_111", 0.16)]
    expect(simple(createCandidate(clear, closer, [0, 1], node))).toBe(true)
    expect(simple(createCandidate(clear, dirty, [0, 1], node))).toBe(false)
    const movedLeft = [createWire("source_trace_96", 0.07), clear[1]!]
    expect(simple(createCandidate(clear, movedLeft, [0], node))).toBe(false)
    const aliasMap = getConnectivityMapFromSimpleRouteJson(clearSrj)
    aliasMap.addConnections([["source_trace_96", "source_trace_111"]])
    const sameNet = createPipeline9ForceCandidateAdmission({
      srj: clearSrj,
      connMap: aliasMap,
      physicalViaMode: true,
      currentFixedTraces: [],
    })
    if (!sameNet) throw new Error("Missing alias Force admission")
    expect(sameNet(createCandidate(clear, dirty, [0, 1], node))).toBe(true)

    const holeSrj: SimpleRouteJson = {
      ...clearSrj,
      minTraceToHoleEdgeClearance: 0.2,
      obstacles: [
        {
          type: "rect",
          center: { x: 0.5, y: 0.5 },
          width: 0.2,
          height: 0.2,
          layers: ["top", "bottom"],
          connectedTo: [],
          isNonPlatedHole: true,
          shape: "circle",
          obstacleId: "npth_force_admission",
        },
      ],
    }
    const holes = createPipeline9ForceCandidateAdmission({
      srj: holeSrj,
      connMap,
      physicalViaMode: true,
      currentFixedTraces: [],
    })
    if (!holes) throw new Error("Missing NPTH Force admission")
    const oneWire = [createWire("source_trace_96", 0)]
    const towardHole = [createWire("source_trace_96", 0.2)]
    expect(holes(createCandidate(oneWire, towardHole, [0], node))).toBe(false)
    expect(holes(createCandidate(towardHole, towardHole, [0], node))).toBe(true)
    const awayFromHole = [createWire("source_trace_96", 0.18)]
    expect(holes(createCandidate(towardHole, awayFromHole, [0], node))).toBe(true)
    const worseHole = [createWire("source_trace_96", 0.22)]
    expect(holes(createCandidate(towardHole, worseHole, [0], node))).toBe(false)

    const via: HighDensityRoute = {
      connectionName: "source_trace_96",
      rootConnectionName: "source_trace_96",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0.5, y: 0.5, z: 0 },
        { x: 0.5, y: 0.5, z: 1 },
      ],
      vias: [{ x: 0.5, y: 0.5 }],
    }
    const viaInput = [via, createWire("source_trace_111", 0.2, 1)]
    const movedVia: HighDensityRoute = {
      ...via,
      route: [
        { x: 0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 1 },
      ],
      vias: [{ x: 0.5, y: 0 }],
    }
    expect(
      simple(createCandidate(viaInput, [movedVia, viaInput[1]!], [0], node)),
    ).toBe(false)
    const invalid = createCandidate(clear, clear, [0, 1], node)
    expect((): boolean => simple({ ...invalid, routeIndexes: [0, 0] })).toThrow(
      "index lineage",
    )
    expect((): boolean =>
      simple({ ...invalid, candidateRoutes: [clear[0]!] }),
    ).toThrow("index lineage")
    expect((): boolean => simple({
      ...invalid,
      candidateRoutes: [{ ...clear[0]!, connectionName: "wrong_owner" }, clear[1]!],
    })).toThrow("ownership or widths")
    expect((): boolean => simple({
      ...invalid,
      candidateRoutes: [{ ...clear[0]!, traceThickness: 0.01 }, clear[1]!],
    })).toThrow("ownership or widths")
    const dp = JSON.parse(
      gunzipSync(
        new Uint8Array(
          readFileSync(
            new URL(
              "../fixtures/pipeline9-direct-dp-force-candidate.json.gz",
              import.meta.url,
            ),
          ),
        ),
      ).toString(),
    ) as RecordedFixture
    if (!dp.connMap || !dp.recordedPublishedFixedRoutes) {
      throw new Error("Recorded DirectDP lacks its actual copper authority")
    }
    const dpMap = new ConnectivityMap(dp.connMap.netMap)
    expect(dpMap.idToNetMap).toEqual(dp.connMap.idToNetMap)
    expect(dpMap.getNetConnectedToId("source_net_28")).toBe("connectivity_net66")
    expect(dpMap.getNetConnectedToId("source_net_63")).toBe("connectivity_net6")
    const dpOriginal = structuredClone(dp.hdRoutes)
    const dpLegacy = new HighDensityForceImproveSolver(dp)
    dpLegacy.solve()
    expect(dpLegacy.solved).toBe(true)
    expect(dpLegacy.getOutput()).toEqual(dp.recordedCandidateRoutes)
    const retained28 = dp.recordedPublishedFixedRoutes.filter(
      (route): boolean => route.preloadedTraceIndex === 3,
    )
    expect(getMinimumCopperGap(dp.hdRoutes[3]!, retained28, dp.originalSrj))
      .toBeCloseTo(0.07915161611101496, 12)
    expect(
      getMinimumCopperGap(dpLegacy.getOutput()[3]!, retained28, dp.originalSrj),
    ).toBeCloseTo(-0.175, 12)
    // This is the recorded serialized publication geometry, not RAW getter
    // metadata: rebuilt trace positions cannot be mapped back to original Cu.
    const original28 = dp.originalSrj.traces![3]!
    const recordedFixedTrace: SimplifiedPcbTrace = {
      ...original28,
      route: retained28.flatMap((route): SimplifiedPcbTrace["route"] =>
        getPipeline9RouteCopperGeometry(route, dp.originalSrj).wireSegments.map(
          (wire): SimplifiedPcbTrace["route"][number] => ({
            route_type: "through_obstacle",
            from_layer: mapZToLayerName(wire.z, dp.originalSrj.layerCount),
            to_layer: mapZToLayerName(wire.z, dp.originalSrj.layerCount),
            start: wire.start,
            end: wire.end,
            width: wire.width,
          }),
        ),
      ),
    }
    const retained = createPipeline9ForceCandidateAdmission({
      srj: dp.originalSrj,
      connMap: dpMap,
      physicalViaMode: false,
      currentFixedTraces: [recordedFixedTrace],
      fixedOwnerByTraceId: new Map([
        [original28.pcb_trace_id, "connectivity_net66"],
      ]),
    })
    if (!retained) throw new Error("Missing actual retained Force admission")
    expect(retained(createCandidate(
      dp.hdRoutes,
      dp.hdRoutes,
      dp.hdRoutes.map((_, index): number => index),
      dp.nodeWithPortPoints[0]!,
    ))).toBe(true)
    const dpGuarded = new HighDensityForceImproveSolver({
      ...dp,
      candidateSolutionValidator: retained,
    })
    dpGuarded.solve()
    expect(dpGuarded.solved).toBe(true)
    expect(dpGuarded.stats.rejectedCandidateCount).toBe(1)
    expect(dpGuarded.improvedRoutesByIndex.size).toBe(0)
    expect(dpGuarded.getOutput()).toEqual(dpOriginal)
    expect(dp.hdRoutes).toEqual(dpOriginal)

    const originalFixedTrace: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "recorded_inline_fixed_copper",
      connection_name: "source_trace_96",
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
        { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.2 },
      ],
    }
    const fixedSrj: SimpleRouteJson = {
      ...clearSrj,
      traces: [originalFixedTrace],
    }
    const rawFixedRoutes = convertPreloadedTraceToHdRoutes(
      originalFixedTrace,
      0,
      fixedSrj.layerCount,
      0.3,
      connMap,
    )
    const rawReplacement = {
      ...rawFixedRoutes[0]!,
      traceThickness: 0.15,
    }
    const fixedSerializer = createPipeline9CopperAdmissionSerializer({
      srj: fixedSrj,
      connMap,
    })
    const publishedFixed = fixedSerializer.serialize([rawReplacement], new Set([0]))
    expect(publishedFixed[0]!.route[0]).toMatchObject({
      route_type: "through_obstacle",
      width: 0.2,
    })
    const declared = createPipeline9ForceCandidateAdmission({
      srj: fixedSrj,
      connMap,
      physicalViaMode: false,
      currentFixedTraces: publishedFixed,
      fixedOwnerByTraceId: fixedSerializer.canonicalOwnerByTraceId,
    })
    if (!declared) throw new Error("Missing declared retained Force admission")
    const declaredClear = [createWire("source_trace_111", 0.31)]
    const declaredDirty = [createWire("source_trace_111", 0.26)]
    const declaredImproved = [createWire("source_trace_111", 0.27)]
    const declaredWorse = [createWire("source_trace_111", 0.24)]
    expect(declared(createCandidate(declaredClear, declaredDirty, [0], node)))
      .toBe(false)
    expect(declared(createCandidate(declaredDirty, declaredDirty, [0], node)))
      .toBe(true)
    expect(declared(createCandidate(declaredDirty, declaredImproved, [0], node)))
      .toBe(true)
    expect(declared(createCandidate(declaredDirty, declaredWorse, [0], node)))
      .toBe(false)
    const unselectedForeign = [
      declaredClear[0]!,
      createWire("source_trace_96", 0.7),
    ]
    const intoUnselected = [
      createWire("source_trace_111", 0.65),
      unselectedForeign[1]!,
    ]
    const declaredPeers = createPipeline9ForceCandidateAdmission({
      srj: fixedSrj,
      connMap,
      physicalViaMode: false,
      currentFixedTraces: publishedFixed,
      fixedOwnerByTraceId: fixedSerializer.canonicalOwnerByTraceId,
    })
    if (!declaredPeers) throw new Error("Missing current peer Force admission")
    expect(
      declaredPeers(createCandidate(unselectedForeign, intoUnselected, [0], node)),
    ).toBe(false)
    expect((): boolean => declared(createCandidate(
      unselectedForeign,
      intoUnselected,
      [0],
      node,
    ))).toThrow("current board route count")

    const originalViaTrace: SimplifiedPcbTrace = {
      ...originalFixedTrace,
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
        { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.3 },
        {
          route_type: "via",
          x: 1,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          layers: ["top", "inner1"],
          via_diameter: 0.6,
          via_hole_diameter: 0.4,
        },
        { route_type: "wire", x: 1, y: 0, layer: "inner1", width: 0.25 },
        { route_type: "wire", x: 2, y: 0, layer: "inner1", width: 0.25 },
        {
          route_type: "through_obstacle",
          from_layer: "inner1",
          to_layer: "top",
          start: { x: 2, y: 0 },
          end: { x: 2.1, y: 0 },
          width: 0.4,
        },
        { route_type: "wire", x: 2.1, y: 0, layer: "top", width: 0.2 },
        {
          route_type: "via",
          x: 2.1,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          layers: ["top", "inner1"],
          via_diameter: 0.5,
          via_hole_diameter: 0.3,
        },
        { route_type: "wire", x: 2.1, y: 0, layer: "inner1", width: 0.2 },
        { route_type: "wire", x: 3, y: 0, layer: "inner1", width: 0.2 },
      ],
    }
    const fourLayerSrj: SimpleRouteJson = {
      ...fixedSrj,
      layerCount: 4,
      allowBlindAndBuriedVias: true,
      traces: [originalViaTrace],
    }
    const rawViaRoutes = convertPreloadedTraceToHdRoutes(
      originalViaTrace,
      0,
      4,
      0.3,
      connMap,
    )
    const viaSerializer = createPipeline9CopperAdmissionSerializer({
      srj: fourLayerSrj,
      connMap,
    })
    const untouched = viaSerializer.serialize(rawViaRoutes)[0]!
    expect(untouched.route[0]).toMatchObject({ width: 0.2 })
    expect(untouched.route.filter((point): boolean => point.route_type === "via"))
      .toMatchObject([
        { via_diameter: 0.6, via_hole_diameter: 0.4, layers: ["top", "inner1"] },
        { via_diameter: 0.5, via_hole_diameter: 0.3, layers: ["top", "inner1"] },
      ])
    const rebuilt = viaSerializer.serialize(rawViaRoutes, new Set([0]))[0]!
    expect(rebuilt.route[0]).toMatchObject({ width: 0.4 })
    expect(rebuilt.route.filter((point): boolean => point.route_type === "via"))
      .toMatchObject([
        { via_diameter: 0.6, via_hole_diameter: 0.2 },
        { via_diameter: 0.5, via_hole_diameter: 0.2 },
      ])
    const widthOverride = {
      ...rawViaRoutes[0]!,
      route: [
        { ...rawViaRoutes[0]!.route[0]!, traceThickness: 0.17 },
        { ...rawViaRoutes[0]!.route[1]!, traceThickness: 0.19 },
      ],
    }
    expect(viaSerializer.serialize([widthOverride], new Set([0]))[0]!.route[0])
      .toMatchObject({ width: 0.17 })
    expect((): SimplifiedPcbTrace[] => viaSerializer.serialize([{
      ...rawViaRoutes.find((route): boolean => route.vias.length > 0)!,
      preloadedRoutePositionStart: 0,
      preloadedRoutePositionEnd: 0,
    } as PreloadedHighDensityRoute])).toThrow("indexed original physical identity")
    const firstVia = untouched.route.find(
      (point): boolean => point.route_type === "via",
    )!
    const viaCopper: SimplifiedPcbTrace = { ...untouched, route: [firstVia] }
    const blind = createPipeline9ForceCandidateAdmission({
      srj: fourLayerSrj,
      connMap,
      physicalViaMode: false,
      currentFixedTraces: [viaCopper],
      fixedOwnerByTraceId: viaSerializer.canonicalOwnerByTraceId,
    })
    const through = createPipeline9ForceCandidateAdmission({
      srj: { ...fourLayerSrj, allowBlindAndBuriedVias: false },
      connMap,
      physicalViaMode: false,
      currentFixedTraces: [viaCopper],
      fixedOwnerByTraceId: viaSerializer.canonicalOwnerByTraceId,
    })
    if (!blind || !through) throw new Error("Missing actual via-span admission")
    const bottomSafe = [createWire("source_trace_111", 0.6, 3)]
    const bottomConflict = [createWire("source_trace_111", 0.39, 3)]
    expect(blind(createCandidate(bottomSafe, bottomConflict, [0], node))).toBe(true)
    expect(through(createCandidate(bottomSafe, bottomConflict, [0], node))).toBe(
      false,
    )

    const drill = createPipeline9ForceCandidateAdmission({
      srj: { ...fourLayerSrj, minViaHoleEdgeToViaHoleEdgeClearance: 0.3 },
      connMap,
      physicalViaMode: false,
      currentFixedTraces: [viaCopper],
      fixedOwnerByTraceId: viaSerializer.canonicalOwnerByTraceId,
    })
    if (!drill) throw new Error("Missing original per-via drill admission")
    const movingDrill: HighDensityRoute = {
      ...via,
      connectionName: "source_trace_111",
      rootConnectionName: "source_trace_111",
      route: [
        { x: 1.75, y: 0, z: 0 },
        { x: 1.75, y: 0, z: 1 },
      ],
      vias: [{ x: 1.75, y: 0 }],
    }
    const worseDrill: HighDensityRoute = {
      ...movingDrill,
      route: [
        { x: 1.58, y: 0, z: 0 },
        { x: 1.58, y: 0, z: 1 },
      ],
      vias: [{ x: 1.58, y: 0 }],
    }
    expect(drill(createCandidate([movingDrill], [worseDrill], [0], node)))
      .toBe(false)
    const collisionMap = new ConnectivityMap({
      connectivity_net0: ["source_trace_96"],
      connectivity_net1: ["source_trace_111", "connectivity_net0"],
    })
    const collision = createPipeline9ForceCandidateAdmission({
      srj: clearSrj,
      connMap: collisionMap,
      physicalViaMode: true,
      currentFixedTraces: [],
    })
    if (!collision) throw new Error("Missing canonical collision admission")
    const collisionInput = [
      { ...clear[0]!, rootConnectionName: "connectivity_net0" },
      { ...clear[1]!, rootConnectionName: "connectivity_net1" },
    ]
    const collisionProposal = [
      collisionInput[0]!,
      { ...dirty[1]!, rootConnectionName: "connectivity_net1" },
    ]
    expect(
      collision(createCandidate(collisionInput, collisionProposal, [0, 1], node)),
    ).toBe(false)
    expect(
      (): ReturnType<typeof createPipeline9ForceCandidateAdmission> =>
        createPipeline9ForceCandidateAdmission({
          srj: fixedSrj,
          connMap,
          physicalViaMode: false,
          currentFixedTraces: publishedFixed,
        }),
    ).toThrow("authoritative ownership")

    expect(fixture.hdRoutes).toEqual(original)
  },
)
