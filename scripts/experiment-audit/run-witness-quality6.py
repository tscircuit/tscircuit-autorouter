#!/usr/bin/env python3
"""Three predeclared developmental quality pairs. No full-population or speed claim."""
import argparse
import copy
import hashlib
import importlib.util
import inspect
import json
import math
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / 'witness-quality6-20261029.json'
AUTHORITY = ROOT / 'bottleneck-experiments-20261029.json'
WORKFLOW = ROOT.parent.parent / '.github/workflows/witness-quality6-20261029.yml'
BRANCH = 'codex/witness-quality6-controller-20261029'
CAMPAIGN = 'witness-quality6-repeat-20261029'
CASES = [('srj24', 8, 'AB'), ('srj18', 3, 'BA'), ('srj24', 14, 'AB')]
CANDIDATE = '2109f9e96957c06f23aef2b079f6d59fba23ea52'
CANDIDATE_TREE = '83d39c038ba8bdbb01fc53728e5069fd594d2d23'
STAGE = 'witnessViaPadRepairSolver'
PATHS = [STAGE + suffix for suffix in ['.stats', '.qualification', '.stats.reasons.0', '.stats.lastRejectionReasons.0']]
QUAL_KEYS = {'status', 'initialForeignViaPadFindings', 'lastForeignViaPadFindings', 'bestForeignViaPadFindings', 'proposals', 'accepted', 'rejectionClass', 'protectedUnchanged', 'lastReferenceErrors', 'lastSrjObstacleViolations', 'lastViaPadPolicyViolations', 'lastViaInPadViolations', 'lastProofReasonCount', 'lastX', 'lastY', 'initialCertificateStatus'}
RECEIPTS = {
    'witness-quality6-source-qa.json': 'dbfc5a426f57c1c2bc19783ae98e8e14edaab01d8f0ed5402cb29867bfd337d2',
    'witness-quality6-source-review.json': '2107a17d824431032e900c147771baf45163f24fc89fe63bf9d16c5b4be059a2',
    'witness-quality6-source-publication.json': '4be1c3334486dbaa7a6373ed7aec6747136f92a0149ee050e61f4d09fc3c7205',
}
RESULT = 'WITNESS_QUALITY6_RESULT_JSON '
ACTIVE = 'WITNESS_QUALITY6_ACTIVE_JSON '
SUMMARY = 'WITNESS_QUALITY6_SUMMARY_JSON '
NEW_ASSETS = {'run-witness-quality6.py', 'witness-quality6-raw-proof.py', 'seal-witness-quality6-manifest.py', 'witness-quality6-artifact-carrier.py', 'tests/witness-quality6-integrity.py', 'tests/witness-quality6-raw-binding-integrity.py', 'tests/witness-quality6-observer-integrity.ts', 'tests/witness-quality6-source-unknown-capture.ts', 'tests/witness-quality6-alias-mask-integrity.py', 'tests/witness-quality6-terminal-projection-integrity.py', 'tests/fixtures/witness-quality6-source-unknown.json', 'tests/witness-quality6-artifact-carrier-integrity.py', *RECEIPTS}


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


common = load('witness_frozen_runtime', 'run-bottleneck-experiments.py')
require, exact, sha = common.require, common.exact, common.sha
MAIN, SOLVER, MODULE, CHECKS, declared = common.MAIN, common.SOLVER, common.MODULE, common.CHECKS, common.declared
finite, digest = common.finite, common.digest


def obj(value):
    return value if isinstance(value, dict) else {}


def assets():
    return set(common.ASSETS) | NEW_ASSETS


def policy():
    return {
        'scope': 'Fresh repeat of the same three selected development cases after the raw via inventory refinement; not held out and not a full dataset sweep. All six new attempts and all six prior attempts remain separate; no timing pool or new unique-board credit.',
        'quality': 'Strict source/input/runtime provenance plus independent unchanged seven-predicate original-owner and supplemental qualification. ACCEPTED additionally requires independent raw coordinate-only coupled-site mask and protected invariance; pinned source acceptance proves its full final certificate branch.',
        'noProposal': 'NO_PROPOSAL, including initial UNKNOWN or unrelated FAIL, requires exact raw output/copper and nonclock seven-report/owner parity; UNKNOWN is not certified PASS.',
        'failure': 'Attempted exhaustion/errors/timeouts remain failures. Definite rejected witness reduction is a component diagnostic with no final quality credit.',
        'clock': 'Every attempt retains constructorTimeMs, official solve elapsedTimeMs and fresh external wall; primary clock is constructor plus official solve. Own case/job pair only. No speed, held-out or general regression claim.',
        'deadline': 'Unchanged native solve360s after constructor and original outer process480s. Search and certification share this deadline; no reset, second solve or fallback.',
        'transport': 'Only exact authenticated original API server ZIP bytes reconstructed from authenticated successful carrier jobs qualify raw evidence. Inner/shadow/repacked ZIPs are not authority.',
        'commonWork': 'Compare every named synchronous native phase event/iteration fact before the added final stage. Only the final baseline empty phase-setup dispatch is accounted separately after both full logs prove the same explicit penultimate null event followed by successful solve_exit; every named work row stays. Clocks and new-stage work remain separate.',
    }


def validate():
    m = json.loads(MANIFEST.read_text())
    a = common.validate_manifest(AUTHORITY)
    require(m.get('campaign') == CAMPAIGN and m.get('repository') == 'tscircuit/tscircuit-autorouter' and m.get('controllerBranch') == BRANCH, 'Wrong targeted campaign/branch')
    require([(x.get('dataset'), x.get('sample'), x.get('order')) for x in m.get('cases', [])] == CASES, 'Exact cases/order required')
    require(m.get('plannedAttempts') == 6 and type(m.get('plannedAttempts')) is int and m.get('plannedJobs') == 3 and type(m.get('plannedJobs')) is int, 'Exactly six attempts in three jobs required')
    require(m.get('baselineSha') == MAIN and m.get('baselineTree') == common.MAIN_TREE and m.get('harnessSha') == MAIN, 'Baseline/harness pin changed')
    require(m.get('sampleTimeoutSeconds') == 360 and m.get('externalControllerGuardSeconds') == 480 and all(type(m.get(k)) is int and m[k] == 1 for k in ['threads', 'concurrency', 'effort']), 'Native budgets changed')
    require(m.get('freshProcessPerAttempt') is True and m.get('sourceIsCurrentPrHead') is False and m.get('heldOut') is False and m.get('fullPopulationSweep') is False and m.get('speedClaim') is False and m.get('candidateFallback') is False, 'Targeted/no-fallback policy changed')
    require(m.get('inheritedControllerLocal') == '105b4d11e770cf5bc9371a0e411ab628cd921e44' and m.get('inheritedControllerTree') == '886e9c86dac6862506166c53e2951732d51b2aeb' and m.get('expectedRemoteParent') == 'd8e7dc203691d037aedcf3e2ed23050554563f9f', 'Repeat controller base changed')
    require(m.get('repeatOf') == {'runId': '40964225540', 'controllerSha': 'd8e7dc203691d037aedcf3e2ed23050554563f9f', 'manifestSha256': 'e1878100444cbebeb189a60bf2cc979e5df8bed7a114932cb607a75926fe7ba1', 'candidateSha': '0df00ca0e6003dd679d3c1158b91c1ed2d66518b'}, 'Original six-attempt authority changed')
    require(m.get('priorBaselinesReused') is False and m.get('timingsPooledWithPriorCampaigns') is False and m.get('uniqueBoardDenominatorIncrease') is False, 'Repeat requires fresh own baselines and separate evidence')
    item = m.get('candidate', {})
    require(item.get('id') == 'witness-via-pad' and item.get('candidateSha') == CANDIDATE and item.get('candidateTree') == CANDIDATE_TREE and item.get('solverName') == SOLVER and item.get('solverModule') == MODULE, 'Published candidate changed')
    require(exact(item.get('options'), {'cacheProvider': None, 'effort': 1, 'experimentWitnessViaPadRepair': True}) and item.get('evidencePaths') == PATHS and item.get('optionalEvidencePaths') == PATHS[2:], 'Feature/options/evidence changed')
    require(m.get('authoritySha256') == sha(AUTHORITY) and m.get('workflowSha256') == sha(WORKFLOW), 'Authority/workflow changed')
    require(set(m.get('runtimeSourceHashes', {})) == assets() and all(sha(ROOT / n) == h for n, h in m['runtimeSourceHashes'].items()), 'Controller helper bytes changed')
    require(m.get('runSampleSourceSha256') == hashlib.sha256(inspect.getsource(common.pinned.run_sample).encode()).hexdigest(), 'Native run_sample changed')
    require(m.get('sourceReceiptHashes') == RECEIPTS and all(sha(ROOT / n) == h for n, h in RECEIPTS.items()), 'Qualified source receipts changed')
    publication = json.loads((ROOT / 'witness-quality6-source-publication.json').read_text())
    require(publication.get('remoteSha') == CANDIDATE and publication.get('tree') == CANDIDATE_TREE and publication.get('parentRemote') == '0df00ca0e6003dd679d3c1158b91c1ed2d66518b', 'Published source lineage changed')
    require(all(x.get('inputHash') == a['expectedInputHashesByDataset'][x['dataset']][str(x['sample'])] for x in m['cases']), 'Selected original input changed')
    require(exact(m.get('policy'), policy()), 'Predeclared quality/clock/transport policy changed')
    return m, a


def select_case(m, dataset, sample):
    case = next((x for x in m['cases'] if (x['dataset'], x['sample']) == (dataset, sample)), None)
    require(case is not None, 'Outside predeclared three-case scope')
    return case


def metadata(m, case, arm):
    return {'campaign': f"{CAMPAIGN}:{case['dataset']}:{case['sample']}:{case['order']}", 'experiment': 'witness-via-pad', 'dataset': case['dataset'], 'round': 1, 'sampleNumber': case['sample'], 'arm': arm, 'executionOrder': case['order'], 'requestedOptions': m['candidate']['options'] if arm == 'B' else {'cacheProvider': None, 'effort': 1}}


def expected_cp(m, case, arm, run_id, controller):
    require(arm in 'AB' and isinstance(run_id, str) and re.fullmatch(r'[1-9][0-9]*', run_id) and common.digest(controller), 'Run/head/arm missing')
    return {'campaign': metadata(m, case, arm)['campaign'], 'arm': arm, 'algorithmSha': MAIN if arm == 'A' else CANDIDATE, 'dataset': case['dataset'], 'originalSample': case['sample'], 'inputSha256': case['inputHash'], 'observerSourceSha256': m['runtimeSourceHashes']['phase-checkpoint-observer.ts'], 'executionOrder': case['order'], 'githubRunId': run_id, 'controllerSha': controller}


def feature_coverage(record, item):
    terminal = obj(obj(obj(record.get('official')).get('routingMetrics')).get('experimentAudit')).get('evidence')
    terminal = obj(terminal)
    last = obj(obj(record.get('phaseCheckpointAudit')).get('lastDurableCheckpoint'))
    evidence = terminal if terminal else obj(last.get('evidence'))
    stage_complete = any(x.get('phaseName') == STAGE and x.get('event') == 'on_solved_exit' for x in obj(record.get('phaseCheckpointAudit')).get('stageBoundaries', []))
    stats, q = evidence.get(PATHS[0]), evidence.get(PATHS[1])
    problems = []
    if record['arm'] == 'A':
        if any(v is not None for v in evidence.values()): problems.append('Legacy baseline unexpectedly exposes feature state')
        return {'state': 'FEATURE_ABSENT', 'stageCompleted': False, 'issues': problems, 'qualityCredit': False}
    if stage_complete or obj(record.get('official')).get('didSolve') is True:
        if not isinstance(stats, dict) or not isinstance(q, dict): problems.append('Completed final stage lacks required stats/qualification')
    if q is not None:
        if not isinstance(q, dict) or set(q) != QUAL_KEYS:
            problems.append('Qualification must retain all16 flat fields')
        else:
            for k in ['proposals', 'accepted']:
                if type(q.get(k)) is not int or q[k] < 0: problems.append('Invalid qualification counter: ' + k)
            # Frozen source uses -1 only when its unsupported structural pregate
            # deliberately did not execute reference checking. Retain UNKNOWN;
            # this is never zero findings, a performed check, or acceptance.
            unperformed_reference = (
                q.get('status') == 'NO_PROPOSAL' and q.get('initialCertificateStatus') == 'UNKNOWN'
                and q.get('proposals') == 0 and q.get('accepted') == 0
                and all(q.get(k) is None for k in ['initialForeignViaPadFindings', 'lastForeignViaPadFindings', 'bestForeignViaPadFindings', 'lastX', 'lastY'])
                and q.get('rejectionClass') == 'UNSUPPORTED_PROOF' and q.get('protectedUnchanged') is True
                and all(q.get(k) == 0 for k in ['lastSrjObstacleViolations', 'lastViaPadPolicyViolations', 'lastViaInPadViolations'])
                and type(q.get('lastProofReasonCount')) is int and q['lastProofReasonCount'] > 0
                and obj(stats).get('activated') is True and obj(stats).get('status') == 'NO_PROPOSAL'
                and all(obj(stats).get(k) == 0 for k in ['proposalCount', 'acceptedCandidateCount', 'demandsChecked', 'initialCopperFindingCount'])
                and obj(stats).get('certificateChecks') == 1 and obj(stats).get('initialCertificateStatus') == 'UNKNOWN'
                and type(obj(stats).get('initialReferenceErrorCount')) is int and obj(stats).get('initialReferenceErrorCount') == -1
                and type(obj(stats).get('initialCopperFindingCount')) is int and obj(stats).get('initialOwnershipCoverage') == 'UNKNOWN'
            )
            for k in ['initialForeignViaPadFindings', 'lastForeignViaPadFindings', 'bestForeignViaPadFindings', 'lastReferenceErrors', 'lastSrjObstacleViolations', 'lastViaPadPolicyViolations', 'lastViaInPadViolations', 'lastProofReasonCount']:
                sentinel = k == 'lastReferenceErrors' and type(q.get(k)) is int and q[k] == -1 and unperformed_reference
                if q.get(k) is not None and (type(q[k]) is not int or q[k] < 0) and not sentinel: problems.append('Invalid nullable performed-check count: ' + k)
            if q.get('initialCertificateStatus') not in ['PASS', 'FAIL', 'UNKNOWN']: problems.append('Invalid initial certificate status')
            if type(q.get('proposals')) is int and q['proposals'] > 16 or type(q.get('accepted')) is int and q['accepted'] > 1: problems.append('Planned search bound exceeded')
            if isinstance(stats, dict):
                if stats.get('activated') is not True or stats.get('proposalCount') != q.get('proposals') or stats.get('acceptedCandidateCount') != q.get('accepted'): problems.append('Stats/qualification activation or counters differ')
                if any(type(stats.get(k)) is not int or stats[k] < 0 for k in ['proposalCount', 'acceptedCandidateCount', 'certificateChecks', 'demandsChecked']): problems.append('Invalid main-stage counters')
            if stage_complete and (q.get('status') not in ['NO_PROPOSAL', 'ACCEPTED'] or obj(stats).get('status') != q.get('status')): problems.append('Completed stage has nonterminal/inconsistent status')
            if q.get('status') == 'SEARCH_EXHAUSTED' and obj(record.get('official')).get('didSolve') is True: problems.append('Attempted search failure relabeled solved')
            if q.get('status') == 'ACCEPTED' or q.get('accepted') == 1:
                zero_keys = ['lastForeignViaPadFindings', 'lastReferenceErrors', 'lastSrjObstacleViolations', 'lastViaPadPolicyViolations', 'lastViaInPadViolations', 'lastProofReasonCount']
                if q.get('status') != 'ACCEPTED' or q.get('accepted') != 1 or q.get('initialCertificateStatus') != 'FAIL' or type(q.get('initialForeignViaPadFindings')) is not int or q['initialForeignViaPadFindings'] <= 0 or q.get('bestForeignViaPadFindings') != 0 or q.get('rejectionClass') != 'NONE' or q.get('protectedUnchanged') is not True or not all(q.get(k) == 0 for k in zero_keys) or q.get('proposals', 0) < 1 or q.get('proposals', 0) > 16 or not all(type(q.get(k)) in [int, float] and math.isfinite(q[k]) for k in ['lastX', 'lastY']): problems.append('Accepted qualification contradicts pinned final certificate branch')
            if q.get('status') == 'NO_PROPOSAL' and (q.get('accepted') != 0 or q.get('proposals') != 0 or q.get('protectedUnchanged') is not True): problems.append('No-proposal state attempted/mutated search')
    for path in PATHS[2:]:
        if evidence.get(path) is not None and not isinstance(evidence[path], str): problems.append('Optional reason must be absent/null/string')
    state = obj(q).get('status', 'STAGE_NOT_OBSERVED')
    return {'state': state, 'stageCompleted': stage_complete, 'qualification': q, 'stats': stats, 'optionalReasons': {p: evidence.get(p) for p in PATHS[2:]}, 'sourceFinalCertificatePassBranch': state == 'ACCEPTED' and not problems, 'issues': problems, 'qualityCredit': False}


def qualify(record, m, a, case, arm, run_id, controller):
    cp = obj(record.get('phaseCheckpointAudit')); last = obj(cp.get('lastDurableCheckpoint'))
    require(all(exact(record.get(k), v) for k, v in metadata(m, case, arm).items()), 'Record case/order/options differ')
    require(record.get('sha') == (MAIN if arm == 'A' else CANDIDATE) and record.get('expectedInputHash') == case['inputHash'], 'Record source/input differs')
    require(cp.get('errors') == [] and all(exact(last.get(k), v) for k, v in expected_cp(m, case, arm, run_id, controller).items()), 'Checkpoint run/source/input/order unbound')
    require(last.get('observedObjectPath') == 'solver' and last.get('observedConstructorName') == SOLVER and last.get('actualCacheProviderState') == 'disabled' and exact(last.get('observedRequestedOptions'), record['requestedOptions']), 'Actual constructor/options differ')
    qualify_record(record, a, m['candidate'])
    record['durableTimeoutSourceQualification'] = common.timeout_checkpoint_qualification(record)
    return record


def source_qualified(record):
    gaps = {'Actual factory input/options/cache identity unproven', 'Actual solver/sample/deadline identity differs', 'Timing observations missing'}
    return not record.get('qualityQualificationError') and (record.get('strictIntegrityQualified') is True or (obj(record.get('durableTimeoutSourceQualification')).get('sourceAndInputProvenByBoundedCheckpoints') is True and set(record.get('strictIntegrityIssues', [])) == gaps))


def output_hashes(record):
    audit = obj(obj(obj(record.get('official')).get('routingMetrics')).get('experimentAudit'))
    return {**{k: audit.get(k) for k in ['rawOutputHash', 'rawNewTracesHash']}, 'canonicalCopper': obj(record.get('supplemental')).get('canonicalCircuitJsonSha256'), 'findingInventory': obj(record.get('declaredIntentCopper')).get('findingInventorySha256')}


def reports(record):
    supp = obj(record.get('supplemental'))
    return {'supplemental': {k: supp.get(k) for k in CHECKS}, 'declared': record.get('declaredIntentCopper'), 'physicalCopper': supp.get('physicalCopper')}


def summarize(records, case):
    index = {r['arm']: r for r in records}
    complete = len(records) == len(index) == 2 and set(index) == set('AB')
    observed = {arm: {'sourceQualified': source_qualified(r), 'strict': r.get('strictIntegrityQualified') is True, 'official': {k: obj(r.get('official')).get(k) for k in ['didSolve', 'didTimeout', 'relaxedDrcPassed']}, 'feature': r.get('featureCoverage'), 'reports': reports(r), 'hashes': output_hashes(r), 'constructorPlusSolveMs': obj(r.get('official')).get('elapsedTimeMs') + obj(obj(obj(r.get('official')).get('routingMetrics')).get('experimentAudit')).get('constructorTimeMs') if all(finite(v) for v in [obj(r.get('official')).get('elapsedTimeMs'), obj(obj(obj(r.get('official')).get('routingMetrics')).get('experimentAudit')).get('constructorTimeMs')]) else None, 'externalProcessWallMs': r.get('externalBenchmarkProcessWallMs')} for arm, r in index.items()}
    state = obj(obj(index.get('B')).get('featureCoverage')).get('state')
    no_op = state == 'NO_PROPOSAL'
    parity = complete and exact(output_hashes(index['A']), output_hashes(index['B'])) and exact(reports(index['A']), reports(index['B']))
    return {'campaign': CAMPAIGN, 'case': case, 'recordCount': len(records), 'expectedRecords': 2, 'populationComplete': complete, 'sourceQualifiedRecordCount': sum(source_qualified(r) for r in records), 'attempts': observed, 'candidateState': state, 'noProposalHashAndReportParity': parity if no_op and complete else None, 'candidateIndependentPhysicalClean': common.physical_clean(index['B']) if 'B' in index else False, 'rawPairProofRequired': True, 'qualityStatus': 'PENDING_ORIGINAL_API_ZIP_RAW_PAIR_QUALIFICATION', 'wholeOutputQualityCredit': False, 'speedClaim': False, 'heldOut': False, 'fullPopulationSweep': False, 'timingsPooledAcrossJobs': False}



def qualify_record(record, manifest, item):
    problems = []
    row = record.get("official") or {}
    metrics = row.get("routingMetrics")
    if metrics is not None and not isinstance(metrics, dict):
        problems.append("Official routing metrics are not a nullable object")
    observed_audit = metrics.get("experimentAudit") if isinstance(metrics, dict) else None
    if observed_audit is not None and not isinstance(observed_audit, dict):
        problems.append("Actual factory audit is not an object")
    audit = observed_audit if isinstance(observed_audit, dict) else {}
    options = manifest["baseline"]["options"] if record["arm"] == "A" else item["options"]
    if not exact(record.get("requestedOptions"), options):
        problems.append("Record requested options differ from manifest")
    if not audit or audit.get("inputHash") != record["expectedInputHash"] or audit.get("inputMutated") is not False or not exact(audit.get("options"), options) or audit.get("actualCacheProviderState") != "disabled":
        problems.append("Actual factory input/options/cache identity unproven")
    expected_sha = MAIN if record["arm"] == "A" else item["candidateSha"]
    if record.get("sha") != expected_sha or audit.get("actualConstructorName") != SOLVER or audit.get("actualSolverName") != SOLVER or audit.get("solverModule") != MODULE or row.get("solverName") != SOLVER or row.get("sampleNumber") != record["sampleNumber"] or row.get("sampleTimeoutMs") != 360000:
        problems.append("Actual solver/sample/deadline identity differs")
    if any(type(row.get(k)) is not bool for k in ["didSolve", "didTimeout", "relaxedDrcPassed"]) or (audit.get("solverSolved") is True and audit.get("solverFailed") is True):
        problems.append("Invalid typed official outcome or contradictory actual state")
    observed = audit.get("evidence") or {}
    baseline_values = list(observed.values())
    if row.get("didSolve") is True and (set(observed) != set(item["evidencePaths"]) or (record["arm"] == "A" and any(value is not None for value in baseline_values))):
        problems.append("Actual terminal experiment evidence path population or legacy-A feature absence differs")
    if record.get("controllerError") or record.get("supplementalValidationError") or record.get("declaredIntentValidationError"):
        problems.append("Controller or supplemental validation failed")
    actual_runtime = record.get("officialReportRuntime") or {}
    if any(type(actual_runtime.get(k)) is not int or actual_runtime[k] != 1 for k in ["threadsPerSample", "effectiveThreadsPerSample", "cpuBudgetPerSample", "requestedConcurrency", "workerCount"]) or actual_runtime.get("bunVersion") != "1.4.2":
        problems.append("Actual official Bun/thread/concurrency runtime differs from the fixed protocol")
    if not all(finite(v) for v in [row.get("elapsedTimeMs"), audit.get("constructorTimeMs"), record.get("externalBenchmarkProcessWallMs")]):
        problems.append("Timing observations missing")
    elif record["externalBenchmarkProcessWallMs"] + .001 < row["elapsedTimeMs"] + audit["constructorTimeMs"]:
        problems.append("External wall shorter than primary clocks")
    if row.get("didSolve") is True:
        supplemental = record.get("supplemental") or {}
        if audit.get("solverSolved") is not True or audit.get("solverFailed") is not False or audit.get("solverError") is not None or row.get("didTimeout") is not False:
            problems.append("Solved result contradicts actual terminal state")
        if not all(digest(audit.get(k), 64) for k in ["rawOutputHash", "rawNewTracesHash"]) or not digest(supplemental.get("canonicalCircuitJsonSha256"), 64):
            problems.append("Solved result missing actual output/canonical copper hashes")
        for name in CHECKS:
            check = supplemental.get(name, {})
            if type(check.get("count")) is not int or check["count"] < 0 or not isinstance(check.get("byType"), dict) or any(type(v) is not int or v < 0 for v in check.get("byType", {}).values()) or sum(check.get("byType", {}).values()) != check.get("count"):
                problems.append("Supplemental findings population invalid: " + name)
        problems.extend(declared.validate_compact(record, manifest))
        copper = supplemental.get("physicalCopper") or {}
        if any(type(copper.get(k)) is not int or copper[k] < 0 for k in ["combinedRouteViaCount", "uniqueOwnedViaSiteSpanCount", "uniqueOwnedManufacturedViaSiteCount", "foreignOwnerCoincidentViaSiteSpans", "combinedRoutePointCount"]) or any(not finite(copper.get(k)) for k in ["combinedCopperLength", "exactSegmentDeduplicatedCopperLength"]):
            problems.append("Physical copper counts/lengths are not finite typed nonnegative metrics")
    if record.get("phaseCheckpointAudit", {}).get("errors"):
        problems.extend(record["phaseCheckpointAudit"]["errors"])
    record["featureCoverage"] = feature_coverage(record, item)
    problems.extend(record["featureCoverage"]["issues"])
    record["strictIntegrityIssues"] = problems
    record["strictIntegrityQualified"] = not problems
    return record



def run(args, m, a):
    case = select_case(m, args.dataset, args.sample); item = m['candidate']; output = args.output.resolve()
    require(not output.exists() or not any(output.iterdir()), 'Fresh output required')
    checkouts = {'A': args.baseline.resolve(), 'B': args.candidate.resolve()}
    common.verify_checkouts(a, item, checkouts); common.verify_dependencies(a, checkouts)
    identities = {arm: common.pinned.read_identity(path, args.dataset) for arm, path in checkouts.items()}
    require(exact(identities['A'], identities['B']) and {str(x['sampleNumber']): x['inputHash'] for x in identities['A']} == a['expectedInputHashesByDataset'][args.dataset], 'Original full catalog identity changed')
    identity = next(x for x in identities['A'] if x['sampleNumber'] == args.sample)
    require(identity['inputHash'] == case['inputHash'], 'Selected original input changed')
    harnesses = {arm: json.loads((path / 'experiment-harness-provenance.json').read_text()) for arm, path in checkouts.items()}
    for arm, h in harnesses.items():
        require(h.get('checkoutSha') == (MAIN if arm == 'A' else CANDIDATE) and h.get('validators') == a['expectedValidatorHashes'] and all(h.get(k) == v for k, v in a['expectedHarnessSourceHashes'].items()), 'Harness/validator bytes changed')
    common.pinned.write_json(output / 'provenance.json', {'manifest': m, 'manifestSha256': sha(MANIFEST), 'case': case, 'inputIdentity': identity, 'harnesses': harnesses, 'dependencyComparison': common.pinned.compare_dependency_resolutions(harnesses), 'githubRunId': os.environ.get('GITHUB_RUN_ID'), 'controllerSha': os.environ.get('GITHUB_SHA'), 'runAttempt': os.environ.get('GITHUB_RUN_ATTEMPT')})
    records = []
    for arm in case['order']:
        cp = expected_cp(m, case, arm, os.environ.get('GITHUB_RUN_ID'), os.environ.get('GITHUB_SHA'))
        config = dict(a['baseline'], evidencePaths=PATHS) if arm == 'A' else dict(item)
        config.update(phaseCheckpoint=cp)
        config_path = output / f'config-{arm}.json'; common.pinned.write_json(config_path, config)
        meta = metadata(m, case, arm); print(ACTIVE + json.dumps(meta), flush=True)
        target = output / 'pair-1' / arm
        record = common.pinned.run_sample(checkouts[arm], config_path, target, args.dataset, args.sample, 360)
        record.update(meta, qualificationMode='targeted-quality6', scenarioName=identity['scenarioName'], expectedInputHash=identity['inputHash'], sha=cp['algorithmSha'], solverName=SOLVER)
        declared.qualify_output(record, target, checkouts[arm], a, ROOT, common.pinned.execute_with_deadline)
        record['phaseCheckpointAudit'] = common.checkpoint_audit(target / 'raw', cp)
        try: qualify(record, m, a, case, arm, os.environ.get('GITHUB_RUN_ID'), os.environ.get('GITHUB_SHA'))
        except Exception as error:
            record['qualityQualificationError'] = str(error); record['strictIntegrityQualified'] = False; record['strictIntegrityIssues'] = ['Quality attempt qualification failed: ' + str(error)]
        records.append(record); common.pinned.write_json(target / 'audit-result.json', record)
        with (output / 'results.jsonl').open('a') as stream: stream.write(json.dumps(record) + '\n')
        print(RESULT + json.dumps(record, separators=(',', ':')), flush=True)
        common.pinned.write_json(output / 'summary.json', summarize(records, case))
    summary = summarize(records, case); common.pinned.write_json(output / 'summary.json', summary)
    print(SUMMARY + json.dumps(summary, separators=(',', ':')), flush=True)
    require(summary['populationComplete'] and summary['sourceQualifiedRecordCount'] == 2, 'Source qualification failed; both raw attempts retained')


def parse_log(text, m, a, case, run_id, controller):
    rows, active, summaries = [], [], []
    for line in text.splitlines():
        line = re.sub(r'^\ufeff?(?:\d{4}-\d{2}-\d{2}T\S+Z\s+)?', '', line)
        for prefix, target in [(RESULT, rows), (ACTIVE, active), (SUMMARY, summaries)]:
            if line.startswith(prefix): target.append(json.loads(line[len(prefix):]))
    require([r.get('arm') for r in rows] == list(case['order']) and len(summaries) == 1, 'Exact two records in declared order and one summary required')
    require(exact(active, [metadata(m, case, arm) for arm in case['order']]), 'Active/retained population differs')
    for record, arm in zip(rows, case['order']):
        replay = copy.deepcopy(record)
        try: qualify(replay, m, a, case, arm, run_id, controller)
        except Exception as error:
            replay['qualityQualificationError'] = str(error); replay['strictIntegrityQualified'] = False; replay['strictIntegrityIssues'] = ['Quality attempt qualification failed: ' + str(error)]
        require(all(exact(replay.get(k), record.get(k)) for k in ['strictIntegrityQualified', 'strictIntegrityIssues', 'featureCoverage', 'durableTimeoutSourceQualification', 'qualityQualificationError']), 'Self-reported qualification differs')
    summary = summarize(rows, case)
    require(exact(summary, summaries[0]) and summary['populationComplete'], 'Source population/summary differs')
    return {'schemaVersion': 1, 'campaign': CAMPAIGN, 'runId': str(run_id), 'controllerSha': controller, 'case': case, 'manifestSha256': sha(MANIFEST), 'runtimeSha256': sha(Path(__file__)), 'records': rows, 'summary': summary, 'rawLogSha256': hashlib.sha256(text.encode()).hexdigest(), 'sourceQualified': summary['sourceQualifiedRecordCount'] == 2, 'wholeOutputQualityCredit': False, 'requiresOriginalApiZipRawPairQualification': True}


def main():
    p = argparse.ArgumentParser(); p.add_argument('--mode', choices=['plan', 'select', 'verify-checkouts', 'verify-dependencies', 'run', 'parse'], required=True); p.add_argument('--baseline', type=Path); p.add_argument('--candidate', type=Path); p.add_argument('--dataset', choices=['srj18', 'srj24']); p.add_argument('--sample', type=int); p.add_argument('--output', type=Path); p.add_argument('--job-log', type=Path); p.add_argument('--run-id'); p.add_argument('--controller-sha'); args = p.parse_args()
    m, a = validate()
    if os.environ.get('GITHUB_ACTIONS') == 'true': require(os.environ.get('GITHUB_EVENT_NAME') == 'push' and os.environ.get('GITHUB_REF_NAME') == BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'Only first dedicated reviewed branch push may run')
    if args.mode == 'plan': common.outputs({'matrix': json.dumps({'include': [dict(x, sampleLabel=f"{x['sample']:03d}") for x in m['cases']]}, separators=(',', ':'))}); return
    case = select_case(m, args.dataset, args.sample)
    if args.mode == 'select': common.outputs({'baseline_sha': MAIN, 'candidate_sha': CANDIDATE, 'harness_sha': MAIN})
    elif args.mode == 'verify-checkouts': common.verify_checkouts(a, m['candidate'], {'A': args.baseline.resolve(), 'B': args.candidate.resolve()})
    elif args.mode == 'verify-dependencies': common.verify_dependencies(a, {'A': args.baseline.resolve(), 'B': args.candidate.resolve()})
    elif args.mode == 'parse': require(not args.output.exists(), 'Never overwrite parsed evidence'); common.pinned.write_json(args.output, parse_log(args.job_log.read_text(), m, a, case, args.run_id, args.controller_sha))
    else: run(args, m, a)


if __name__ == '__main__': main()
