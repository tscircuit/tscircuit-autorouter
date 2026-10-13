import { expect, test } from "bun:test"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createImmutableCopperCandidateAdmission } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createImmutableCopperCandidateAdmission"
import { createPipeline9CopperAdmissionSerializer } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9CopperAdmissionSerializer"
import { createPipeline9RegionalCandidateAdmission } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RegionalCandidateAdmission"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import input from "../fixtures/bug-reports/usb-dp-phase-detour/input.json"

test(
  "regional publication rejects the recorded foreign wire and SMT contacts",
  (): void => {
    const srj = structuredClone(input) as SimpleRouteJson
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)
    const net27 = srj.traces!.find(
      (trace): boolean => trace.pcb_trace_id === "source_net_27_mst0_0",
    )!
    const net28 = srj.traces!.find(
      (trace): boolean => trace.pcb_trace_id === "source_net_28_mst1_0",
    )!
    const pad = srj.obstacles.find(
      (obstacle): boolean =>
        obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_47",
    )!
    expect(pad.center).toEqual({ x: -39.01068099999999, y: 20.915975000000003 })
    expect([pad.width, pad.height, pad.layers]).toEqual([1.2, 1.4, ["top"]])
    expect(connMap.getNetConnectedToId(net27.connection_name)).not.toBe(
      connMap.getNetConnectedToId(pad.connectedTo[0]!),
    )
    const recordedPadContact: SimplifiedPcbTrace = {
      ...net27,
      route: [
        {
          route_type: "wire",
          x: -38.15446388439999,
          y: 21.045,
          width: 0.2,
          layer: "top",
        },
        {
          route_type: "wire",
          x: -39.37984892766787,
          y: 21.812360572332132,
          width: 0.2,
          layer: "top",
        },
      ],
    }
    const padCorners = [
      { x: pad.center.x - pad.width / 2, y: pad.center.y - pad.height / 2 },
      { x: pad.center.x + pad.width / 2, y: pad.center.y - pad.height / 2 },
      { x: pad.center.x + pad.width / 2, y: pad.center.y + pad.height / 2 },
      { x: pad.center.x - pad.width / 2, y: pad.center.y + pad.height / 2 },
    ]
    expect(
      Math.min(
        ...padCorners.map((point, index): number =>
          minimumDistanceBetweenSegments(
            recordedPadContact.route[0] as { x: number; y: number },
            recordedPadContact.route[1] as { x: number; y: number },
            point,
            padCorners[(index + 1) % padCorners.length]!,
          ),
        ),
      ) - 0.1,
    ).toBeCloseTo(-0.1, 12)
    const roundPad = srj.obstacles.find(
      (obstacle): boolean => String(obstacle.type) === "oval",
    )!
    expect([roundPad.width, roundPad.height, roundPad.layers]).toEqual([
      2,
      2,
      ["top", "bottom"],
    ])
    expect(connMap.getNetConnectedToId(net27.connection_name)).not.toBe(
      connMap.getNetConnectedToId(roundPad.connectedTo[0]!),
    )
    const roundCorner: SimplifiedPcbTrace = {
      ...net27,
      route: [
        {
          route_type: "wire",
          x: roundPad.center.x + 0.9,
          y: roundPad.center.y + 0.9,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          x: roundPad.center.x + 0.95,
          y: roundPad.center.y + 0.9,
          width: 0.1,
          layer: "top",
        },
      ],
    }
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [],
        boardObstacles: [roundPad],
      })([roundCorner]),
    ).toBeTrue()
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [],
        boardObstacles: [{ ...roundPad, type: "rect" }],
      })([roundCorner]),
    ).toBeFalse()
    const padAdmission = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [net27],
      immutableTraces: [],
      boardObstacles: [pad],
    })
    expect(padAdmission([net27])).toBeTrue()
    expect(padAdmission([recordedPadContact])).toBeFalse()
    const ownPad = { ...pad, connectedTo: [net27.connection_name] }
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [],
        boardObstacles: [ownPad],
      })([recordedPadContact]),
    ).toBeTrue()
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [],
        boardObstacles: [{ ...pad, layers: ["bottom"] }],
      })([recordedPadContact]),
    ).toBeTrue()

    const recordedForeignContact: SimplifiedPcbTrace = {
      ...net28,
      route: [
        {
          route_type: "wire",
          x: -33.93094317994347,
          y: 22.88,
          width: 0.2,
          layer: "top",
        },
        {
          route_type: "wire",
          x: -33.62023623531568,
          y: 22.849213310468564,
          width: 0.2,
          layer: "top",
        },
      ],
    }
    const peer: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "recorded-source-net-63-segment",
      connection_name: "source_net_63",
      route: [
        {
          route_type: "wire",
          x: -33.662,
          y: 22.87,
          width: 0.15,
          layer: "top",
        },
        {
          route_type: "wire",
          x: -33.289,
          y: 22.593,
          width: 0.15,
          layer: "top",
        },
      ],
    }
    expect(
      minimumDistanceBetweenSegments(
        recordedForeignContact.route[0] as { x: number; y: number },
        recordedForeignContact.route[1] as { x: number; y: number },
        peer.route[0] as { x: number; y: number },
        peer.route[1] as { x: number; y: number },
      ) -
        0.1 -
        0.075,
    ).toBeCloseTo(-0.175, 12)
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [net28],
        immutableTraces: [peer],
      })([recordedForeignContact]),
    ).toBeFalse()
    const candidatePeers = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [net28],
      immutableTraces: [],
      includeMovableCopper: true,
    })
    expect(candidatePeers([recordedForeignContact, peer], false)).toBeTrue()
    expect(candidatePeers([recordedForeignContact, peer])).toBeFalse()
    const stagePeers = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [net28],
      immutableTraces: [],
      peerTraces: [peer],
      includeMovableCopper: true,
    })
    expect(stagePeers([recordedForeignContact], false)).toBeTrue()
    expect(stagePeers([recordedForeignContact])).toBeFalse()
    const generatedOnly = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [],
      immutableTraces: [],
      peerTraces: [peer],
      includeMovableCopper: true,
      generatedTraceIds: new Set([
        recordedForeignContact.pcb_trace_id,
        peer.pcb_trace_id,
      ]),
    })
    expect(generatedOnly([recordedForeignContact])).toBeTrue()
    const retainedAgainstPeer = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [net28],
      immutableTraces: [],
      peerTraces: [peer],
      includeMovableCopper: true,
      generatedTraceIds: new Set([peer.pcb_trace_id]),
    })
    expect(retainedAgainstPeer([recordedForeignContact])).toBeFalse()
    const actualVia = net28.route[7]!
    if (actualVia.route_type !== "via")
      throw new Error("Expected the indexed native original barrel")
    const platedBarrel: SimplifiedPcbTrace = { ...net28, route: [actualVia] }
    const wireNearPlatedDrill: SimplifiedPcbTrace = {
      ...net27,
      route: [
        {
          route_type: "wire",
          x: actualVia.x + 0.335,
          y: actualVia.y - 0.05,
          width: 0.15,
          layer: "top",
        },
        {
          route_type: "wire",
          x: actualVia.x + 0.335,
          y: actualVia.y + 0.05,
          width: 0.15,
          layer: "top",
        },
      ],
    }
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [platedBarrel],
      })([wireNearPlatedDrill]),
    ).toBeTrue()
    const npth = srj.obstacles.find(
      (obstacle): boolean => obstacle.obstacleId === "pcb_hole_7",
    )!
    const wireNearNpth: SimplifiedPcbTrace = {
      ...net27,
      route: [
        {
          route_type: "wire",
          x: npth.center.x + 0.825,
          y: npth.center.y - 0.05,
          width: 0.15,
          layer: "top",
        },
        {
          route_type: "wire",
          x: npth.center.x + 0.825,
          y: npth.center.y + 0.05,
          width: 0.15,
          layer: "top",
        },
      ],
    }
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [],
        boardObstacles: [npth],
      })([wireNearNpth]),
    ).toBeFalse()
    const viaNearNpth: SimplifiedPcbTrace = {
      ...net28,
      route: [{ ...actualVia, x: npth.center.x + 0.9, y: npth.center.y }],
    }
    expect(
      createImmutableCopperCandidateAdmission({
        srj,
        connMap,
        initialMovableTraces: [],
        immutableTraces: [],
        boardObstacles: [npth],
      })([viaNearNpth]),
    ).toBeTrue()
    const dirty = createImmutableCopperCandidateAdmission({
      srj,
      connMap,
      initialMovableTraces: [recordedPadContact],
      immutableTraces: [],
      boardObstacles: [pad],
    })
    expect(dirty([recordedPadContact])).toBeTrue()
    const unrelated = {
      route_type: "through_obstacle" as const,
      start: { x: 10, y: 10 },
      end: { x: 11, y: 10 },
      from_layer: "bottom",
      to_layer: "bottom",
      width: 0.2,
    }
    expect(
      dirty([
        {
          ...recordedPadContact,
          route: [unrelated, ...recordedPadContact.route],
        },
      ]),
    ).toBeTrue()
    expect(
      dirty([
        {
          ...recordedPadContact,
          route: recordedPadContact.route.map((point) => ({
            ...point,
            width: 0.4,
          })),
        },
      ]),
    ).toBeFalse()

    const fixed = srj.traces!.flatMap((trace, index) =>
      convertPreloadedTraceToHdRoutes(trace, index, srj.layerCount, 0.3, connMap),
    )
    const serializer = createPipeline9CopperAdmissionSerializer({ srj, connMap })
    const nativeViaRoute = fixed.find(
      (route): boolean =>
        route.preloadedTraceIndex === 3 &&
        route.preloadedRoutePositionStart === 7 &&
        route.preloadedRoutePositionEnd === 7,
    )!
    expect(serializer.serialize([nativeViaRoute])[0]!.route[0]).toMatchObject(
      actualVia,
    )
    const mismatchedVia: typeof nativeViaRoute = {
      ...nativeViaRoute,
      preloadedRoutePositionStart: 8,
      preloadedRoutePositionEnd: 8,
    }
    expect(() => serializer.serialize([mismatchedVia])).toThrow(
      "indexed original physical identity",
    )
    const widthRoute: HighDensityRoute = {
      connectionName: "source_net_63",
      rootConnectionName: "source_net_63",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, traceThickness: 0.1 },
        { x: 1, y: 0, z: 0, traceThickness: 0.7 },
      ],
      vias: [],
    }
    const projectedWidth = serializer.serialize([widthRoute])[0]!.route[0]!
    expect(projectedWidth.route_type).toBe("through_obstacle")
    if (projectedWidth.route_type !== "through_obstacle")
      throw new Error("Expected one independent copper segment")
    expect(projectedWidth.width).toBe(0.1)
    const canonicalGeneratedOwner = connMap.getNetConnectedToId(
      widthRoute.connectionName,
    )!
    const generatedCollision = getConnectivityMapFromSimpleRouteJson(srj)
    generatedCollision.idToNetMap[canonicalGeneratedOwner] =
      connMap.getNetConnectedToId(net27.connection_name)!
    const canonicalSerializer = createPipeline9CopperAdmissionSerializer({
      srj,
      connMap: generatedCollision,
    })
    const canonicalRoute = canonicalSerializer.serialize([
      {
        ...widthRoute,
        connectionName: canonicalGeneratedOwner,
        rootConnectionName: canonicalGeneratedOwner,
      },
    ])[0]!
    expect(
      canonicalSerializer.canonicalOwnerByTraceId.get(canonicalRoute.pcb_trace_id),
    ).toBe(canonicalGeneratedOwner)
    const ownFixed = fixed.filter(
      (route): boolean => route.preloadedTraceIndex === 4,
    )
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: "recorded-contact-check",
      center: { x: -37, y: 20 },
      width: 30,
      height: 30,
      availableZ: [0, 1],
      portPoints: [],
    }
    const problem = createRegionalFallbackProblem(node, ownFixed)
    const [sectionName, section] = [
      ...problem.fixedRouteSectionsByConnectionName,
    ][0]!
    expect(section).toBeDefined()
    const replacement: HighDensityRoute = {
      ...section.sourceRoutes[0]!,
      connectionName: sectionName,
      route: [
        section.start.point,
        ...recordedPadContact.route.map((point) => ({
          x: (point as { x: number }).x,
          y: (point as { y: number }).y,
          z: 0,
        })),
        section.end.point,
      ],
      traceThickness: 0.15,
      vias: [],
    }
    const original = JSON.stringify({ srj, fixed, section, replacement })
    const regional = createPipeline9RegionalCandidateAdmission({
      srj,
      connMap,
      currentFixedRoutes: fixed,
      acceptedRoutes: [],
      sections: problem.fixedRouteSectionsByConnectionName,
      sourceMutationMasks: new Map(),
    })
    expect(regional([replacement], false)).toBeFalse()
    expect(regional([replacement])).toBeFalse()
    expect(regional([])).toBeTrue()
    const collisionMap = getConnectivityMapFromSimpleRouteJson(srj)
    const canonicalOwner = collisionMap.getNetConnectedToId(
      net27.connection_name,
    )!
    const foreignOwner = collisionMap.getNetConnectedToId(pad.connectedTo[0]!)!
    collisionMap.idToNetMap[canonicalOwner] = foreignOwner
    expect(collisionMap.getNetConnectedToId(canonicalOwner)).toBe(foreignOwner)
    expect(
      createPipeline9RegionalCandidateAdmission({
        srj,
        connMap: collisionMap,
        currentFixedRoutes: fixed,
        acceptedRoutes: [],
        sections: problem.fixedRouteSectionsByConnectionName,
        sourceMutationMasks: new Map(),
      })([replacement]),
    ).toBeFalse()
    expect(JSON.stringify({ srj, fixed, section, replacement })).toBe(original)
  },
)
