import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  type DrcEvaluator,
  type NativeDrcSceneInput,
  PreparedNativeDrcScene,
} from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import type { ClearanceMarginDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearancePrecisionRepairs"
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"
import { getPipeline9ClearanceMarginErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ClearanceMarginErrors"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import {
  addAutoroutingViaTraceIds,
  Pipeline9JointDrcRepairSolver,
  remapDrcTraceIds,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import {
  type CircuitJsonNativeDrcPreparationContext,
  convertToCircuitJson,
  createNativeDrcInputPreparer,
} from "lib/testing/utils/convertToCircuitJson"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type ReferenceSolverInternals = {
  cachedReferenceDrcEvaluator: DrcEvaluator
  clearanceMarginDrcEvaluator: ClearanceMarginDrcEvaluator
  referenceDrcValidationCount: number
}

const getFixture = (
  withPreloads: boolean,
): { srj: SimpleRouteJson; routes: HighDensityRoute[] } => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "owner",
      rootConnectionName: "via_0",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
        { x: 0, y: 2, z: 1 },
        { x: 1, y: 2, z: 1 },
        { x: 0, y: 4, z: 1 },
        { x: 0, y: 4, z: 0 },
        { x: 1, y: 4, z: 0 },
      ],
      vias: [
        { x: 0, y: 2 },
        { x: 0, y: 4 },
      ],
    },
    {
      connectionName: "coincident_owner",
      traceThickness: 0.1,
      viaDiameter: 0.4,
      route: [
        { x: -1, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
        { x: 0, y: 4, z: 1 },
        { x: 1, y: 4, z: 1 },
      ],
      vias: [{ x: 0, y: 4 }],
    },
  ]
  const preloaded: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "horizontal_0",
    connection_name: "preloaded",
    route: [
      { route_type: "wire", x: 4, y: 4, layer: "top", width: 0.1 },
      {
        route_type: "via",
        x: 4,
        y: 4,
        from_layer: "top",
        to_layer: "inner1",
      },
      { route_type: "wire", x: 4, y: 4, layer: "inner1", width: 0.1 },
      { route_type: "wire", x: 5, y: 4, layer: "inner1", width: 0.1 },
    ],
  }
  const aliasPad: Obstacle = {
    type: "rect",
    center: { x: 5, y: -5 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["foreign"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "alias_pad",
      pcb_port_id: "old_declared_alias",
    },
  }
  return {
    routes,
    srj: {
      layerCount: 4,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      minViaHoleDiameter: 0.15,
      bounds: { minX: -8, minY: -8, maxX: 8, maxY: 8 },
      obstacles: [aliasPad],
      connections: routes.map(
        (route): SimpleRouteJson["connections"][number] => ({
          name: route.connectionName,
          ...(route.rootConnectionName
            ? { __netConnectionName: route.rootConnectionName }
            : {}),
          pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
            (
              point,
              index,
            ): SimpleRouteJson["connections"][number]["pointsToConnect"][number] => ({
              x: point.x,
              y: point.y,
              layer: point.z === 0 ? "top" : "inner1",
              pcb_port_id: `${route.connectionName}_${index}`,
            }),
          ),
        }),
      ),
      traces: withPreloads
        ? [
            preloaded,
            {
              ...preloaded,
              connection_name: "duplicate_preloaded",
              route: [
                { route_type: "wire", x: 4, y: 6, layer: "top", width: 0.1 },
                { route_type: "wire", x: 5, y: 6, layer: "top", width: 0.1 },
              ],
            },
          ]
        : [],
    },
  }
}

const getRoutedTraces = (
  solver: Pipeline9JointDrcRepairSolver,
  routes: HighDensityRoute[],
): SimplifiedPcbTrace[] =>
  assignUniquePcbTraceIdsToNewTraces(
    convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.params.newConnections,
      originalConnections: solver.params.originalSrj.connections,
      hdRoutes: routes,
      layerCount: solver.params.layerCount,
      obstacles: solver.params.obstacles,
      defaultViaHoleDiameter: solver.params.defaultViaHoleDiameter,
      connMap: solver.params.connMap,
    }),
    solver.params.originalSrj.traces ?? [],
  )

const getLegacyReference = (
  solver: Pipeline9JointDrcRepairSolver,
  routes: HighDensityRoute[],
): ReturnType<DrcEvaluator> => {
  const routedTraces = getRoutedTraces(solver, routes)
  const srj = solver.params.originalSrj
  const baseline = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [],
    includeBoardClearance: true,
  })
  const candidate = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces,
    includeBoardClearance: true,
  })
  const baselineIds = new Set(
    (srj.traces ?? []).map((trace) => trace.pcb_trace_id),
  )
  const candidateIds = new Set([
    ...baselineIds,
    ...routedTraces.map((trace) => trace.pcb_trace_id),
  ])
  const remapping = new Map(
    routedTraces.map((trace, index) => [
      trace.pcb_trace_id,
      `${routes[index]!.connectionName}_0`,
    ]),
  )
  const normalize = (
    errors: Array<Record<string, unknown>>,
    baselineErrors: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> =>
    normalizePipeline9DrcErrorsForRepair({
      errors: remapDrcTraceIds(
        filterPipeline9DrcErrorsAgainstBaseline({
          errors: addAutoroutingViaTraceIds({
            errors,
            circuitJson: candidate.circuitJson,
            evaluatedTraceIds: candidateIds,
          }),
          baselineErrors: addAutoroutingViaTraceIds({
            errors: baselineErrors,
            circuitJson: baseline.circuitJson,
            evaluatedTraceIds: baselineIds,
          }),
          originalTraceIdByPreparedTraceId: new Map(),
        }),
        remapping,
      ),
      circuitJson: candidate.circuitJson.map(
        (element): AnyCircuitElement =>
          "pcb_trace_id" in element && typeof element.pcb_trace_id === "string"
            ? {
                ...element,
                pcb_trace_id:
                  remapping.get(element.pcb_trace_id) ?? element.pcb_trace_id,
              }
            : element,
      ),
      newTraceIds: new Set(remapping.values()),
    })
  return {
    errors: normalize(
      candidate.errors as unknown as Array<Record<string, unknown>>,
      baseline.errors as unknown as Array<Record<string, unknown>>,
    ),
    errorsWithCenters: normalize(
      candidate.errorsWithCenters as unknown as Array<Record<string, unknown>>,
      baseline.errorsWithCenters as unknown as Array<Record<string, unknown>>,
    ),
  }
}

test("Pipeline9 native reference preserves ordered errors, aliases, cache and margins", (): void => {
  for (const [withPreloads, allowBlind, layerCount, emptyTraceId] of [
    [false, false, 4, false],
    [true, false, 4, false],
    [false, true, 4, false],
    [true, true, 4, false],
    [false, false, 11, false],
    [true, false, 4, true],
  ] as const) {
    const { srj, routes } = getFixture(withPreloads)
    srj.layerCount = layerCount
    srj.allowBlindAndBuriedVias = allowBlind
    if (emptyTraceId) srj.traces![0]!.pcb_trace_id = ""
    const emptyTraceLogicalNets: Array<string | undefined> = []
    const originalPrepare = PreparedNativeDrcScene.prototype.prepare
    if (emptyTraceId) {
      PreparedNativeDrcScene.prototype.prepare = function (
        this: PreparedNativeDrcScene,
        traces: Parameters<typeof originalPrepare>[0],
        options: Parameters<typeof originalPrepare>[1],
      ): ReturnType<typeof originalPrepare> {
        const evaluation = originalPrepare.call(this, traces, options)
        emptyTraceLogicalNets.push(
          evaluation.scene.connectivity.getNetConnectedToId(""),
        )
        return evaluation
      }
    }
    let solver: Pipeline9JointDrcRepairSolver
    try {
      solver = new Pipeline9JointDrcRepairSolver({
        srj,
        srjWithPointPairs: srj,
        originalSrj: srj,
        newConnections: srj.connections,
        newHdRoutes: routes,
        updatedPreloadedTraces: [],
        mutatedPreloadedTraceIds: new Set(),
        connMap: getConnectivityMapFromSimpleRouteJson(srj),
        obstacles: srj.obstacles,
        layerCount: srj.layerCount,
        defaultViaDiameter: 0.3,
        defaultViaHoleDiameter: 0.15,
        effort: 1,
        colorMap: {},
      })
    } finally {
      PreparedNativeDrcScene.prototype.prepare = originalPrepare
    }
    if (emptyTraceId) {
      const originalLogical = getFullConnectivityMapFromCircuitJson(
        convertToCircuitJson(srj, srj.traces!, {
          originalSrj: srj,
          includeOriginalConnections: true,
        }),
      )
      expect(emptyTraceLogicalNets.length).toBeGreaterThan(0)
      for (const net of emptyTraceLogicalNets) {
        expect(net).toBe(originalLogical.getNetConnectedToId(""))
      }
    }
    expect(solver.exactRepairSolver).toBeDefined()
    expect(solver.stats.exactRepairConfiguredMaxIterations).toBe(32)
    expect(solver.stats.exactRepairConfiguredBroadMaxIterations).toBe(12)
    expect(solver.movablePreloadedSections).toHaveLength(0)
    const internals = solver as unknown as ReferenceSolverInternals
    for (let seed = 0; seed < 8; seed++) {
      const candidate = structuredClone(routes)
      for (const point of candidate[1]!.route) point.x += seed / 16
      if (seed % 2) {
        candidate[0]!.route.splice(1, 0, { x: 0, y: 0.02 * seed, z: 0 })
      }
      const expected = getLegacyReference(solver, candidate)
      const result = internals.cachedReferenceDrcEvaluator({
        traces: [],
        routes: candidate,
      })
      expect(result).toEqual(expected)
      const count = internals.referenceDrcValidationCount
      expect(
        internals.cachedReferenceDrcEvaluator({
          traces: [],
          routes: structuredClone(candidate),
        }),
      ).toBe(result)
      expect(internals.referenceDrcValidationCount).toBe(count)
    }
    let preparedContext: CircuitJsonNativeDrcPreparationContext | undefined
    const initialCircuit = convertToCircuitJson(srj, srj.traces ?? [], {
      originalSrj: srj,
      includeOriginalConnections: true,
      onPreparedNativeDrcContext: (context): void => {
        preparedContext = context
      },
    })
    expect(initialCircuit.length).toBeGreaterThan(0)
    if (!preparedContext) throw new Error("Missing boundary source context")
    const prepareInput = createNativeDrcInputPreparer({
      originalSrj: srj,
      srjWithPointPairs: srj,
      preparedContext,
    })
    const aliasTrace: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "candidate_alias",
      connection_name: "unknown_alias",
      connectsTo: ["old_declared_alias", "new_external_net"],
      route: [
        { route_type: "wire", x: 4.8, y: -5, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 5,
          y: -5,
          from_layer: "unsupported" as "top",
          to_layer: "bottom",
        },
        {
          route_type: "via",
          x: 5.5,
          y: -5,
          from_layer: "top",
          to_layer: "inner1",
        },
        { route_type: "wire", x: 6, y: -5, width: 0.1, layer: "inner1" },
      ],
    }
    const input = prepareInput([aliasTrace])
    const converted = convertToCircuitJson(srj, [aliasTrace], {
      originalSrj: srj,
      includeOriginalConnections: true,
    })
    expect(input.sourceTraces).toEqual(
      converted.flatMap((element) =>
        element.type === "source_trace"
          ? [
              {
                id: element.source_trace_id,
                portIds: element.connected_source_port_ids,
                netIds: element.connected_source_net_ids,
              },
            ]
          : [],
      ),
    )
    const convertedTrace = converted.find(
      (element) => element.type === "pcb_trace",
    )
    if (!convertedTrace || convertedTrace.type !== "pcb_trace") {
      throw new Error("Missing converted candidate trace")
    }
    expect<string | undefined>(input.traces[0]!.source_trace_id).toBe(
      convertedTrace.source_trace_id,
    )
    const admissionScene = new PreparedNativeDrcScene({
      pads: [],
      holes: [],
      ports: [],
      sourceTraces: input.sourceTraces,
      connectivity: getFullConnectivityMapFromCircuitJson(converted),
      createConnectivity: (
        _sources,
        _traces,
        viaOwnerLinks,
      ): ReturnType<NativeDrcSceneInput["createConnectivity"]> => {
        const logical = getFullConnectivityMapFromCircuitJson(converted)
        const clearance = getFullConnectivityMapFromCircuitJson(converted)
        clearance.addConnections(viaOwnerLinks)
        return { logical, clearance }
      },
      layerCount: srj.layerCount,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      allowBlindAndBuriedVias: allowBlind,
      traceClearance: 0.1,
      viaHoleClearance: 0.1,
      holeClearance: 0.2,
    })
    const admitted = admissionScene.prepare(input.traces)
    expect<unknown>(
      admitted.vias.map((via) => ({
        id: via.id,
        owner: via.traceId,
        x: via.x,
        y: via.y,
        diameter: via.diameter,
        hole: via.holeDiameter,
        layers: via.layers,
      })),
    ).toEqual(
      converted.flatMap((element) =>
        element.type === "pcb_via"
          ? [
              {
                id: element.pcb_via_id,
                owner: element.pcb_trace_id,
                x: element.x,
                y: element.y,
                diameter: element.outer_diameter,
                hole: element.hole_diameter,
                layers: element.layers,
              },
            ]
          : [],
      ),
    )
    expect(admitted.vias).toHaveLength(1)
    expect(admitted.vias[0]!.id).toBe("via_0")

    for (const [viaId, y, copperRadius] of [
      ["via_0", 2, 0.15],
      ["via_1", 4, 0.2],
    ] as const) {
      const marginRoutes = structuredClone(routes)
      for (const point of marginRoutes[0]!.route) {
        point.y = y + copperRadius + 0.05 + 0.0995
      }
      const originalMarginCircuit = convertToCircuitJson(
        srj,
        getRoutedTraces(solver, marginRoutes),
        {
          minViaDiameter: 0.3,
          originalSrj: srj,
          includeOriginalConnections: true,
        },
      )
      const targets = [
        {
          type: "pcb_via_trace_clearance_error",
          pcb_trace_id: getRoutedTraces(solver, marginRoutes)[0]!.pcb_trace_id,
          pcb_via_id: viaId,
          minimum_clearance: 0.1,
          actual_clearance: 0.089,
        },
      ]
      for (const gap of [0.08, 0.0995, 0.11, 0.12, -0.01, "dedupe"] as const) {
        const candidate = structuredClone(marginRoutes)
        for (const point of candidate[0]!.route) {
          point.y = y + copperRadius + 0.05 + (gap === "dedupe" ? 0.08 : gap)
        }
        if (gap === "dedupe") {
          candidate[2]!.route[1]!.y = 4
          candidate[2]!.route[2]!.y = 4
          candidate[2]!.vias[0]!.y = 4
        }
        const expected = getPipeline9ClearanceMarginErrors({
          originalCircuitJson: originalMarginCircuit,
          circuitJson: convertToCircuitJson(
            srj,
            getRoutedTraces(solver, candidate),
            {
              minViaDiameter: 0.3,
              originalSrj: srj,
              includeOriginalConnections: true,
            },
          ),
          targets,
        })
        expect(
          internals.clearanceMarginDrcEvaluator(
            candidate,
            targets,
            marginRoutes,
          ),
        ).toEqual(expected)
      }
    }
  }
})
