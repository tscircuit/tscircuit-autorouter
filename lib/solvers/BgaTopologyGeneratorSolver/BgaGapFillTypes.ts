import type { Point } from "@tscircuit/math-utils";
import type { CapacityMeshNode, Obstacle } from "lib/types";

export type EdgeSegmentWithObstacle = {
  start: Point;
  end: Point;
  expansionDirection: Point;
  obstacle: Obstacle;
};

export type DetectEdgesNotConnectedToMeshInput = {
  meshNodes: CapacityMeshNode[];
  unmarkedComponentObstacles: Obstacle[];
};

export type ExpandUnconnectedEdgesToMeshInput = {
  meshNodes: CapacityMeshNode[];
  edgesWithObstacle: EdgeSegmentWithObstacle[];
  layerCount: number;
};

export type GapFillInput = {
  meshNodes: CapacityMeshNode[];
  unmarkedComponentObstacles: Obstacle[];
  layerCount: number;
};
