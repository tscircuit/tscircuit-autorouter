import { BgaComponentDetector } from "./bga/BgaComponentDetector"
import { QfpComponentDetector } from "./qfp/QfpComponentDetector"
import { QfpThermalPadComponentDetector } from "./qfpThermalPad/QfpThermalPadComponentDetector"
import { SoicComponentDetector } from "./soic/SoicComponentDetector"
import type {
  ComponentDetector,
  ComponentDetectorConstructor,
  ComponentDetectorParams,
  ComponentKind,
} from "./types"

export type {
  ComponentDetector,
  ComponentDetectorConstructor,
  ComponentDetectorParams,
  ComponentKind,
} from "./types"

export const componentDetectorConstructors: ComponentDetectorConstructor[] = [
  QfpThermalPadComponentDetector,
  QfpComponentDetector,
  SoicComponentDetector,
  BgaComponentDetector,
]

export function createComponentDetector(
  params: ComponentDetectorParams,
): ComponentDetector | null {
  for (const Detector of componentDetectorConstructors) {
    if (Detector.isMatch(params)) return new Detector(params)
  }

  return null
}

export function detectComponentKind(
  params: ComponentDetectorParams,
): ComponentKind | null {
  return createComponentDetector(params)?.componentKind ?? null
}
