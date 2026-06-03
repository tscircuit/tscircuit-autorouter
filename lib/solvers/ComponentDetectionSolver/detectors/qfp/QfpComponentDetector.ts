import type { ComponentDetector, ComponentDetectorParams } from "../types"
import { isQfpLikeComponent } from "./qfpShared"

export class QfpComponentDetector implements ComponentDetector {
  static readonly componentKind = "qfp"
  readonly componentKind = QfpComponentDetector.componentKind

  constructor(readonly params: ComponentDetectorParams) {}

  static isMatch({ memberObstacles }: ComponentDetectorParams) {
    return isQfpLikeComponent(memberObstacles)
  }
}
