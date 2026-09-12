import { AutoroutingDrcEngine } from "./AutoroutingDrcEngine"
import {
  type AutoroutingDrcEngineOptions,
  type AutoroutingDrcEngineRunStats,
  type AutoroutingDrcResult,
  type SimpleRouteJson,
  type SimplifiedPcbTraces,
} from "high-density-repair03/lib"

export type DrcEngine = {
  evaluate: (traces: SimplifiedPcbTraces) => AutoroutingDrcResult
  evaluateLegacy: (traces: SimplifiedPcbTraces) => AutoroutingDrcResult
  readonly lastRunStats: AutoroutingDrcEngineRunStats
}

export type DrcEngineFactory = (
  srj: SimpleRouteJson,
  options: AutoroutingDrcEngineOptions,
) => DrcEngine

export function createAutoroutingDrcEngine(
  srj: SimpleRouteJson,
  options: AutoroutingDrcEngineOptions = {},
): AutoroutingDrcEngine {
  return new AutoroutingDrcEngine(srj, options)
}
