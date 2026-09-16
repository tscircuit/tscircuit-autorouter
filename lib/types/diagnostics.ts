export type AutoroutingDiagnosticSeverity = "error" | "warning"
export type DiagnosticSeverity = AutoroutingDiagnosticSeverity

export type AutoroutingDiagnosticAction = "stop_and_fix" | "continue"
export type RecommendedAction = AutoroutingDiagnosticAction

export type DiagnosticCode = string

export type AutoroutingDiagnosticLocation = {
  x: number
  y: number
  layer?: string
}

export type AutoroutingDiagnostic = {
  code: string
  message: string
  severity: AutoroutingDiagnosticSeverity
  recommendedAction: AutoroutingDiagnosticAction
  phase?: string
  connectionNames?: string[]
  pcbPortIds?: string[]
  obstacleIds?: string[]
  locations?: AutoroutingDiagnosticLocation[]
}
