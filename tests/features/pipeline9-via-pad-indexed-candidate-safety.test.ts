import { expect, test } from "bun:test"
import {
  isPipeline9ViaPadIndexedCandidateSafe,
  isPipeline9ViaPadReferenceCandidateSafe,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-pipeline9-via-pad-clearance-repairs"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-joint-drc-repair-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"

const createViaPadError = ({
  traceId,
  viaId,
  foreignPadId,
}: {
  traceId: string
  viaId: string
  foreignPadId: string
}): Pipeline9DrcError => ({
  type: "pcb_pad_pad_clearance_error",
  pcb_trace_id: traceId,
  pcb_via_ids: [viaId],
  pcb_pad_ids: [viaId, foreignPadId],
  pcb_pad_pad_clearance_error_id: `via_pad_clearance_${viaId}_${foreignPadId}`,
})

test("Pipeline9 via-pad indexed acceptance enforces ownership and mutation invariants", () => {
  const ownerRoute: HighDensityRoute = {
    connectionName: "owner",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "owner_start" },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 4, y: 0, z: 1, pcb_port_id: "owner_end" },
    ],
    vias: [{ x: 2, y: 0 }],
  }
  const fixedRoute: HighDensityRoute = {
    connectionName: "fixed",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 2, z: 0, pcb_port_id: "fixed_start" },
      { x: 4, y: 2, z: 0, pcb_port_id: "fixed_end" },
    ],
    vias: [],
  }
  const localizedOwnerRoute: HighDensityRoute = {
    ...ownerRoute,
    route: [
      ownerRoute.route[0]!,
      { x: 1, y: 0.25, z: 0 },
      { x: 2, y: 0.25, z: 0 },
      { x: 2, y: 0.25, z: 1 },
      ownerRoute.route[4]!,
      ownerRoute.route[5]!,
    ],
    vias: [{ x: 2, y: 0.25 }],
  }
  const targetError = createViaPadError({
    traceId: "owner_0",
    viaId: "via_11",
    foreignPadId: "pad_foreign",
  })
  const otherViaPadError = createViaPadError({
    traceId: "owner_0",
    viaId: "via_12",
    foreignPadId: "pad_other",
  })
  const retainedTraceError: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "overlap_owner_0_fixed_0",
    pcb_trace_ids: ["owner_0", "fixed_0"],
    actual_clearance: 0.09,
    minimum_clearance: 0.1,
  }
  const removedTraceError: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "overlap_owner_0_removed_0",
    pcb_trace_ids: ["owner_0", "removed_0"],
  }
  const currentErrors = [
    targetError,
    otherViaPadError,
    retainedTraceError,
    removedTraceError,
  ]
  const candidateErrors = [otherViaPadError, retainedTraceError]
  const safeInput = {
    candidateRoutes: [localizedOwnerRoute, fixedRoute],
    candidateErrors,
    currentRoutes: [ownerRoute, fixedRoute],
    currentErrors,
    mutableRouteIndexes: new Set([0]),
    mutableRouteIntervals: new Map([
      [0, { startSegmentIndex: 0, endSegmentIndex: 3 }],
    ]),
    targetedViolationKeys: new Set(["owner_0:pad_foreign"]),
    srj: {
      allowViaInPad: false,
      layerCount: 2,
      obstacles: [],
    },
  }

  expect(isPipeline9ViaPadIndexedCandidateSafe(safeInput)).toBeTrue()

  const lengthChangedOwnerRoute = structuredClone(localizedOwnerRoute)
  lengthChangedOwnerRoute.route.splice(3, 0, {
    ...lengthChangedOwnerRoute.route[2]!,
  })
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateRoutes: [lengthChangedOwnerRoute, fixedRoute],
      mutableRouteIntervals: undefined,
      mutableRouteBoundaryScopes: new Map([
        [
          0,
          {
            prefix: [ownerRoute.route[0]!],
            suffix: [ownerRoute.route[4]!, ownerRoute.route[5]!],
          },
        ],
      ]),
    }),
  ).toBeTrue()
  const changedBoundaryScopeRoute = structuredClone(lengthChangedOwnerRoute)
  changedBoundaryScopeRoute.route.at(-2)!.y += 0.1
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateRoutes: [changedBoundaryScopeRoute, fixedRoute],
      mutableRouteIntervals: undefined,
      mutableRouteBoundaryScopes: new Map([
        [
          0,
          {
            prefix: [ownerRoute.route[0]!],
            suffix: [ownerRoute.route[4]!, ownerRoute.route[5]!],
          },
        ],
      ]),
    }),
  ).toBeFalse()

  const degradedRetainedError = {
    ...retainedTraceError,
    actual_clearance: 0,
  }
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateErrors: [otherViaPadError, degradedRetainedError],
    }),
  ).toBeFalse()

  const ownerRouteWithJumperPad = structuredClone(ownerRoute)
  ownerRouteWithJumperPad.route[1]!.insideJumperPad = true
  ownerRouteWithJumperPad.route[2]!.insideJumperPad = true
  const movedJumperPadRoute = structuredClone(localizedOwnerRoute)
  movedJumperPadRoute.route[1]!.insideJumperPad = true
  movedJumperPadRoute.route[2]!.insideJumperPad = true
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      currentRoutes: [ownerRouteWithJumperPad, fixedRoute],
      candidateRoutes: [movedJumperPadRoute, fixedRoute],
    }),
  ).toBeFalse()

  const changedOutsideOwnedInterval = structuredClone(localizedOwnerRoute)
  changedOutsideOwnedInterval.route[4]!.y = 0.5
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateRoutes: [changedOutsideOwnedInterval, fixedRoute],
    }),
  ).toBeFalse()

  const renumberedTargetError = createViaPadError({
    traceId: "owner_0",
    viaId: "via_99",
    foreignPadId: "pad_foreign",
  })
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateErrors: [renumberedTargetError, retainedTraceError],
    }),
  ).toBeFalse()

  const ownerRouteWithInteriorTerminal = structuredClone(ownerRoute)
  ownerRouteWithInteriorTerminal.route[1]!.pcb_port_id = "interior_terminal"
  const movedInteriorTerminalRoute = structuredClone(localizedOwnerRoute)
  movedInteriorTerminalRoute.route[1]!.pcb_port_id = "interior_terminal"
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      currentRoutes: [ownerRouteWithInteriorTerminal, fixedRoute],
      candidateRoutes: [movedInteriorTerminalRoute, fixedRoute],
    }),
  ).toBeFalse()

  const ownerRouteWithThroughObstacle = structuredClone(ownerRoute)
  ownerRouteWithThroughObstacle.route[1]!.toNextSegmentType = "through_obstacle"
  const movedThroughObstacleRoute = structuredClone(localizedOwnerRoute)
  movedThroughObstacleRoute.route[1]!.toNextSegmentType = "through_obstacle"
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      currentRoutes: [ownerRouteWithThroughObstacle, fixedRoute],
      candidateRoutes: [movedThroughObstacleRoute, fixedRoute],
    }),
  ).toBeFalse()

  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      srj: {
        allowViaInPad: false,
        layerCount: 2,
        obstacles: [
          {
            type: "rect",
            layers: ["top"],
            center: { x: 2, y: 0.45 },
            width: 0.4,
            height: 0.2,
            connectedTo: ["owner"],
          },
        ],
      },
    }),
  ).toBeFalse()

  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateRoutes: [localizedOwnerRoute, structuredClone(fixedRoute)],
    }),
  ).toBeFalse()

  const geometricallyChangedFixedRoute = structuredClone(fixedRoute)
  geometricallyChangedFixedRoute.route[0]!.x = -0.25
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateRoutes: [localizedOwnerRoute, geometricallyChangedFixedRoute],
    }),
  ).toBeFalse()

  const endpointChangedOwnerRoute = structuredClone(localizedOwnerRoute)
  endpointChangedOwnerRoute.route[0]!.x = -0.25
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateRoutes: [endpointChangedOwnerRoute, fixedRoute],
    }),
  ).toBeFalse()

  const newDrcIdentity: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "overlap_owner_0_new_0",
    pcb_trace_ids: ["owner_0", "new_0"],
  }
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateErrors: [otherViaPadError, retainedTraceError, newDrcIdentity],
    }),
  ).toBeFalse()

  const currentViaCollision: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "owner_0",
    pcb_trace_error_id: "overlap_owner_0_via_11",
    pcb_via_ids: ["via_11"],
    center: { x: 1, y: 1 },
  }
  const differentViaCollision: Pipeline9DrcError = {
    ...currentViaCollision,
    pcb_trace_error_id: "overlap_owner_0_via_99",
    pcb_via_ids: ["via_99"],
    center: { x: 2, y: 2 },
  }
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      currentErrors: [...currentErrors, currentViaCollision],
      candidateErrors: [
        otherViaPadError,
        retainedTraceError,
        differentViaCollision,
      ],
    }),
  ).toBeFalse()

  const routeWithoutExactBoundary = structuredClone(localizedOwnerRoute)
  routeWithoutExactBoundary.route[0]!.insideJumperPad = true
  routeWithoutExactBoundary.route.at(-1)!.insideJumperPad = true
  expect(
    isPipeline9ViaPadIndexedCandidateSafe({
      ...safeInput,
      candidateRoutes: [routeWithoutExactBoundary, fixedRoute],
    }),
  ).toBeFalse()

  const currentFallbackIdentity: Pipeline9DrcError = {
    type: "pcb_trace_clearance_error",
    pcb_trace_id: "owner_0",
    pcb_pad_id: "pad_original",
  }
  const newFallbackIdentity: Pipeline9DrcError = {
    type: "pcb_trace_clearance_error",
    pcb_trace_id: "owner_0",
    pcb_pad_id: "pad_new",
  }
  expect(
    isPipeline9ViaPadReferenceCandidateSafe({
      currentErrors: [currentFallbackIdentity, removedTraceError],
      candidateErrors: [currentFallbackIdentity],
    }),
  ).toBeTrue()
  expect(
    isPipeline9ViaPadReferenceCandidateSafe({
      currentErrors: [currentFallbackIdentity, removedTraceError],
      candidateErrors: [newFallbackIdentity],
    }),
  ).toBeFalse()
  expect(
    isPipeline9ViaPadReferenceCandidateSafe({
      currentErrors: [retainedTraceError, removedTraceError],
      candidateErrors: [degradedRetainedError],
    }),
  ).toBeFalse()
  const currentViaNamedTraceCollision: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "overlap_via_0_fixed_0",
    pcb_trace_id: "via_0",
    pcb_trace_ids: ["via_0", "fixed_0"],
  }
  const newViaNamedTraceCollision: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "overlap_via_1_fixed_0",
    pcb_trace_id: "via_1",
    pcb_trace_ids: ["via_1", "fixed_0"],
  }
  expect(
    isPipeline9ViaPadReferenceCandidateSafe({
      currentErrors: [currentViaNamedTraceCollision, removedTraceError],
      candidateErrors: [newViaNamedTraceCollision],
    }),
  ).toBeFalse()
  const retainedWideRuleError: Pipeline9DrcError = {
    type: "pcb_trace_clearance_error",
    pcb_error_id: "wide_rule_owner_fixed",
    message: "required clearance: 0.2mm, gap: 0.15mm",
  }
  expect(
    isPipeline9ViaPadReferenceCandidateSafe({
      currentErrors: [retainedWideRuleError, removedTraceError],
      candidateErrors: [
        {
          ...retainedWideRuleError,
          message: "required clearance: 0.2mm, gap: 0.14mm",
        },
      ],
    }),
  ).toBeFalse()
})
