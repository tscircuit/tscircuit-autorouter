from pathlib import Path
import os, shutil
sample = os.environ['SAMPLE']
p = Path('router') / sample
s = p.read_text()
s = 'import { captureRoundoffRouting } from "../../audit-roundoff-snapshot"\n' + s
if 'a13-fixed' in sample:
    needle = '  expect(solver.solved).toBe(true)'
    extra = '  captureRoundoffRouting(solver, { inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces() })\n'
elif 'imx6-ddr' in sample:
    needle = '  await expect(getBugReportSnapshotSvg(snapshotInput))'
    extra = '  captureRoundoffRouting(solver, snapshotInput)\n'
else:
    needle = '  await expect(snapshots.board)'
    extra = '  captureRoundoffRouting(pipeline, { inputSrj: { ...fixture.srj, traces: [] }, srjWithPointPairs: snapshots.srj, routedTraces: snapshots.srj.traces! })\n'
assert s.count(needle) == 1
p.write_text(s.replace(needle, extra + needle))
shutil.copyfile('experiments/e2e-samples-20261120/audit-roundoff-snapshot.ts', 'router/audit-roundoff-snapshot.ts')
