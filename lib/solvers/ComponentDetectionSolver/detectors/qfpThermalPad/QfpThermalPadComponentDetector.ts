import type { ComponentDetector, ComponentDetectorParams } from "../types"
import { isQfpThermalPadLikeComponent } from "../qfp/qfpShared"

export class QfpThermalPadComponentDetector implements ComponentDetector {
  static readonly componentKind = "qfp_thermalpad"
  readonly componentKind = QfpThermalPadComponentDetector.componentKind

  constructor(readonly params: ComponentDetectorParams) {}

  static isMatch({ memberObstacles }: ComponentDetectorParams) {
    return isQfpThermalPadLikeComponent(memberObstacles)
  }
}
