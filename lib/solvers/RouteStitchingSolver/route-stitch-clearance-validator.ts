import { pointToSegmentDistance, type Point3 } from "@tscircuit/math-utils";
import { RbushIndex } from "lib/data-structures/RbushIndex";
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types";
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments";

export type StitchSegment = {
  connectionName: string;
  start: Point3;
  end: Point3;
  traceThickness: number;
};

export type IsStitchSegmentClear = (stitchSegment: StitchSegment) => boolean;

type ConnectionName = HighDensityIntraNodeRoute["connectionName"];
type RootConnectionName = NonNullable<
  HighDensityIntraNodeRoute["rootConnectionName"]
>;

type RouteSegment = StitchSegment;

type RouteVia = {
  connectionName: ConnectionName;
  x: number;
  y: number;
  diameter: number;
};

const DEFAULT_AUTOROUTING_CLEARANCE = 0.1;
const CLEARANCE_TOLERANCE = 1e-6;

/**
 * Allows a stitch to leave copper that already violates clearance at one
 * endpoint, provided the stitch never gets closer and exits the violation.
 */
const preservesEndpointClearance = ({
  startGap,
  endGap,
  segmentGap,
  requiredGap,
}: {
  startGap: number;
  endGap: number;
  segmentGap: number;
  requiredGap: number;
}): boolean => {
  const escapesFromStart =
    startGap < requiredGap &&
    endGap >= requiredGap - CLEARANCE_TOLERANCE &&
    segmentGap >= startGap - CLEARANCE_TOLERANCE;
  const escapesFromEnd =
    endGap < requiredGap &&
    startGap >= requiredGap - CLEARANCE_TOLERANCE &&
    segmentGap >= endGap - CLEARANCE_TOLERANCE;
  const preservesExistingViolation =
    startGap < requiredGap &&
    endGap < requiredGap &&
    segmentGap >= Math.min(startGap, endGap) - CLEARANCE_TOLERANCE;

  return escapesFromStart || escapesFromEnd || preservesExistingViolation;
};

export class RouteStitchClearanceValidator {
  private readonly minClearance: number;
  private readonly rootsByConnection = new Map<
    ConnectionName,
    Set<RootConnectionName>
  >();
  private readonly sameNetCache = new Map<
    ConnectionName,
    Map<ConnectionName, boolean>
  >();
  private readonly segments: RouteSegment[] = [];
  private readonly vias: RouteVia[] = [];
  private segmentIndexesByLayer:
    Map<number, RbushIndex<RouteSegment>> | undefined;
  private viaIndex: RbushIndex<RouteVia> | undefined;

  constructor({
    hdRoutes,
    minClearance = DEFAULT_AUTOROUTING_CLEARANCE,
  }: {
    hdRoutes: HighDensityIntraNodeRoute[];
    minClearance?: number;
  }) {
    this.minClearance = minClearance;
    for (const hdRoute of hdRoutes) {
      this.addRoute(hdRoute);
    }
    this.buildSpatialIndexes();
  }

  addRoute(hdRoute: HighDensityIntraNodeRoute): void {
    const roots =
      this.rootsByConnection.get(hdRoute.connectionName) ?? new Set();
    roots.add(hdRoute.rootConnectionName ?? hdRoute.connectionName);
    this.rootsByConnection.set(hdRoute.connectionName, roots);
    this.sameNetCache.clear();

    for (let index = 0; index < hdRoute.route.length - 1; index += 1) {
      const start = hdRoute.route[index]!;
      const end = hdRoute.route[index + 1]!;
      if (start.z !== end.z) continue;
      if (start.insideJumperPad && end.insideJumperPad) continue;
      const segment = {
        connectionName: hdRoute.connectionName,
        start,
        end,
        traceThickness: hdRoute.traceThickness,
      };
      this.segments.push(segment);
      this.insertSegmentIntoSpatialIndex(segment);
    }

    for (const via of hdRoute.vias) {
      const routeVia = {
        connectionName: hdRoute.connectionName,
        x: via.x,
        y: via.y,
        diameter: hdRoute.viaDiameter,
      };
      this.vias.push(routeVia);
      this.insertViaIntoSpatialIndex(routeVia);
    }
  }

  private insertSegmentIntoSpatialIndex(segment: RouteSegment): void {
    if (!this.segmentIndexesByLayer) return;
    let index = this.segmentIndexesByLayer.get(segment.start.z);
    if (!index) {
      index = new RbushIndex<RouteSegment>();
      this.segmentIndexesByLayer.set(segment.start.z, index);
    }
    const radius = segment.traceThickness / 2;
    index.insert(
      segment,
      Math.min(segment.start.x, segment.end.x) - radius,
      Math.min(segment.start.y, segment.end.y) - radius,
      Math.max(segment.start.x, segment.end.x) + radius,
      Math.max(segment.start.y, segment.end.y) + radius,
    );
  }

  private insertViaIntoSpatialIndex(via: RouteVia): void {
    if (!this.viaIndex) return;
    const radius = via.diameter / 2;
    this.viaIndex.insert(
      via,
      via.x - radius,
      via.y - radius,
      via.x + radius,
      via.y + radius,
    );
  }

  private buildSpatialIndexes(): void {
    this.segmentIndexesByLayer = new Map();
    const segmentsByLayer = new Map<number, RouteSegment[]>();
    for (const segment of this.segments) {
      const layerSegments = segmentsByLayer.get(segment.start.z);
      if (layerSegments) layerSegments.push(segment);
      else segmentsByLayer.set(segment.start.z, [segment]);
    }
    for (const [z, layerSegments] of segmentsByLayer) {
      const index = new RbushIndex<RouteSegment>();
      index.bulkLoad(
        layerSegments.map((segment) => {
          const radius = segment.traceThickness / 2;
          return {
            item: segment,
            minX: Math.min(segment.start.x, segment.end.x) - radius,
            minY: Math.min(segment.start.y, segment.end.y) - radius,
            maxX: Math.max(segment.start.x, segment.end.x) + radius,
            maxY: Math.max(segment.start.y, segment.end.y) + radius,
          };
        }),
      );
      this.segmentIndexesByLayer.set(z, index);
    }

    this.viaIndex = new RbushIndex<RouteVia>();
    this.viaIndex.bulkLoad(
      this.vias.map((via) => {
        const radius = via.diameter / 2;
        return {
          item: via,
          minX: via.x - radius,
          minY: via.y - radius,
          maxX: via.x + radius,
          maxY: via.y + radius,
        };
      }),
    );
  }

  private areSameNet(
    firstConnectionName: ConnectionName,
    secondConnectionName: ConnectionName,
  ): boolean {
    if (firstConnectionName === secondConnectionName) return true;
    const cached = this.sameNetCache
      .get(firstConnectionName)
      ?.get(secondConnectionName);
    if (cached !== undefined) return cached;
    const firstRoots = this.rootsByConnection.get(firstConnectionName);
    const secondRoots = this.rootsByConnection.get(secondConnectionName);
    let sameNet = false;
    if (firstRoots && secondRoots) {
      for (const root of firstRoots) {
        if (secondRoots.has(root)) {
          sameNet = true;
          break;
        }
      }
    }
    let connectionsFromFirst = this.sameNetCache.get(firstConnectionName);
    if (!connectionsFromFirst) {
      connectionsFromFirst = new Map();
      this.sameNetCache.set(firstConnectionName, connectionsFromFirst);
    }
    connectionsFromFirst.set(secondConnectionName, sameNet);
    return sameNet;
  }

  isSegmentClear({
    connectionName,
    start,
    end,
    traceThickness,
  }: StitchSegment): boolean {
    const traceRadius = traceThickness / 2;
    const queryMargin = this.minClearance + traceRadius;
    const queryMinX = Math.min(start.x, end.x) - queryMargin;
    const queryMinY = Math.min(start.y, end.y) - queryMargin;
    const queryMaxX = Math.max(start.x, end.x) + queryMargin;
    const queryMaxY = Math.max(start.y, end.y) + queryMargin;

    const nearbySegments =
      this.segmentIndexesByLayer
        ?.get(start.z)
        ?.search(queryMinX, queryMinY, queryMaxX, queryMaxY) ?? [];
    for (const segment of nearbySegments) {
      if (this.areSameNet(connectionName, segment.connectionName)) continue;

      const requiredGap =
        this.minClearance + traceRadius + segment.traceThickness / 2;
      const segmentGap = minimumDistanceBetweenSegments(
        start,
        end,
        segment.start,
        segment.end,
      );
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          startGap: pointToSegmentDistance(start, segment.start, segment.end),
          endGap: pointToSegmentDistance(end, segment.start, segment.end),
          segmentGap,
          requiredGap,
        })
      ) {
        return false;
      }
    }

    const nearbyVias =
      this.viaIndex?.search(queryMinX, queryMinY, queryMaxX, queryMaxY) ?? [];
    for (const via of nearbyVias) {
      if (this.areSameNet(connectionName, via.connectionName)) continue;

      const requiredGap = this.minClearance + traceRadius + via.diameter / 2;
      const segmentGap = pointToSegmentDistance(via, start, end);
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          startGap: Math.hypot(start.x - via.x, start.y - via.y),
          endGap: Math.hypot(end.x - via.x, end.y - via.y),
          segmentGap,
          requiredGap,
        })
      ) {
        return false;
      }
    }

    return true;
  }
}
