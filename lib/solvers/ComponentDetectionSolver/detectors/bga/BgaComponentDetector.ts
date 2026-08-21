import type { Obstacle } from "lib/types";
import type { ComponentDetector, ComponentDetectorParams } from "../types";

const MIN_BGA_AXIS_COUNT = 3;
const MIN_BGA_GRID_OCCUPANCY = 0.5;
const MAX_BGA_PAD_SIZE_VARIANCE = 0.01;
const MAX_BGA_PAD_ASPECT_RATIO = 1.5;
const MIN_INTERIOR_PAD_COUNT = 1;
const AXIS_CLUSTER_EPSILON = 1e-3;

type BgaGridRow = {
  y: number;
  obstaclesByX: Map<number, Obstacle>;
};

export function clusterAxisValues(values: number[]): number[] {
  const sortedValues = [...values].sort((a, b) => a - b);
  const clustered: number[] = [];

  for (const value of sortedValues) {
    const previousValue = clustered[clustered.length - 1];
    if (
      previousValue === undefined ||
      Math.abs(value - previousValue) > AXIS_CLUSTER_EPSILON
    ) {
      clustered.push(value);
    }
  }

  return clustered;
}

function hasUniformDimensionWithinTolerance(values: number[]): boolean {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  if (minValue <= 0) return false;

  return maxValue / minValue <= 1 + MAX_BGA_PAD_SIZE_VARIANCE;
}

function hasUniformPadDimensions(memberObstacles: Obstacle[]): boolean {
  return (
    hasUniformDimensionWithinTolerance(
      memberObstacles.map((obstacle) => obstacle.width),
    ) &&
    hasUniformDimensionWithinTolerance(
      memberObstacles.map((obstacle) => obstacle.height),
    )
  );
}

function hasBgaLikePadAspectRatio(memberObstacles: Obstacle[]): boolean {
  return memberObstacles.every((obstacle) => {
    const minDim = Math.min(obstacle.width, obstacle.height);
    const maxDim = Math.max(obstacle.width, obstacle.height);
    if (minDim <= 0) return false;
    return maxDim / minDim <= MAX_BGA_PAD_ASPECT_RATIO;
  });
}

function hasInteriorPads(
  memberObstacles: Obstacle[],
  rowAxisValues: number[],
  columnAxisValues: number[],
): boolean {
  if (rowAxisValues.length < MIN_BGA_AXIS_COUNT) return false;
  if (columnAxisValues.length < MIN_BGA_AXIS_COUNT) return false;

  const interiorRows = new Set(rowAxisValues.slice(1, -1));
  const interiorColumns = new Set(columnAxisValues.slice(1, -1));

  let interiorPadCount = 0;

  for (const obstacle of memberObstacles) {
    if (
      interiorRows.has(obstacle.center.y) &&
      interiorColumns.has(obstacle.center.x)
    ) {
      interiorPadCount += 1;
    }
  }

  return interiorPadCount >= MIN_INTERIOR_PAD_COUNT;
}

function isDirectBgaLikeComponent(memberObstacles: Obstacle[]): boolean {
  if (!hasUniformPadDimensions(memberObstacles)) return false;
  if (!hasBgaLikePadAspectRatio(memberObstacles)) return false;

  const rowAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.y),
  );
  const columnAxisValues = clusterAxisValues(
    memberObstacles.map((obstacle) => obstacle.center.x),
  );
  const rowCount = rowAxisValues.length;
  const columnCount = columnAxisValues.length;

  if (rowCount < MIN_BGA_AXIS_COUNT || columnCount < MIN_BGA_AXIS_COUNT) {
    return false;
  }

  const gridCellCount = rowCount * columnCount;
  const gridOccupancy =
    gridCellCount > 0 ? memberObstacles.length / gridCellCount : 0;

  if (gridOccupancy < MIN_BGA_GRID_OCCUPANCY) return false;

  if (!hasInteriorPads(memberObstacles, rowAxisValues, columnAxisValues)) {
    return false;
  }

  return true;
}

function getPadGeometryKey(obstacle: Obstacle): string {
  return [
    Math.round(obstacle.width / AXIS_CLUSTER_EPSILON),
    Math.round(obstacle.height / AXIS_CLUSTER_EPSILON),
    obstacle.layers.join(","),
  ].join(":");
}

function hasUniformPitch(values: number[]): boolean {
  if (values.length < MIN_BGA_AXIS_COUNT) return false;

  const sortedValues = [...values].sort((a, b) => a - b);
  const pitch = sortedValues[1]! - sortedValues[0]!;
  if (pitch <= AXIS_CLUSTER_EPSILON) return false;

  return sortedValues.every(
    (value, index) =>
      index === 0 ||
      Math.abs(value - sortedValues[index - 1]! - pitch) <=
        AXIS_CLUSTER_EPSILON,
  );
}

function getRowsForPadGeometry(obstacles: Obstacle[]): BgaGridRow[] {
  const rowsByY = new Map<number, BgaGridRow>();

  for (const obstacle of obstacles) {
    const yKey = Math.round(obstacle.center.y / AXIS_CLUSTER_EPSILON);
    const xKey = Math.round(obstacle.center.x / AXIS_CLUSTER_EPSILON);
    const row = rowsByY.get(yKey) ?? {
      y: obstacle.center.y,
      obstaclesByX: new Map<number, Obstacle>(),
    };
    row.obstaclesByX.set(xKey, obstacle);
    rowsByY.set(yKey, row);
  }

  return [...rowsByY.values()];
}

function findLargestCompleteGrid(obstacles: Obstacle[]): Obstacle[] {
  const rows = getRowsForPadGeometry(obstacles);
  let largestGrid: Obstacle[] = [];

  for (const candidateRow of rows) {
    const xKeys = [...candidateRow.obstaclesByX.keys()];
    if (
      !hasUniformPitch(
        [...candidateRow.obstaclesByX.values()].map(
          (obstacle) => obstacle.center.x,
        ),
      )
    ) {
      continue;
    }

    const matchingRows = rows.filter((row) =>
      xKeys.every((xKey) => row.obstaclesByX.has(xKey)),
    );
    if (!hasUniformPitch(matchingRows.map((row) => row.y))) continue;

    const grid = matchingRows.flatMap((row) =>
      xKeys.map((xKey) => row.obstaclesByX.get(xKey)!),
    );
    if (grid.length > largestGrid.length) largestGrid = grid;
  }

  return largestGrid;
}

export function getBgaLikeObstacleSubset(
  memberObstacles: Obstacle[],
): Obstacle[] | null {
  if (isDirectBgaLikeComponent(memberObstacles)) return memberObstacles;

  const geometryGroups = Map.groupBy(memberObstacles, getPadGeometryKey);
  let largestGrid: Obstacle[] = [];

  for (const geometryGroup of geometryGroups.values()) {
    const grid = findLargestCompleteGrid(geometryGroup);
    if (grid.length > largestGrid.length) largestGrid = grid;
  }

  return largestGrid.length > 0 ? largestGrid : null;
}

export function isBgaLikeComponent(memberObstacles: Obstacle[]): boolean {
  return getBgaLikeObstacleSubset(memberObstacles) !== null;
}

export class BgaComponentDetector implements ComponentDetector {
  static readonly componentKind = "bga";
  readonly componentKind = BgaComponentDetector.componentKind;

  constructor(readonly params: ComponentDetectorParams) {}

  static isMatch({ memberObstacles }: ComponentDetectorParams) {
    return isBgaLikeComponent(memberObstacles);
  }
}
