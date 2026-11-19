from pathlib import Path
import sys

scripts = Path(__file__).parent
for folder in map(Path, sys.argv[1:]):
    (folder / "validate-frozen-request-constraints.ts").write_bytes(
        (scripts / "validate-frozen-request-constraints.ts").read_bytes()
    )
    path = folder / "benchmarks/benchmark-worker.ts"
    worker = path.read_text()
    worker = (
        'import { validateNativeRequestConstraints } from "../validate-frozen-request-constraints"\n'
        'import { validateRoutedCopperDrc } from "../lib/validate-routed-copper-drc"\n'
        + worker
    )
    marker = "  if (solvedSolver) {\n"
    assert worker.count(marker) == 1
    worker = worker.replace(marker, marker + '''    const output = solvedSolver.getOutput()
    Object.assign(row, {
      physicalAudit: {
        requestConstraints: validateNativeRequestConstraints({
          inputSrj: sample.simpleRouteJson,
          solverOptions: sample.solverOptions ?? {},
          traces: output.fanoutTraces,
        }),
        copperDrc: validateRoutedCopperDrc({
          inputSrj: sample.simpleRouteJson,
          routedSrj: output.simpleRouteJson,
          clearance: solvedSolver.config.clearance,
          allowBlindAndBuriedVias: solvedSolver.config.allowBlindAndBuriedVias,
        }),
      },
    })
''')
    path.write_text(worker)
