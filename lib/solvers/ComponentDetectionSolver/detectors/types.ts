import type { Obstacle, SimpleRouteJson } from "lib/types"

export type ComponentKind = "bga" | "qfp" | "qfp_thermalpad" | "soic"

export interface ComponentDetectorParams {
  memberObstacles: Obstacle[]
  inputSrj: SimpleRouteJson
}

export interface ComponentDetector {
  componentKind: ComponentKind
}

export interface ComponentDetectorConstructor {
  componentKind: ComponentKind
  isMatch(params: ComponentDetectorParams): boolean
  new (params: ComponentDetectorParams): ComponentDetector
}
