// The two git revisions share a package name/version. Keep TypeScript from
// unifying their entry points and exposing unrelated A01/A03 changes here.
export { HighDensitySolverA13 } from "../node_modules/@tscircuit/high-density-a13/lib/HighDensitySolverA13/HighDensitySolverA13"
export { findRouteGeometryViolations } from "../node_modules/@tscircuit/high-density-a13/lib/routeGeometryValidation"
