#!/usr/bin/env python3
"""Copy the pinned official harness and add only factory/provenance hooks."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Pinned harness anchor does not occur exactly once: {old[:80]!r}")
    return text.replace(old, new, 1)


def prepare(controller, target, expected_sha):
    observed = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=target, text=True).strip()
    if observed != expected_sha:
        raise ValueError(f"Checkout SHA mismatch: {observed} != {expected_sha}")
    source = controller / "scripts" / "benchmark"
    destination = target / "scripts" / "benchmark"
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)
    shutil.copy2(controller / "benchmark.sh", target / "benchmark.sh")
    audit_source = pathlib.Path(__file__).resolve().parent
    shutil.copy2(audit_source / "experiment-audit-adapter.ts", destination / "experiment-audit-adapter.ts")
    shutil.copy2(audit_source / "qualify-pinned-output.ts", destination / "qualify-pinned-output.ts")
    shutil.copy2(audit_source / "experiment-dataset-identity.ts", destination / "experiment-dataset-identity.ts")
    shutil.copy2(audit_source / "phase-checkpoint-observer.ts", destination / "phase-checkpoint-observer.ts")
    shutil.copy2(audit_source / "capture-terminal-failure-geometry.ts", destination / "capture-terminal-failure-geometry.ts")
    task_path = destination / "benchmark-run-task.ts"
    task_source = task_path.read_text()
    original_task_hash = digest(task_path)
    task_source = 'import { getExperimentAuditConstructor, createExperimentAuditSolver, getExperimentAuditEvidence, captureExperimentAuditOutput, captureExperimentAuditProgress, startExperimentPhaseCheckpoints, finishExperimentPhaseCheckpoints } from "./experiment-audit-adapter"\n' + task_source
    task_source = replace_once(task_source,
        'const getSolverConstructor = (solverName: string): SolverConstructor => {',
        'const getSolverConstructor = (solverName: string): SolverConstructor => {\n  return getExperimentAuditConstructor()\n  // Original dispatch remains below as auditable dead code in this dedicated experiment harness.')
    task_source = replace_once(task_source,
        'return new SolverConstructor(task.scenario, scenarioOptions)',
        'return createExperimentAuditSolver(SolverConstructor, task, scenarioOptions)')
    task_source = replace_once(task_source,
        'const routingMetrics = getRoutingBenchmarkMetrics(solver)',
        'const routingMetrics = getRoutingBenchmarkMetrics(solver)\n  ;(routingMetrics as any).experimentAudit = getExperimentAuditEvidence(solver, task)')
    task_source = replace_once(task_source,
        'const traceLinter = runTraceLinting(solver.getOutputSimpleRouteJson())',
        'const rawOutputForAudit = solver.getOutputSimpleRouteJson()\n    const traceLinter = runTraceLinting(rawOutputForAudit)')
    task_source = replace_once(task_source,
        '): WorkerProgress => {\n  const pipelineStep = solver.pipelineDef[solver.currentPipelineStepIndex]\n  const activeSubSolver = solver.activeSubSolver ?? null',
        '): WorkerProgress => {\n  const pipelineStep = solver.pipelineDef[solver.currentPipelineStepIndex]\n  const activeSubSolver = solver.activeSubSolver ?? null\n  captureExperimentAuditProgress(solver, elapsedTimeMs, pipelineStep?.solverName)')
    task_source = replace_once(task_source,
        'const relaxedDrcPassed = errors.length === 0',
        'const relaxedDrcPassed = errors.length === 0\n    try {\n      ;(routingMetrics as any).experimentAudit = captureExperimentAuditOutput(solver, task, traces, rawOutputForAudit)\n    } catch (auditError) {\n      ;(routingMetrics as any).experimentAudit = { ...getExperimentAuditEvidence(solver, task), outputCaptureError: auditError instanceof Error ? auditError.message : String(auditError) }\n    }')
    task_source = replace_once(task_source,
        '  try {\n    await solveWithProgress(task, solver, start, options)\n  } catch (error) {\n    solver.solved = false\n    solveError = getErrorMessage(error)\n  }',
        '  startExperimentPhaseCheckpoints(solver, start)\n  try {\n    await solveWithProgress(task, solver, start, options)\n  } catch (error) {\n    solver.solved = false\n    solveError = getErrorMessage(error)\n  } finally {\n    finishExperimentPhaseCheckpoints(solver)\n  }')
    # Observe an existing per-instance lifecycle only. Reject unexpected solver
    # shapes before routing; do not patch algorithm source or force a runtime.
    pipeline_path = target / "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"
    pipeline_source = pipeline_path.read_text()
    lifecycle_anchors = ["  _step() {", "const constructorParams = pipelineStepDef.getConstructorParams(this)",
        "this.activeSubSolver = new pipelineStepDef.solverClass(...constructorParams)",
        "pipelineStepDef.onSolved?.(this)", "this.activeSubSolver.step()"]
    for anchor in lifecycle_anchors:
        if pipeline_source.count(anchor) != 1:
            raise ValueError("Unexpected pipeline lifecycle anchor: " + anchor)
    task_path.write_text(task_source)
    # These files define original-input interpretation and validation. Reject
    # modified experiment validators instead of silently using different ones.
    validator_paths = [
        "lib/testing/evaluate-relaxed-drc.ts", "lib/testing/getDrcErrors.ts",
        "lib/testing/drcPresets.ts", "lib/testing/utils/convertToCircuitJson.ts",
        "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata.ts",
    ]
    validator_hashes = {}
    for relative in validator_paths:
        before = digest(controller / relative)
        if digest(target / relative) != before:
            raise ValueError(f"Candidate changed a pinned validator: {relative}")
        validator_hashes[relative] = before
    provenance = {
        "checkoutSha": observed,
        "officialHarnessHash": original_task_hash,
        "adaptedHarnessHash": digest(task_path),
        "terminalFailureGeometryCaptureHash": digest(destination / "capture-terminal-failure-geometry.ts"),
        "phaseCheckpointObserverHash": digest(destination / "phase-checkpoint-observer.ts"),
        "phaseCheckpointLifecycleSourceHash": digest(pipeline_path),
        "phaseCheckpointLifecycleAnchors": lifecycle_anchors,
        "adapterHash": digest(destination / "experiment-audit-adapter.ts"),
        "benchmarkShellHash": digest(target / "benchmark.sh"),
        "validators": validator_hashes,
        "lockfileSha256": digest(target / "bun.lock") if (target / "bun.lock").exists() else None,
        "packageJsonSha256": digest(target / "package.json"),
        "dependencyResolution": json.loads((target / "experiment-dependencies-provenance.json").read_text()) if (target / "experiment-dependencies-provenance.json").exists() else {"status": "not captured; local smoke dependencies only"},
    }
    (target / "experiment-harness-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return provenance


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--controller", type=pathlib.Path, required=True)
    parser.add_argument("--target", type=pathlib.Path, required=True)
    parser.add_argument("--expected-sha", required=True)
    args = parser.parse_args()
    result = prepare(args.controller, args.target, args.expected_sha)
    print(json.dumps({key: result[key] for key in ["checkoutSha", "officialHarnessHash", "adaptedHarnessHash", "adapterHash", "lockfileSha256", "packageJsonSha256"]}, sort_keys=True))


if __name__ == "__main__":
    main()
