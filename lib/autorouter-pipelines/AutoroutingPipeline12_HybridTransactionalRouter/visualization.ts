import type { GraphicsObject, Line, Rect, Text } from "graphics-debug"
import type { SimpleRouteJson } from "../../types"
import { convertSrjToGraphicsObject } from "../../utils/convertSrjToGraphicsObject"
import { copperSnapshotToSimpleRouteJson } from "./copper-snapshot-to-simple-route-json"
import type { SerialHybridEngineResult } from "./serial-engine-types"

export type HybridRoutingVisualization = {
  readonly name:
    | "global-topology"
    | "demand-capacity"
    | "dynamic-regions"
    | "transaction-history"
    | "final-route"
  readonly graphics: GraphicsObject
}

export function createHybridRoutingVisualizations({
  input,
  engineResult,
  maximumGraphicsObjects = 20_000,
}: {
  input: SimpleRouteJson
  engineResult: SerialHybridEngineResult
  maximumGraphicsObjects?: number
}): readonly HybridRoutingVisualization[] {
  if (!Number.isSafeInteger(maximumGraphicsObjects) || maximumGraphicsObjects <= 0) {
    throw new Error("maximumGraphicsObjects must be a positive safe integer")
  }
  const artifacts = engineResult.artifacts
  const baseGraphics = convertSrjToGraphicsObject({ ...input, traces: [] })
  const topologyLines: Line[] = artifacts.topologyPlan.routeObjectPlans.flatMap(
    (routePlan, routePlanIndex) =>
      routePlan.corridors.map((corridor) => ({
        points: [corridor.start, corridor.end],
        strokeWidth: Math.max(0.03, corridor.widthReserveMm),
        strokeColor: "rgba(72, 61, 139, 0.65)",
        strokeDash: [0.18, 0.09],
        step: routePlanIndex,
        label: `${routePlan.routeObjectId}\n${corridor.connectionName}\npressure=${corridor.congestionPressure.toFixed(3)}`,
      })),
  )
  const demandCells = sampleBounded(
    artifacts.demandCapacityField.cells,
    maximumGraphicsObjects,
  )
  const demandRects: Rect[] = demandCells.map((cell) => {
    const pressure = Math.min(
      1,
      (cell.demand + cell.committedCopperDemand + cell.obstaclePressure) /
        Math.max(cell.capacity, 1e-9),
    )
    return {
      center: {
        x: (cell.bounds.minX + cell.bounds.maxX) / 2,
        y: (cell.bounds.minY + cell.bounds.maxY) / 2,
      },
      width: cell.bounds.maxX - cell.bounds.minX,
      height: cell.bounds.maxY - cell.bounds.minY,
      fill: `rgba(255, ${Math.round(210 * (1 - pressure))}, 0, ${0.08 + pressure * 0.62})`,
      stroke: "rgba(70, 70, 70, 0.12)",
      layer: cell.layer,
      label: `${cell.layer}[${cell.column},${cell.row}]\ndemand=${cell.demand.toFixed(3)}\ncommitted=${cell.committedCopperDemand.toFixed(3)}\ncapacity=${cell.capacity.toFixed(3)}`,
    }
  })
  const regionRects: Rect[] = artifacts.regionGraph.regions.map(
    (region, regionIndex) => ({
      center: {
        x: (region.bounds.minX + region.bounds.maxX) / 2,
        y: (region.bounds.minY + region.bounds.maxY) / 2,
      },
      width: region.bounds.maxX - region.bounds.minX,
      height: region.bounds.maxY - region.bounds.minY,
      fill: `hsla(${(regionIndex * 137) % 360}, 70%, 55%, 0.10)`,
      stroke: `hsla(${(regionIndex * 137) % 360}, 70%, 35%, 0.85)`,
      step: regionIndex,
      label: `${region.regionId}\nobjects=${region.routeObjectIds.join(",")}\nconflicts=${region.conflictRegionIds.join(",")}`,
    }),
  )
  const contractRects: Rect[] = artifacts.boundaryContracts.map(
    (contract, contractIndex) => ({
      center: {
        x:
          (contract.crossingEnvelope.minX + contract.crossingEnvelope.maxX) /
          2,
        y:
          (contract.crossingEnvelope.minY + contract.crossingEnvelope.maxY) /
          2,
      },
      width:
        contract.crossingEnvelope.maxX - contract.crossingEnvelope.minX,
      height:
        contract.crossingEnvelope.maxY - contract.crossingEnvelope.minY,
      fill: "rgba(0, 180, 210, 0.12)",
      stroke: "rgba(0, 120, 150, 0.9)",
      step: artifacts.regionGraph.regions.length + contractIndex,
      label: `${contract.contractId}\nreserve=${contract.legalReserveMm.toFixed(3)}\n${contract.crossings.map((crossing) => crossing.connectionName).join(",")}`,
    }),
  )
  const transactionStepById = new Map(
    artifacts.attempts.flatMap((attempt, attemptIndex) =>
      attempt.transactionId ? [[attempt.transactionId, attemptIndex] as const] : [],
    ),
  )
  const getPrimitiveStep = (copperId: string): number => {
    for (const [transactionId, step] of transactionStepById) {
      if (copperId.startsWith(transactionId)) return step
    }
    return artifacts.attempts.length
  }
  const transactionLines: Line[] = artifacts.copperSnapshot.segments.map(
    (segment) => ({
      points: [segment.start, segment.end],
      strokeWidth: segment.widthMm,
      strokeColor: "rgba(20, 105, 180, 0.88)",
      layer: segment.layer,
      step: getPrimitiveStep(segment.copperId),
      label: `${segment.copperId}\n${segment.connectionName}`,
    }),
  )
  const rejectionTexts: Text[] = artifacts.attempts
    .filter((attempt) => attempt.outcome === "rejected" || attempt.outcome === "failed")
    .map((attempt, index) => ({
      x: input.bounds.minX,
      y: input.bounds.maxY + (index + 1) * 0.35,
      text: `${attempt.outcome}: ${attempt.regionId}: ${attempt.rejectionReason ?? "no rejection message"}`,
      color: attempt.outcome === "rejected" ? "#b45309" : "#b91c1c",
      fontSize: 0.22,
      anchorSide: "bottom_left" as const,
      step: artifacts.attempts.indexOf(attempt),
    }))
  const output = copperSnapshotToSimpleRouteJson({
    input,
    copperSnapshot: artifacts.copperSnapshot,
  })
  return Object.freeze([
    Object.freeze({
      name: "global-topology" as const,
      graphics: mergeGraphics({
        base: baseGraphics,
        title: "Hybrid router: global topology corridors",
        lines: sampleBounded(topologyLines, maximumGraphicsObjects),
      }),
    }),
    Object.freeze({
      name: "demand-capacity" as const,
      graphics: mergeGraphics({
        base: baseGraphics,
        title: `Hybrid router: demand/capacity v${artifacts.demandCapacityField.version}`,
        rects: demandRects,
      }),
    }),
    Object.freeze({
      name: "dynamic-regions" as const,
      graphics: mergeGraphics({
        base: baseGraphics,
        title: `Hybrid router: regions and boundary contracts v${artifacts.regionGraph.graphVersion}`,
        rects: sampleBounded(
          [...regionRects, ...contractRects],
          maximumGraphicsObjects,
        ),
      }),
    }),
    Object.freeze({
      name: "transaction-history" as const,
      graphics: mergeGraphics({
        base: baseGraphics,
        title: `Hybrid router: committed candidate copper v${artifacts.copperSnapshot.version}`,
        lines: sampleBounded(transactionLines, maximumGraphicsObjects),
        texts: sampleBounded(rejectionTexts, maximumGraphicsObjects),
      }),
    }),
    Object.freeze({
      name: "final-route" as const,
      graphics: Object.freeze({
        ...convertSrjToGraphicsObject(output),
        title: `Hybrid router: ${engineResult.status}`,
      }),
    }),
  ])
}

function mergeGraphics({
  base,
  title,
  lines = [],
  rects = [],
  texts = [],
}: {
  base: GraphicsObject
  title: string
  lines?: readonly Line[]
  rects?: readonly Rect[]
  texts?: readonly Text[]
}): GraphicsObject {
  return Object.freeze({
    ...base,
    title,
    lines: [...(base.lines ?? []), ...lines],
    rects: [...(base.rects ?? []), ...rects],
    texts: [...(base.texts ?? []), ...texts],
  })
}

function sampleBounded<Item>(
  items: readonly Item[],
  maximumItemCount: number,
): readonly Item[] {
  if (items.length <= maximumItemCount) return items
  const stride = Math.ceil(items.length / maximumItemCount)
  return items.filter((_, index) => index % stride === 0).slice(0, maximumItemCount)
}
