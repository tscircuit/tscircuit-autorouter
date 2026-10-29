#!/usr/bin/env python3
"""Strict reports for prespecified refinement and confirmation source matrices."""
from __future__ import annotations

import argparse
import copy
import csv
from contextlib import contextmanager
import hashlib
import gzip
import json
import math
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / 'harness'
sys.path.insert(0, str(HARNESS))
import arm_profiles as profiles
import cpu_resources
import multiarm_ci as controller
import multiarm_summary as summary_math
import summarize as base_summary
import extract_refinement_summary as transport

for module in [profiles, cpu_resources, controller, summary_math, base_summary, transport]:
    if Path(module.__file__).resolve().parent != HARNESS:
        raise RuntimeError(f'Wrong frozen helper module origin: {module.__name__}')

DATASETS = {'srj18': 16, 'srj24': 26}
GIB = 1024 ** 3
CONFIRMATION_TEMPLATE = ROOT / 'confirmation/combined-confirmation.json.in'
CONFIRMATION_TEMPLATE_SHA256 = '611973ae75130fb4dded3a17e8ef3d744270e0a344e9cbad65ca993fe2bf9c95'
LEGAL_CONFIRMATION_TEMPLATE = ROOT / 'confirmation-legal-only/legalization-final-confirmation.json.in'
LEGAL_CONFIRMATION_TEMPLATE_SHA256 = '59fc336f47993d670c15d94a65321bcf8e144c9b80ab1b316a1d1391e22417e6'
REFINEMENT_TEMPLATE = ROOT / 'refine-20261029/full.json.in'
REFINEMENT_TEMPLATE_SHA256 = '49f02e7157657859dce2f377080dabd134c66706a601997dd02feb181856da76'
RETENTION_TEMPLATE = ROOT / 'retention-20261029/full.json.in'
RETENTION_TEMPLATE_SHA256 = '8d30c215e3725d3b7ef51b7dd554bd01c36e2fa73d4e04495560a5146a13a8dd'
INPUT_TEMPLATE = ROOT / 'input-20261029/full.json.in'
INPUT_TEMPLATE_SHA256 = 'e87295a40df2b7c7554567bd8e7497ca1611fdbaccf49ad5a13dbfda16f0ab13'


class EvidenceError(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise EvidenceError(reason)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


@contextmanager
def staged_directory(destination):
    require(not destination.exists(), 'Output must be a fresh directory; preserve existing measured evidence')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.refinement-report-', dir=destination.parent) as temporary:
        staged = Path(temporary) / 'complete-bundle'
        staged.mkdir()
        yield staged
        require(not destination.exists(), 'Output path appeared during report generation')
        staged.rename(destination)


def board_ids(dataset, samples):
    return [f'{dataset}-{sample:03d}' for sample in samples]


def approved_config(path, profile):
    config = profiles.load_config(path)
    require(profile in {'portfolio', 'legalization', 'confirmation', 'legal-confirmation', 'legal-v3', 'legal-v4', 'legal-v5'}, 'Unknown approved matrix profile')
    if profile == 'confirmation':
        require(digest(CONFIRMATION_TEMPLATE) == CONFIRMATION_TEMPLATE_SHA256, 'Confirmation template differs from its predeclared byte hash')
        template = read(CONFIRMATION_TEMPLATE)
    elif profile == 'legal-v5':
        require(digest(INPUT_TEMPLATE) == INPUT_TEMPLATE_SHA256, 'Input-materialization template differs from its predeclared byte hash')
        template = read(INPUT_TEMPLATE)
    elif profile == 'legal-v4':
        require(digest(RETENTION_TEMPLATE) == RETENTION_TEMPLATE_SHA256, 'Retention template differs from its predeclared byte hash')
        template = read(RETENTION_TEMPLATE)
    elif profile == 'legal-v3':
        require(digest(REFINEMENT_TEMPLATE) == REFINEMENT_TEMPLATE_SHA256, 'Refinement template differs from its predeclared byte hash')
        template = read(REFINEMENT_TEMPLATE)
    elif profile == 'legal-confirmation':
        require(digest(LEGAL_CONFIRMATION_TEMPLATE) == LEGAL_CONFIRMATION_TEMPLATE_SHA256, 'Legal-only confirmation template differs from its predeclared byte hash')
        template = read(LEGAL_CONFIRMATION_TEMPLATE)
    else:
        template = read(HARNESS / 'configs' / f'{profile}.json.in')
    require(config.get('name') == template['name'], 'Wrong declared profile name')
    require([arm['id'] for arm in config['arms']] == [arm['id'] for arm in template['arms']], 'Unapproved source-arm profile or order')
    require(config['contrasts'] == template['contrasts'], 'Contrasts differ from the prespecified profile')
    for arm, declared in zip(config['arms'], template['arms']):
        if profiles.SHA_PATTERN.fullmatch(declared['commit']):
            require(arm['commit'] == declared['commit'], f'Historical ref changed for {arm["id"]}')
    require(len(config['arms']) == {'portfolio': 4, 'legalization': 5, 'confirmation': 4, 'legal-confirmation': 3, 'legal-v3': 4, 'legal-v4': 3, 'legal-v5': 2}[profile], 'Unexpected source-arm count for the approved profile')
    if profile in {'confirmation', 'legal-confirmation', 'legal-v3', 'legal-v4', 'legal-v5'}:
        layout = copy.deepcopy(config)
        for arm, declared in zip(layout['arms'], template['arms']):
            arm['commit'] = declared['commit']
        require(layout == template, 'Confirmation settings, roles, order, seed or contrasts differ from the predeclared template')
        require(len({arm['commit'] for arm in config['arms']}) == len(config['arms']), 'Confirmation requires distinct exact source commits')
    return config


def complete_protocol(protocol, expected, label):
    require(protocol.get('complete') is True, f'{label} is incomplete')
    require(protocol.get('expectedCount') == protocol.get('observedCount') == expected, f'{label} does not account for all {expected} records')
    require(protocol.get('missing') == [] and protocol.get('unexpected') == [], f'{label} has missing or unexpected records')
    require(not protocol.get('errors'), f'{label} contains verification errors')


def metadata_gate(payload, config):
    ci, summary = payload['ci'], payload['summary']
    expected = len(config['arms']) * 42
    require(not payload.get('_synthetic'), 'Synthetic fixtures cannot produce measured reports')
    require(ci.get('schemaVersion') == summary.get('schemaVersion') == 2, 'Expected refinement schema version 2')
    require(ci.get('complete') is True, 'Actual complete CI evidence is required')
    require(ci.get('config') == summary.get('configuration') == config, 'Exact approved config/refs differ from measured evidence')
    config_sha = profiles.canonical_sha(config)
    require(ci.get('armConfigSha256') == summary.get('configSha256') == config_sha, 'Arm config fingerprint mismatch')
    require(ci.get('datasets') == DATASETS and ci.get('pipeline') == 9 and ci.get('effort') == 1, 'Wrong pipeline/dataset/effort scope')
    require(ci.get('sampleTimeoutSeconds') == 360 and ci.get('routingThreadsPerSample') == 1, 'Wrong sample timeout or routing thread policy')
    require(ci.get('runtime', {}).get('bun') == '1.4.3', 'Expected Bun 1.4.3')
    require(summary.get('mode') == 'full' and summary.get('resultCount') == expected, 'Expected complete full-pipeline evidence')
    complete_protocol(ci.get('resultProtocol', {}), expected, 'Controller result protocol')
    complete_protocol(summary.get('resultProtocol', {}), expected, 'Summary result protocol')
    deps = ci.get('dependencies', {})
    require(deps.get('lockSha256') == profiles.LOCK_SHA256 and deps.get('sameResolvedTreeForAllArms') is True and deps.get('frozenLockfile') is True, 'Uniform pinned frozen dependency resolution is required')
    require(ci.get('observer', {}).get('workerSha256') == controller.WORKER_SHA256, 'Wrong observer version; do not pool prior rounds')
    require(ci.get('observer', {}).get('problemContextSha256') == digest(HARNESS / 'problem_context.ts'), 'Wrong source-problem observer')
    capacity = cpu_resources.get_cpu_capacity(ci['allowedCpus'], ci.get('cpuMax'))
    require(ci.get('cpuCapacity') == capacity and capacity['effectiveCpuCount'] >= 3, 'CPU capacity is not supported by recorded affinity/quota')
    lanes = 6 if capacity['effectiveCpuCount'] >= 6 else 3
    require(ci.get('concurrency') == lanes and ci.get('sampleCpus') == ci['allowedCpus'][:lanes], 'Incorrect observed CPU/lane selection')
    profiles.validate_cpu_ids(ci['sampleCpus'], lanes, ci['allowedCpus'])
    memory = ci['memory']
    effective = min(memory['MemTotal'], int(ci['memoryMax'])) if ci.get('memoryMax') and str(ci['memoryMax']).isdigit() else memory['MemTotal']
    require(memory['effectiveLimitBytes'] == effective, 'Memory limit contradicts recorded host/cgroup observation')
    policy = controller.select_memory_profile(effective, memory['MemAvailable'])
    require(all(memory.get(key) == value for key, value in policy.items()), 'Memory policy must be the actual capacity-gated 48/64-GiB profile')
    invocation = ci['driverInvocation']
    expected_invocation = {'returnCode': 0, 'concurrency': lanes, 'sampleCpus': ci['sampleCpus'], 'reservationBudgetGiB': policy['reservationBudgetGiB'], 'observedRssGuardGiB': policy['observedRssGuardGiB'], 'memoryProfile': policy['profile'], 'allowHeavyOverlap': True}
    require(all(invocation.get(key) == value for key, value in expected_invocation.items()), 'Driver execution/resource profile does not match controller')
    require(ci.get('childEnvironmentPolicy', {}).get('injectedSolverVariables') == {}, 'Solver mode injection is forbidden')
    arms = {arm['id']: arm for arm in config['arms']}
    records = summary.get('perSampleDiagnostics', [])
    expected_keys = {(arm, dataset, sample) for arm in arms for dataset, size in DATASETS.items() for sample in range(1, size + 1)}
    observed = set()
    require(len(records) == expected, 'Missing per-arm diagnostic records')
    for record in records:
        key = record['arm'], record['dataset'], record['sampleNumber']
        require(key in expected_keys and key not in observed, f'Duplicate or unexpected diagnostic record {key}')
        observed.add(key)
        require(record.get('commit') == arms[key[0]]['commit'] and record.get('source') == arms[key[0]], f'Wrong diagnostic source ref {key}')
    require(observed == expected_keys, 'Expected every arm on all 16+26 boards')
    rows = summary.get('rows', [])
    require(len(rows) == len(arms) * 2, 'Incomplete per-arm summary rows')
    row_keys = set()
    for row in rows:
        key = row['arm'], row['dataset']
        require(key[0] in arms and key[1] in DATASETS and key not in row_keys, 'Unexpected or duplicate arm row')
        row_keys.add(key)
        require(row['source'] == arms[key[0]] and row['count'] == row['expectedCount'] == DATASETS[key[1]] and row['sampleNumbers'] == list(range(1, DATASETS[key[1]] + 1)), 'Incomplete or wrong-ref arm corpus')
        require(row.get('concurrencyValues') == [lanes], 'Per-record concurrency differs from the common profile')
    expected_contrasts = {(contrast['id'], dataset) for contrast in config['contrasts'] for dataset in DATASETS}
    contrasts = summary.get('contrasts', [])
    require(len(contrasts) == len(expected_contrasts), 'Missing direct contrasts')
    observed_contrasts = set()
    by_id = {contrast['id']: contrast for contrast in config['contrasts']}
    for contrast in contrasts:
        key = contrast['id'], contrast['dataset']
        require(key in expected_contrasts and key not in observed_contrasts, 'Unexpected or duplicate direct contrast')
        observed_contrasts.add(key)
        declared = by_id[key[0]]
        require(contrast['before'] == declared['before'] and contrast['after'] == declared['after'], 'Wrong direct contrast endpoints')
        require(contrast['beforeSource'] == arms[declared['before']] and contrast['afterSource'] == arms[declared['after']], 'Wrong exact contrast refs')
        samples = list(range(1, DATASETS[key[1]] + 1))
        require(contrast['matchedCount'] == len(samples) and contrast['matchedSampleNumbers'] == samples, 'Partial direct contrast')
        require([pair['sampleNumber'] for pair in contrast['pairs']] == samples, 'Missing or duplicate contrast sample')
    return {'expectedRecords': expected, 'configSha256': config_sha, 'concurrency': lanes, 'memoryPolicy': policy}


def protocol_archive_gate(artifact, ci, expected_protocol):
    require(ci.get('protocolSha256') == expected_protocol, 'Captured protocol differs from the approved frozen manifest')
    for name, expected in expected_protocol.items():
        require(digest(HARNESS / name) == expected, f'Local frozen protocol byte mismatch: {name}')
    observed = {str(path.relative_to(artifact / 'protocol')) for path in (artifact / 'protocol').rglob('*') if path.is_file()}
    missing = sorted(set(expected_protocol) - observed)
    unexpected = sorted(observed - set(expected_protocol))
    mismatched = sorted(name for name in observed & set(expected_protocol) if digest(artifact / 'protocol' / name) != expected_protocol[name])
    require(not unexpected, f'Unexpected archived protocol files: {unexpected}')
    require(not mismatched, f'Frozen protocol byte mismatch: {mismatched}')
    require(not set(missing) - {'.gitignore'}, f'Missing executable/configuration protocol files: {missing}')
    return {'archiveComplete': not missing, 'missingProtocolFiles': missing,
        'knownNonexecutingProtocolOmissions': missing,
        'unexpectedProtocolFiles': unexpected, 'mismatchedProtocolFiles': mismatched,
        'expectedProtocolFileCount': len(expected_protocol), 'archivedProtocolFileCount': len(observed),
        'measurementFilesAuthenticated': True,
        'scope': 'Every executable/configuration protocol file is present and authenticated. Only protocol/.gitignore may be absent because upload-artifact excludes hidden files. Missing bytes were not recreated or claimed to be archived.'}


def verify_artifact(artifact, payload, config):
    ci = payload['ci']
    frozen = read(ROOT / 'FROZEN_MANIFEST.json')
    require(frozen.get('status') == 'FROZEN' and frozen.get('commonWorkerSha256') == controller.WORKER_SHA256, 'Local trusted harness is not the frozen observer')
    expected_protocol = {path[len('harness/'):]: value for path, value in frozen['files'].items() if path.startswith('harness/')}
    archive = protocol_archive_gate(artifact, ci, expected_protocol)
    require(ci.get('controllerSha256') == digest(HARNESS / 'multiarm_ci.py'), 'Controller byte hash mismatch')
    require(digest(artifact / 'dependencies/bun.lock') == profiles.LOCK_SHA256, 'Actual archived dependency lock bytes mismatch')
    require(digest(artifact / 'dependencies/package.json') == controller.ARCHIVE_MANIFEST_SHA256 == ci['dependencies'].get('archiveManifestSha256'), 'Generating dependency manifest bytes mismatch')
    require(digest(artifact / 'dependencies/resolved-packages.txt') == ci['dependencies'].get('resolvedPackagesSha256'), 'Resolved dependency list bytes mismatch')
    driver = read(artifact / 'metadata.json')
    require(read(artifact / 'matrix-config.json') == config, 'Archived source config differs from approved refs')
    require(driver.get('armConfig') == config and driver.get('armConfigSha256') == profiles.canonical_sha(config), 'Driver config differs from approved matrix')
    require(driver.get('bunVersion') == '1.4.3' and driver.get('workerSha256') == controller.WORKER_SHA256 and driver.get('dependencyLockSha256') == profiles.LOCK_SHA256, 'Driver runtime/worker/dependencies differ')
    require(driver.get('cpuCapacity') == ci['cpuCapacity'] and driver.get('cpuset') == ci['allowedCpus'], 'Driver CPU observations differ from controller')
    require(driver.get('interrupted') is False, 'Driver invocation was interrupted')
    require(set(driver.get('variants', {})) == {arm['id'] for arm in config['arms']}, 'Unexpected driver source arms')
    invocation = ci['driverInvocation']
    expected_args = {'mode': 'full', 'datasets': 'srj18,srj24', 'samples': 'all', 'concurrency': ci['concurrency'],
        'cpus': ','.join(map(str, ci['sampleCpus'])), 'timeout': 360, 'startup_timeout': 120,
        'reservation_budget_gib': invocation['reservationBudgetGiB'], 'memory_guard_gib': invocation['observedRssGuardGiB'],
        'allow_heavy_overlap': True, 'save_output': False, 'max_memory_bypasses': 8}
    require(all(driver.get('args', {}).get(key) == value for key, value in expected_args.items()), 'Driver arguments contradict recorded measurement/resource policy')
    require(driver.get('cpuMax') == ci.get('cpuMax') and driver.get('memoryMax') == ci.get('memoryMax'), 'Driver cgroup observations differ from controller')
    require(driver.get('memoryReservationPolicy', {}).get('budgetBytes') == invocation['reservationBudgetGiB'] * GIB and driver['memoryReservationPolicy'].get('allowHeavyOverlap') is True, 'Driver admission budget/policy differs from controller')
    require(set(ci.get('sourceArms', {})) == {arm['id'] for arm in config['arms']}, 'Controller source-arm provenance missing')
    for arm in config['arms']:
        source = ci['sourceArms'][arm['id']]
        actual = driver['variants'][arm['id']]
        require(all(source.get(key) == value for key, value in arm.items()), f'Controller source ref/mode mismatch: {arm["id"]}')
        require(actual.get('commit') == arm['commit'] and actual.get('role') == arm['role'] and actual.get('dirtyStatus') == '', f'Unclean or wrong driver source: {arm["id"]}')
        for key in ['solverSourceTreeSha256', 'benchmarkSourceTreeSha256', 'routingSourceTreeSha256']:
            require(source.get(key) == actual.get(key) and isinstance(source.get(key), str) and len(source[key]) == 64, f'Source tree mismatch {arm["id"]}/{key}')
    samples = [(dataset, number) for dataset, size in DATASETS.items() for number in range(1, size + 1)]
    queue = profiles.planned_order(samples, [arm['id'] for arm in config['arms']], config['orderSeed'])
    require(driver.get('plannedQueueSha256') == profiles.canonical_sha(queue), 'Planned tuple-queue fingerprint mismatch')
    require(driver.get('plannedQueue') == [{'arm': arm, 'dataset': dataset, 'sampleNumber': number} for arm, dataset, number in queue], 'Saved planned queue differs from seeded rotation')
    fingerprint = {key: driver[key] for key in ['runnerSha256', 'workerSha256', 'problemContextSha256', 'memorySchedulerSha256', 'cpuResourcesSha256', 'memoryReservationPolicy', 'cpuCapacity', 'armConfigSha256', 'dependencyLockSha256', 'plannedQueueSha256', 'childEnvironmentPolicy']}
    fingerprint['settings'] = {key: driver['args'][key] for key in ['concurrency', 'cpus', 'timeout', 'startup_timeout', 'memory_guard_gib', 'mode', 'save_output']}
    fingerprint['sourceArms'] = {arm: {key: value for key, value in record.items() if key in {'commit', 'role'} or key.endswith('SourceTreeSha256')} for arm, record in driver['variants'].items()}
    require(driver.get('measurementProtocolSha256') == profiles.canonical_sha(fingerprint), 'Driver measurement fingerprint mismatch')
    for name, filename in [('runnerSha256', 'run_matrix.py'), ('workerSha256', 'worker.ts'), ('problemContextSha256', 'problem_context.ts'), ('memorySchedulerSha256', 'memory_scheduler.py'), ('cpuResourcesSha256', 'cpu_resources.py')]:
        require(driver.get(name) == digest(HARNESS / filename), f'Driver frozen component mismatch: {name}')
    verified = controller.verify_records(artifact, config, ci)
    require(verified == ci.get('resultProtocol') and verified.get('complete') is True, 'Raw record identities/provenance do not independently verify')
    rebuilt = summary_math.build(artifact, config)
    # The local extraction directory changes only this location label. Never
    # normalize constructor/source hashes, fields, rules or numerical outcomes.
    before, after = copy.deepcopy(rebuilt), copy.deepcopy(payload['summary'])
    before.pop('root', None); after.pop('root', None)
    require(before == after, 'Independent frozen summary differs from decoded measured summary')
    reports = base_summary.read_reports(artifact, 'full')
    for key, record in reports.items():
        slot = record.get('slot')
        require(type(slot) is int and 0 <= slot < ci['concurrency'] and record.get('cpu') == ci['sampleCpus'][slot], f'Per-record pinned CPU/slot mismatch: {key}')
    return verified, rebuilt, reports, driver, archive


def scalar(value):
    return value if summary_math.finite(value) else None


def raw_sample(report):
    result = report['result']
    hd = result.get('highDensity') or {}
    return {
        'arm': report['variant'], 'dataset': report['dataset'], 'sampleNumber': report['sampleNumber'],
        'boardId': f"{report['dataset']}-{report['sampleNumber']:03d}", 'commit': report['commit'],
        'solved': bool(result.get('didSolve')), 'clean': base_summary.clean(report), 'timeout': bool(result.get('didTimeout')),
        'routingMs': result.get('elapsedTimeMs'), 'failurePenalizedMs': base_summary.score_ms(report),
        'drcErrorCount': scalar(result.get('drcErrorCount')), 'drcErrorTypes': result.get('drcErrorTypes'), 'drcErrorMessages': result.get('drcErrorMessages'),
        'hdCompleted': summary_math.hd_completed(report), 'hdMs': base_summary.stage_ms(report, summary_math.HD_STAGE),
        'hdIterations': scalar(hd.get('iterations')), 'pipelineFinalIterations': None,
        'iterationScope': 'Exact reported HD iterations only; final pipeline iterations are not emitted by this observer. Progress counters are not substituted.',
        'peakRssBytes': scalar(result.get('peakRssBytes')), 'viaCount': scalar(result.get('viaCount')), 'wireLengthMm': scalar(result.get('wireLengthMm')),
        'failurePhase': result.get('errorPhaseName'), 'error': result.get('error'), 'outputHash': result.get('outputHash'),
        'sourceProblem': result.get('sourceProblem'), 'rawHdConstructor': result.get('hdInput'),
        'numericDiagnostics': summary_math.diagnostics(report), 'completedStages': sorted(summary_math.completed_stages(report)),
    }


def parity(pairs, getter):
    comparable, equal, different, missing = [], [], [], []
    for before, after in pairs:
        sample = after['sampleNumber']
        left, right = getter(before), getter(after)
        if summary_math.finite(left) and summary_math.finite(right):
            comparable.append(sample)
            (equal if left == right else different).append(sample)
        else:
            missing.append(sample)
    return {'count': len(comparable), 'sampleNumbers': comparable, 'equalSampleNumbers': equal, 'differentSampleNumbers': different, 'missingSampleNumbers': missing}


def enrich_contrast(contrast, reports):
    dataset, before_id, after_id = contrast['dataset'], contrast['before'], contrast['after']
    pairs = [(reports[(before_id, dataset, s)], reports[(after_id, dataset, s)]) for s in contrast['matchedSampleNumbers']]
    new_clean = [a['sampleNumber'] for b, a in pairs if not base_summary.clean(b) and base_summary.clean(a)]
    lost_clean = [a['sampleNumber'] for b, a in pairs if base_summary.clean(b) and not base_summary.clean(a)]
    coverage = {}
    for label, predicate in [('rawConstructor', summary_math.same_hd_input), ('sourceSrj', lambda b, a: summary_math.same_hash(b, a, 'sourceProblem', 'srjSha256'))]:
        selected = [(b, a) for b, a in pairs if predicate(b, a)]
        both = [(b, a) for b, a in selected if summary_math.hd_completed(b) and summary_math.hd_completed(a)]
        coverage[label] = {
            'newHdCompletions': board_ids(dataset, [a['sampleNumber'] for b, a in selected if not summary_math.hd_completed(b) and summary_math.hd_completed(a)]),
            'lostHdCompletions': board_ids(dataset, [a['sampleNumber'] for b, a in selected if summary_math.hd_completed(b) and not summary_math.hd_completed(a)]),
            'hdIterationParity': parity(both, lambda r: scalar((r['result'].get('highDensity') or {}).get('iterations'))),
        }
    solved = [(b, a) for b, a in pairs if b['result'].get('didSolve') and a['result'].get('didSolve')]
    return {'newCleanBoards': board_ids(dataset, new_clean), 'lostCleanBoards': board_ids(dataset, lost_clean),
            'cohortEvents': coverage, 'pairedSolvedDrcErrorCountParity': parity(solved, lambda r: scalar(r['result'].get('drcErrorCount')))}


def csv_file(path, rows):
    require(bool(rows), f'No CSV rows for {path.name}')
    with path.open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator='\n')
        writer.writeheader()
        for row in rows:
            writer.writerow({key: json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) if isinstance(value, (dict, list)) else str(value).lower() if isinstance(value, bool) else value for key, value in row.items()})


def factor(value):
    return f'{value:.3f}×' if summary_math.finite(value) else '—'


def fmt(value, decimals=1):
    return f'{value:,.{decimals}f}' if summary_math.finite(value) else '—'


def movement(comparison, before='beforeSeconds', after='afterSeconds'):
    return f"{fmt(comparison.get(before))} → {fmt(comparison.get(after))}"


def markdown(ci, summary, enriched, archive):
    config = summary['configuration']
    lines = [f"# Refinement matrix: {config['name']}", '',
        f"Verified {summary['resultCount']} fresh-process runs: all 16 dataset 18 and 26 dataset 24 boards in each of {len(config['arms'])} exact source arms. Pipeline 9, effort 1, Bun 1.4.3, one routing thread per sample and a 360-second routing limit.", '',
        f"Resource profile: **{ci['memory']['profile']}**, {ci['concurrency']} pinned sample lanes, CPUs {ci['sampleCpus']}. Every arm shares the pinned `261a3861…` frozen dependency resolution. Planned order uses seed {config['orderSeed']} with shuffled boards and balanced rotating arm order; memory admission can reorder realized starts. This is one exploratory observation per board and arm, without confidence intervals or equal realized co-runner guarantees.", '',
        'This refinement observer records original loaded-SRJ/scenario identity before timing. Its worker/protocol differs from previous rounds, which must remain separate evidence. No solver mode or constructor override was injected.', '',
        '| Arm | Exact measured source | Declared role |', '| --- | --- | --- |']
    if config['name'] in {'combined-refinement-confirmation', 'legalization-final-confirmation'}:
        lines[6] = 'This confirmation reuses the exact frozen refinement observer and measurement helpers. Earlier refinement runs remain separate machine/cohort evidence; elapsed observations are not pooled. No solver mode or constructor override was injected.'
    if config['name'] == 'combined-refinement-confirmation':
        lines[6:6] = ['This matrix compares separate legalization and portfolio source candidates. Neither candidate combines both changes into one pipeline, and measured savings must not be added as a combined result. The source roles and contrasts were declared before measurement.', '']
    if config['name'] == 'legalization-final-confirmation':
        lines[6:6] = ['This legal-only matrix compares the final physical legalization source with the original baseline and the historical full legalizer. The unchanged portfolio candidate is not remeasured. All source roles, contrasts and the new seed were declared before measurement; previous elapsed observations are not pooled.', '']
    if config['name'] == 'portfolio-source-ablation':
        lines[6:6] = ['The portfolio role text is the frozen protocol label. The final eager/lazy sources preserve the legacy A01/A03 candidate eligibility and output contracts; physical width/endpoint policy changes are confined to research-race mode. The eager/lazy contrast measures deferred setup under this shared legacy policy. Route, work and outcome parity are evaluated below and in the paired records.', '']
    if not archive['archiveComplete']:
        lines[6:6] = ['Archive packaging is **incomplete**: `protocol/.gitignore` is absent. All executable/configuration protocol files, dependency lock, exact arm config, raw records and independently rebuilt summary were authenticated. The missing nonexecuting file was not recreated or represented as archived.', '']
    for arm in config['arms']:
        lines.append(f"| `{arm['id']}` | `{arm['commit']}` | {arm['role']} |")
    lines += ['', '| Dataset | Arm | Solved | Clean | Unclean solved | Timeouts | Other fail | Fixed-corpus score, s | Peak RSS, GiB (coverage) |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for row in summary['rows']:
        lines.append(f"| {row['dataset']} | {row['arm']} | {row['solved']}/{row['count']} | {row['clean']}/{row['count']} | {row['uncleanSolved']} | {row['timeouts']} | {row['otherFailures']} | {fmt(row['failurePenalizedSecondsSum'])} | {fmt(row['rss']['maxBytes'] / GIB if row['rss']['maxBytes'] is not None else None, 3)} ({row['rss']['count']}/{row['count']}) |")
    lines += ['', 'The fixed-corpus score uses measured routing time for clean solved boards and 360 seconds for every other outcome. It is a comparison score, not total runner wall time. Clean means the existing benchmark relaxed DRC, not every manufacturing rule. Per-process peak RSS is not simultaneous runner memory or isolated solver memory.', '',
        '| Dataset | Direct contrast | Common-clean routing, s (n) | Board ratio | Strict raw-constructor HD, s (n) | Strict HD ratio | Same loaded-SRJ HD, s (n) | Source-SRJ HD ratio |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for row in summary['contrasts']:
        board, strict, source = row['commonClean'], row['sameRawConstructorCompletedHd'], row['sameSourceSrjCompletedHd']
        lines.append(f"| {row['dataset']} | {row['before']} → {row['after']} | {movement(board)} ({board['count']}) | {factor(board['speedup'])} | {movement(strict)} ({strict['count']}) | {factor(strict['speedup'])} | {movement(source)} ({source['count']}) | {factor(source['speedup'])} |")
    lines += ['', '**The two HD columns answer different questions.** Strict raw-constructor timing requires identical original serialized constructor hashes. Same loaded-SRJ timing requires identical pre-solve source board hashes, but constructor fields or declared physical clearance rules may differ. It is not configuration-equivalent evidence. Scenario hashes are recorded separately and never replace SRJ equality. No fields or hashes were normalized to create a cohort.', '',
        'Both HD timing cohorts require completion on both sides. A partial timeout clock is censored and excluded; recovered or lost completions are listed separately. Common-clean routing excludes changed clean outcomes, so it cannot replace the fixed-corpus score. Ratios above 1 favor the after arm.', '',
        '| Dataset | Contrast | New clean boards | Lost clean boards | New/lost completed HD, strict raw | New/lost completed HD, same SRJ |', '| --- | --- | --- | --- | --- | --- |']
    for row in enriched:
        events = row['reportEvidence']
        raw, source = events['cohortEvents']['rawConstructor'], events['cohortEvents']['sourceSrj']
        show = lambda values: ', '.join(values) or 'none'
        lines.append(f"| {row['dataset']} | {row['id']} | {show(events['newCleanBoards'])} | {show(events['lostCleanBoards'])} | {show(raw['newHdCompletions'])} / {show(raw['lostHdCompletions'])} | {show(source['newHdCompletions'])} / {show(source['lostHdCompletions'])} |")
    lines += ['', '| Dataset | Contrast | Common-clean vias, totals (n) | Finite common-clean wire, mm (n) | Output hashes, equal / known paired-solved | Strict HD iterations, equal / known |', '| --- | --- | ---: | ---: | ---: | ---: |']
    for row in enriched:
        board = row['commonClean']; vias = board['vias']; wire = board['wireLengthMm']
        hashes = row['outputHashMatches']; iterations = row['reportEvidence']['cohortEvents']['rawConstructor']['hdIterationParity']
        lines.append(f"| {row['dataset']} | {row['id']} | {movement(vias, 'beforeSum', 'afterSum')} ({vias['count']}/{vias['eligiblePairCount']}) | {movement(wire, 'beforeSum', 'afterSum')} ({wire['count']}/{wire['eligiblePairCount']}) | {hashes['matchCount']}/{hashes['comparableCount']} | {len(iterations['equalSampleNumbers'])}/{iterations['count']} |")
    lines += ['', 'Quality comparisons use finite values on both sides of the same common-clean cohort; missing wire lengths are never zero-filled. Output/iteration parity reports explicit known coverage and board IDs in the accompanying JSON/CSV. Exact final pipeline iteration counts are not emitted by this observer and remain unavailable. HD iterations are reported only within their stated completed cohort.', '',
        'Raw constructor field/rule declarations and original SRJ rule declarations remain in every paired record. DRC counts/types/messages are retained when emitted; an unmeasured or censored DRC result is unknown, not zero. Diagnostic counter comparisons retain matched/missing coverage separately from all-observed totals. Intermediate proposal-conflict counts are not final-board DRC-error counts.', '',
        'Artifacts: [per-arm summaries](arms.csv), [all arm samples](arm-samples.csv), [direct contrast summaries](contrasts.csv), [all paired contrast samples](contrast-samples.csv), [counter parity](counter-parity.csv), [full contrasts and cohorts](contrasts.json), [phase CSV](phase-costs.csv), [all phase costs and domain notes](phase-costs.json), [verification](report-verification.json).', '']
    run = ci.get('ci', {})
    if run.get('GITHUB_REPOSITORY') and run.get('GITHUB_RUN_ID'):
        lines += [f"Original run: https://github.com/{run['GITHUB_REPOSITORY']}/actions/runs/{run['GITHUB_RUN_ID']} (attempt {run.get('GITHUB_RUN_ATTEMPT', 'unspecified')}).", '']
    return '\n'.join(lines)


def render(artifact, payload_path, config_path, profile, out):
    config = approved_config(config_path, profile)
    payload = read(payload_path)
    metadata = metadata_gate(payload, config)
    verification, summary, reports, driver, archive = verify_artifact(artifact, payload, config)
    samples = [raw_sample(reports[key]) for key in sorted(reports)]
    enriched, contrast_rows, pair_rows, counter_rows, phase_rows = [], [], [], [], []
    sample_map = {(r['arm'], r['dataset'], r['sampleNumber']): r for r in samples}
    arm_rows = []
    summary_rows = {(row['arm'], row['dataset']): row for row in summary['rows']}
    for row in summary['rows']:
        selected = [sample for sample in samples if sample['arm'] == row['arm'] and sample['dataset'] == row['dataset']]
        arm_rows.append({key: row[key] for key in ['dataset', 'arm', 'count', 'solved', 'clean', 'uncleanSolved', 'timeouts', 'otherFailures', 'failurePenalizedSecondsSum', 'solveSecondsSum', 'maxRssBytes', 'rss', 'sourceProblemHashCoverage', 'failurePhaseCounts', 'numericDiagnosticTotals']} | {
            'commit': row['source']['commit'], 'role': row['source']['role'],
            'reportedFinalDrcCounts': {sample['boardId']: sample['drcErrorCount'] for sample in selected if sample['drcErrorCount'] is not None},
            'missingFinalDrcCountBoardIds': [sample['boardId'] for sample in selected if sample['drcErrorCount'] is None],
            'completedHdIterationBoardIds': [sample['boardId'] for sample in selected if sample['hdCompleted'] and sample['hdIterations'] is not None],
            'missingCompletedHdIterations': [sample['boardId'] for sample in selected if sample['hdCompleted'] and sample['hdIterations'] is None],
            'knownSolvedOutputHashBoardIds': [sample['boardId'] for sample in selected if sample['solved'] and sample['outputHash']],
            'missingSolvedOutputHashBoardIds': [sample['boardId'] for sample in selected if sample['solved'] and not sample['outputHash']],
        })
    for contrast in summary['contrasts']:
        evidence = enrich_contrast(contrast, reports)
        enriched.append({**contrast, 'reportEvidence': evidence})
        row = {key: contrast[key] for key in ['id', 'dataset', 'before', 'after', 'matchedCount']}
        row.update(beforeCommit=contrast['beforeSource']['commit'], afterCommit=contrast['afterSource']['commit'],
                   newCleanBoards=evidence['newCleanBoards'], lostCleanBoards=evidence['lostCleanBoards'],
                   commonClean=contrast['commonClean'], sameRawConstructorCompletedHd=contrast['sameRawConstructorCompletedHd'],
                   sameSourceSrjCompletedHd=contrast['sameSourceSrjCompletedHd'], sameSourceScenario=contrast['sameSourceScenario'],
                   outputHashMatches=contrast['outputHashMatches'], cohortEvents=evidence['cohortEvents'],
                   sameUpstreamFailure=contrast['sameUpstreamFailure'], pairedSolvedDrcErrorCountParity=evidence['pairedSolvedDrcErrorCountParity'])
        for side in ['before', 'after']:
            arm_row = summary_rows[(contrast[side], contrast['dataset'])]
            for field in ['solved', 'clean', 'timeouts', 'otherFailures', 'failurePenalizedSecondsSum']:
                row[side + field[0].upper() + field[1:]] = arm_row[field]
        contrast_rows.append(row)
        for cohort in ['matched', 'sameRawConstructorCompletedHd', 'sameSourceSrjCompletedHd', 'commonClean']:
            for counter, values in contrast['diagnosticCounters'][cohort]['matchedCounters'].items():
                counter_rows.append({'contrast': contrast['id'], 'dataset': contrast['dataset'], 'cohort': cohort, 'counter': counter, **values})
        for domain in ['rawConstructor', 'sourceSrj']:
            for clean_only, field in [(False, domain + 'CompletedStageTimes'), (True, domain + 'CommonCleanStageTimes')]:
                for stage, values in contrast[field].items():
                    phase_rows.append({'contrast': contrast['id'], 'dataset': contrast['dataset'], 'domain': domain, 'commonCleanRequired': clean_only, 'stage': stage, **values,
                        **contrast[domain + 'StageCensoring'][stage]})
        for pair in contrast['pairs']:
            s = pair['sampleNumber']; dataset = contrast['dataset']
            before = sample_map[(contrast['before'], dataset, s)]
            after = sample_map[(contrast['after'], dataset, s)]
            values = {'contrast': contrast['id'], 'dataset': dataset, 'boardId': before['boardId'], 'sampleNumber': s,
                'beforeArm': contrast['before'], 'afterArm': contrast['after'],
                'sameRawConstructor': pair['sameRawConstructor'], 'sameSourceSrj': pair['sameSourceSrj'], 'sameSourceScenario': pair['sameSourceScenario'],
                'strictCompletedHdPair': bool(pair['sameRawConstructor'] and pair['beforeHdCompleted'] and pair['afterHdCompleted']),
                'sourceSrjCompletedHdPair': bool(pair['sameSourceSrj'] and pair['beforeHdCompleted'] and pair['afterHdCompleted']),
                'newClean': not before['clean'] and after['clean'], 'lostClean': before['clean'] and not after['clean']}
            for label, sample in [('before', before), ('after', after)]:
                for key in ['commit', 'solved', 'clean', 'timeout', 'routingMs', 'failurePenalizedMs', 'drcErrorCount', 'drcErrorTypes', 'drcErrorMessages', 'hdCompleted', 'hdMs', 'hdIterations', 'pipelineFinalIterations', 'peakRssBytes', 'viaCount', 'wireLengthMm', 'failurePhase', 'error', 'outputHash', 'sourceProblem', 'rawHdConstructor', 'numericDiagnostics']:
                    values[label + key[0].upper() + key[1:]] = sample[key]
                values[label + 'HdTimingState'] = 'completed' if sample['hdCompleted'] else 'censored partial' if sample['hdMs'] is not None else 'not observed'
            values['outputHashesEqualWhenKnownSolved'] = (before['outputHash'] == after['outputHash']) if before['solved'] and after['solved'] and before['outputHash'] and after['outputHash'] else None
            pair_rows.append(values)
    report_verification = {**metadata, 'profile': profile, 'actualComplete': True, 'artifactRoot': str(artifact),
        'frozenManifestSha256': digest(ROOT / 'FROZEN_MANIFEST.json'), 'workerSha256': controller.WORKER_SHA256,
        'dependencyLockSha256': profiles.LOCK_SHA256, 'decodedPayloadSha256': digest(payload_path),
        'rawRecordsIndependentlyVerified': verification, 'independentSummaryMatches': True,
        **archive,
        'sourceArms': ci_source if (ci_source := payload['ci'].get('sourceArms')) else {},
        'measurementProtocolSha256': driver['measurementProtocolSha256'], 'plannedQueueSha256': driver['plannedQueueSha256'],
        'exportCounts': {'armSamples': len(samples), 'armSummaryRows': len(arm_rows), 'contrastRows': len(contrast_rows), 'contrastSamples': len(pair_rows)},
        'scope': 'Trusted frozen helpers independently verified raw records and rebuilt all measured summary math. Only summary.root was omitted from equality comparison because the archive was extracted to a different local path. No source/constructor hashes, fields, rules or numerical outcomes were normalized. No solver execution or publishing occurred.'}
    if profile in {'confirmation', 'legal-confirmation', 'legal-v3', 'legal-v4', 'legal-v5'}:
        report_verification.update(approvedTemplateSha256=INPUT_TEMPLATE_SHA256 if profile == 'legal-v5' else RETENTION_TEMPLATE_SHA256 if profile == 'legal-v4' else CONFIRMATION_TEMPLATE_SHA256 if profile == 'confirmation' else REFINEMENT_TEMPLATE_SHA256 if profile == 'legal-v3' else LEGAL_CONFIRMATION_TEMPLATE_SHA256,
            coordinatorArm='fixed-full' if profile == 'confirmation' else 'refined-full' if profile in {'legal-v3', 'legal-v4', 'legal-v5'} else 'final-full')
    # All final gates precede any report file creation. Extraction can retain
    # incomplete transport evidence separately, but never creates these reports.
    with staged_directory(out) as export:
        (export / 'results.md').write_text(markdown(payload['ci'], summary, enriched, archive))
        csv_file(export / 'arms.csv', arm_rows)
        csv_file(export / 'arm-samples.csv', samples)
        csv_file(export / 'contrasts.csv', contrast_rows)
        csv_file(export / 'contrast-samples.csv', pair_rows)
        if counter_rows:
            csv_file(export / 'counter-parity.csv', counter_rows)
        else:
            (export / 'counter-parity.csv').write_text('contrast,dataset,cohort,counter,count\n')
        if phase_rows:
            csv_file(export / 'phase-costs.csv', phase_rows)
        else:
            (export / 'phase-costs.csv').write_text('contrast,dataset,domain,commonCleanRequired,stage,count\n')
        write(export / 'arms.json', {'configuration': config, 'rows': summary['rows'], 'reportCoverage': arm_rows, 'samples': samples})
        write(export / 'contrasts.json', {'configuration': config, 'contrasts': enriched})
        write(export / 'phase-costs.json', {'configuration': config, 'resources': {'concurrency': metadata['concurrency'], 'memoryPolicy': metadata['memoryPolicy']},
            'arms': [{'dataset': r['dataset'], 'arm': r['arm'], 'source': r['source'], 'rawStageTimes': r['rawStageTimes']} for r in summary['rows']],
            'contrasts': [{key: c[key] for key in ['id', 'dataset', 'beforeSource', 'afterSource', 'rawConstructorCompletedStageTimes', 'sourceSrjCompletedStageTimes', 'rawConstructorCommonCleanStageTimes', 'sourceSrjCommonCleanStageTimes', 'rawConstructorStageCensoring', 'sourceSrjStageCensoring']} for c in summary['contrasts']],
            'domainNotes': ['Stage-specific completed/raw/source-SRJ/common-clean cohorts can differ; exact board IDs are retained.', 'The active censored stage is excluded. Same loaded SRJ does not establish equal derived constructor or physical rules.', 'Planned balanced order does not imply equal realized co-runners; consult events.jsonl. Do not pool resource/observer cohorts.']})
        write(export / 'report-verification.json', report_verification)
    return report_verification


def extract(log, config_path, profile, out):
    text = log.read_text()
    try:
        decoded = json.loads(text)
    except ValueError:
        decoded = None
    def strings(value):
        if isinstance(value, str): return [value]
        if isinstance(value, dict): return [part for child in value.values() for part in strings(child)]
        if isinstance(value, list): return [part for child in value for part in strings(child)]
        return []
    if decoded is not None:
        text = '\n'.join(strings(decoded))
    payload, packed = transport.extract(text)
    metadata_gate(payload, approved_config(config_path, profile))
    with staged_directory(out) as export:
        write(export / 'multiarm-ci-summary.json', payload)
        (export / 'multiarm-ci-summary.json.gz').write_bytes(packed)
        write(export / 'transport-verification.json', {'verificationLevel': 'transport-digests-and-complete-summary-metadata-only', 'gzipSha256': hashlib.sha256(packed).hexdigest(), 'originalPayloadSha256': hashlib.sha256(gzip.decompress(packed)).hexdigest(), 'finalReportProduced': False, 'note': 'Downloaded raw artifact verification and independent summary rebuild are still required before final reports can be produced.'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ['render', 'extract']:
        sub = commands.add_parser(name)
        sub.add_argument('--profile', choices=['portfolio', 'legalization', 'confirmation', 'legal-confirmation', 'legal-v3', 'legal-v4', 'legal-v5'], required=True)
        sub.add_argument('--expected-config', type=Path, required=True)
        sub.add_argument('--out', type=Path, required=True)
        if name == 'render':
            sub.add_argument('--artifact-root', type=Path, required=True)
            sub.add_argument('--payload', type=Path)
        else:
            sub.add_argument('--job-log', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'extract':
            extract(args.job_log, args.expected_config, args.profile, args.out)
            print('Decoded complete metadata/transport evidence only; no final report without raw artifact verification.')
        else:
            payload = args.payload or args.artifact_root / 'multiarm-ci-summary.json'
            verified = render(args.artifact_root.resolve(), payload, args.expected_config, args.profile, args.out)
            print(json.dumps({'complete': True, 'profile': args.profile, 'records': verified['expectedRecords'], 'exports': verified['exportCounts'], 'out': str(args.out)}))
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f'Report refused: {type(error).__name__}: {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
