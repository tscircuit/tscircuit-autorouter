// Regenerate the viewer bundle after changing either exact dependency pin with:
// bunx esbuild vendor/high-density-a11-runtime.entry.mjs --bundle --format=esm --platform=browser --target=es2022 --minify --external:@tscircuit/solver-utils --banner:js='// Generated from the canonical A01/A03 and exact A11 dependency pins; do not edit.' --outfile=vendor/high-density-a11-runtime.bundle.mjs
export { HighDensitySolverA01 } from "../node_modules/@tscircuit/high-density-a01/lib/HighDensitySolverA01/HighDensitySolverA01.ts"
export { HighDensitySolverA03 } from "../node_modules/@tscircuit/high-density-a01/lib/HighDensitySolverA03/HighDensitySolverA03.ts"
export { HighDensitySolverA11 } from "../node_modules/@tscircuit/high-density-a01-a11/lib/HighDensitySolverA11/HighDensitySolverA11.ts"
export { getRouteGeometryViolationError } from "../node_modules/@tscircuit/high-density-a01-a11/lib/routeGeometryValidation.ts"
