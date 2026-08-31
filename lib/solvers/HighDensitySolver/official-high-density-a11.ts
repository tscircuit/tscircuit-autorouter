import * as officialA11Package from "@tscircuit/high-density-a01-a11"

// The legacy and A11 pins declare the same upstream package name and version,
// so TypeScript merges their package identities. Resolve A11 from the exact
// runtime pin while keeping legacy A01/A03 on their known-good commit.
const officialExports = officialA11Package as unknown as {
  HighDensitySolverA11: new (props: any) => any
  getRouteGeometryViolationError: (routes: any[]) => string | null
}

export const HighDensitySolverA11 = officialExports.HighDensitySolverA11
export const getRouteGeometryViolationError =
  officialExports.getRouteGeometryViolationError
