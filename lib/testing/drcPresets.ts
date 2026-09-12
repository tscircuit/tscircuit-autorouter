import type { GetDrcErrorsOptions } from "./getDrcErrors"
// Use the same board-declared rules and manufacturing defaults as Core.
// The export name is retained for existing callers; no clearances are relaxed.
export const RELAXED_DRC_OPTIONS: GetDrcErrorsOptions = {}
