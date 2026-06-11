# Pipeline7 srj18 sample001 latest findings

Latest findings:
- Completed 2 full runs with heap snapshots for all 19 pipeline 7 phases.
- Disk footprint is about 1.2G per run because each phase writes its own `.heapsnapshot`.
- The dominant retained-heap jump is `11-portPointPathingSolver`: about +560 MiB versus the prior stage in both runs.
- The highest retained heap is `14-highDensityForceImproveSolver`: about 655 MiB in both runs, after `13-highDensityRouteSolver` peaks near 638 MiB.
- `15-highDensityRepairSolver` releases about 55 MiB relative to stage 14, suggesting some heavy route-improvement state does not survive past repair handoff.
- The longest phases are `13-highDensityRouteSolver` (~17.2s), `11-portPointPathingSolver` (~9.7-9.8s), `17-traceSimplificationSolver` (~2.2-2.3s), and `14-highDensityForceImproveSolver` (~2.2s).
- Cross-run retained-heap variance is very small; the biggest observed spread stays under 1 MiB for the major phases.

References:
- ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-001
- ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/run-002
- ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/phase-comparison.json
- ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/handoffs/agent-descartes-test-conventions.md
- ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/handoffs/agent-gibbs-dataset-and-phase-loading.md
- ./ai-artifacts/memory-analysis/pipeline7-srj18-sample001/handoffs/agent-leibniz-scoped-test.md
