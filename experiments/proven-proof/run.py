import asyncio
import hashlib
import json
import math
import os
import pathlib
import re
import signal
import statistics
import subprocess
import sys
import time

ROOT = pathlib.Path.cwd()
HERE = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'proof-results'
SOURCES = ROOT / 'proof-source'


def emit(kind, value):
    print(kind + ' ' + json.dumps(value, separators=(',', ':')), flush=True)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def command(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def config():
    value = json.loads((HERE / 'config.json').read_text())
    candidates = value.get('candidates')
    selector = os.environ.get('PROOF_CANDIDATE')
    if not isinstance(candidates, dict) or not candidates or selector not in candidates:
        raise ValueError('PROOF_CANDIDATE must select exactly one configured candidate')
    value['configured_candidate_labels'] = list(candidates)
    value['selected_candidate'] = selector
    # Select before validating literal refs: unpublished, unselected candidate
    # placeholders must not block an independently ready matrix job.
    value['candidates'] = {selector: candidates[selector]}
    if value.get('cache_mode', 'disabled') not in ['production-default', 'disabled']:
        raise ValueError('Invalid explicit cache mode')
    if value['phase'] in ['full-gate', 'work-reduction-pilot'] and value.get('cache_mode') != 'production-default':
        raise ValueError('Full gate and work-reduction pilot require production default within-board caching')
    for sha in [value['base_sha'], *value['candidates'].values()]:
        if not re.fullmatch(r'[a-f0-9]{40}', sha) or sha == '0' * 40:
            raise ValueError('Every source ref must be a literal nonzero full SHA')
    for arm in value['candidates']:
        if arm == 'base' or not re.fullmatch(r'[a-zA-Z0-9_-]+', arm):
            raise ValueError('Invalid candidate label')
    if value['orders'] not in [['AB'], ['BA'], ['AB', 'BA'], ['BA', 'AB']]:
        raise ValueError('orders must explicitly select AB, BA, or both')
    if value['cases'] == 'all':
        value['cases'] = [
            {'dataset': dataset, 'sample': sample}
            for dataset, count in [('srj18', 16), ('srj24', 26)]
            for sample in range(1, count + 1)
        ]
    keys = []
    for case in value['cases']:
        count = {'srj18': 16, 'srj24': 26}.get(case['dataset'])
        if count is None or not 1 <= case['sample'] <= count:
            raise ValueError('Case outside the frozen 16+26 sample inventory')
        keys.append((case['dataset'], case['sample']))
    if len(keys) != len(set(keys)) or not keys:
        raise ValueError('Duplicate or empty case inventory')
    if not 1 <= value['cpu_lanes'] <= len(os.sched_getaffinity(0)):
        raise ValueError('Requested CPU lanes exceed process affinity')
    if not isinstance(value['cycles'], int) or value['cycles'] < 1:
        raise ValueError('cycles must be positive')
    return value


def prepare(cfg):
    base = SOURCES / 'base'
    if command(['git', 'rev-parse', 'HEAD'], base) != cfg['base_sha']:
        raise ValueError('Baseline checkout is not the pinned source')
    source_manifest = {}
    for arm, sha in {'base': cfg['base_sha'], **cfg['candidates']}.items():
        target = SOURCES / arm
        if arm != 'base':
            command(['git', 'fetch', '--no-tags', '--depth=1', 'origin', sha], base)
            command(['git', 'worktree', 'add', '--detach', str(target), sha], base)
        if (target / 'package.json').read_bytes() != (base / 'package.json').read_bytes():
            raise ValueError('Candidate dependency manifest differs from baseline')
        if command(['git', 'status', '--porcelain', '--untracked-files=no'], target):
            raise ValueError('Dirty measured source')
        source_manifest[arm] = {
            'sha': command(['git', 'rev-parse', 'HEAD'], target),
            'tree': command(['git', 'rev-parse', 'HEAD^{tree}'], target),
            'packageSha256': hashlib.sha256((target / 'package.json').read_bytes()).hexdigest(),
        }
    save(OUT / 'sources.json', source_manifest)
    save(OUT / 'protocol.json', cfg)
    emit('PROOF_SOURCES', source_manifest)


def install(cfg):
    base = SOURCES / 'base'
    version = command(['bun', '--version'])
    if version != cfg['bun_version']:
        raise ValueError('Bun version differs from frozen protocol')
    tracked = command(['git', 'ls-files', 'bun.lock', 'bun.lockb'], base).splitlines()
    args = ['bun', 'install'] + (['--frozen-lockfile'] if tracked else [])
    subprocess.run(args, cwd=base, check=True)
    shared = (base / 'node_modules').resolve()
    if not shared.is_dir():
        raise ValueError('Dependency installation did not create node_modules')
    for arm in cfg['candidates']:
        (SOURCES / arm / 'node_modules').symlink_to(shared, target_is_directory=True)
    invariant_sources = ['tsconfig.json', 'scripts/benchmark/scenarios.ts', 'lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata.ts']
    for arm in cfg['candidates']:
        for name in invariant_sources:
            if (SOURCES / arm / name).read_bytes() != (base / name).read_bytes():
                raise ValueError('Candidate changed an input/alias invariant: ' + name)
    lock_paths = [path for path in [base / 'bun.lock', base / 'bun.lockb'] if path.is_file()]
    locks = {}
    for path in lock_paths:
        locks[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        (OUT / path.name).write_bytes(path.read_bytes())
    manifest = []
    for path in sorted(shared.rglob('package.json')):
        try:
            package = json.loads(path.read_text())
        except (ValueError, UnicodeError):
            continue
        manifest.append({
            'path': str(path.relative_to(shared)),
            'name': package.get('name'),
            'version': package.get('version'),
            'packageSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        })
    save(OUT / 'installed-packages.json', manifest)
    info = {
        'bunVersion': version,
        'installedOnceFromArm': 'base',
        'sourceHasTrackedLock': bool(tracked),
        'resolvedLockAvailable': bool(lock_paths),
        'dependencyParityMethod': 'All arms resolve one physical node_modules directory installed exactly once; package manifests fingerprinted. Baseline bunfig may intentionally disable lockfile saving.',
        'installArgs': args,
        'lockSha256': locks,
        'singlePhysicalNodeModules': str(shared),
        'armNodeModules': {arm: str((SOURCES / arm / 'node_modules').resolve()) for arm in ['base', *cfg['candidates']]},
        'packageManifestSha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
    }
    if len(set(info['armNodeModules'].values())) != 1:
        raise ValueError('Arms do not resolve the same physical dependencies')
    save(OUT / 'dependencies.json', info)
    emit('PROOF_DEPENDENCIES', info)
    subprocess.run([
        'bun', '--tsconfig-override', str(base / 'tsconfig.json'),
        str(HERE / 'prepare-inputs.ts'), str(base),
        str(OUT / 'protocol.json'), str(OUT / 'inputs'),
    ], cwd=base, check=True)
    emit('PROOF_INPUTS', json.loads((OUT / 'inputs' / 'manifest.json').read_text()))


def read_progress(path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        # This diagnostic file may be observed between truncate and write.
        return None


async def one(cfg, case, arm, cpu, mode, comparison, cycle, order, position):
    label = f'{mode}-{comparison}-{cycle}-{order}-{position}-{arm}-{case["dataset"]}-{case["sample"]:03}'
    folder = OUT / 'tasks' / label
    folder.mkdir(parents=True)
    task = {
        'repo': str(SOURCES / arm), 'arm': arm,
        'sourceSha': cfg['base_sha'] if arm == 'base' else cfg['candidates'][arm],
        'mode': mode, **case, 'effort': cfg['effort'],
        'resultPath': str(folder / 'result.json'),
        'progressPath': str(folder / 'progress.json'),
        'hashAfterPerformance': cfg.get('hash_after_performance', False),
        'cacheMode': cfg.get('cache_mode', 'disabled'),
    }
    inputs = json.loads((OUT / 'inputs' / 'manifest.json').read_text())
    source_input = next(item for item in inputs if item['dataset'] == case['dataset'] and item['sample'] == case['sample'])
    input_path = OUT / 'inputs' / source_input['filename']
    if hashlib.sha256(input_path.read_bytes()).hexdigest() != source_input['inputSha256']:
        raise ValueError('Prepared source input changed')
    task.update({
        'inputPath': str(input_path), 'inputSha256': source_input['inputSha256'],
        'scenarioName': source_input['scenarioName'], 'totalSamples': source_input['totalSamples'],
    })
    save(folder / 'task.json', task)
    start = time.monotonic()
    started_at = time.time()
    phase, phase_start = 'loading', start
    killed, parent_peak = None, 0
    with (folder / 'stdout.log').open('w') as stdout, (folder / 'stderr.log').open('w') as stderr:
        process = await asyncio.create_subprocess_exec(
            'taskset', '-c', str(cpu), 'bun',
            '--tsconfig-override', str(SOURCES / arm / 'tsconfig.json'),
            str(HERE / 'child.ts'), str(folder / 'task.json'),
            cwd=SOURCES / arm, stdout=stdout, stderr=stderr,
            start_new_session=True,
        )
        deadline = {
            'loading': cfg['startup_timeout_s'], 'constructor': cfg['startup_timeout_s'],
            'solve': cfg['solve_timeout_s'], 'validation': cfg['validation_timeout_s'],
            'hash': cfg['hash_timeout_s'], 'complete': 30,
        }
        while process.returncode is None:
            state = read_progress(folder / 'progress.json')
            if state and state['phase'] != phase:
                phase, phase_start = state['phase'], time.monotonic()
            try:
                for line in pathlib.Path(f'/proc/{process.pid}/status').read_text().splitlines():
                    if line.startswith('VmRSS:'):
                        parent_peak = max(parent_peak, int(line.split()[1]) * 1024)
            except FileNotFoundError:
                pass
            if time.monotonic() - phase_start > deadline[phase]:
                killed = f'timeout_{phase}'
            limit = cfg.get('child_memory_limit_mib', 8192) * 1024 * 1024
            if parent_peak > limit:
                killed = f'memory_limit_{phase}'
            if killed:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    await asyncio.wait_for(process.wait(), timeout=5)
                except asyncio.TimeoutError:
                    os.killpg(process.pid, signal.SIGKILL)
                    await process.wait()
                break
            await asyncio.sleep(0.2)
        await process.wait()
    if killed:
        last_progress = read_progress(folder / 'progress.json')
        checkpoint = last_progress.get('measurements', {}) if last_progress else {}
        row = {**checkpoint, 'status': killed, 'hashes': None, 'lastProgress': last_progress}
    elif process.returncode != 0 or not (folder / 'result.json').is_file():
        row = {'status': 'harness_error', 'hashes': None, 'stderrTail': (folder / 'stderr.log').read_text()[-4000:]}
    else:
        row = json.loads((folder / 'result.json').read_text())
    row.update({
        'taskId': label, 'arm': arm, 'comparisonCandidate': comparison,
        'mode': mode, **case, 'cycle': cycle, 'order': order, 'position': position,
        'cpu': cpu, 'startedAtUnix': started_at, 'wallMs': (time.monotonic() - start) * 1000,
        'exitCode': process.returncode, 'parentObservedWholeProcessPeakRssBytes': parent_peak,
        'inputSha256': task['inputSha256'],
    })
    save(folder / 'record.json', row)
    with (OUT / 'results.jsonl').open('a') as file:
        file.write(json.dumps(row, separators=(',', ':')) + '\n')
    emit('PROOF_RESULT', row)
    if row['status'] == 'harness_error':
        raise RuntimeError('Harness failed; inspect saved task stderr: ' + label)


async def run(cfg):
    cpus = sorted(os.sched_getaffinity(0))[:cfg['cpu_lanes']]
    physical_memory_bytes = next(
        int(line.split()[1]) * 1024
        for line in pathlib.Path('/proc/meminfo').read_text().splitlines()
        if line.startswith('MemTotal:')
    )
    cgroup_memory_path = pathlib.Path('/sys/fs/cgroup/memory.max')
    cgroup_memory_text = cgroup_memory_path.read_text().strip() if cgroup_memory_path.is_file() else None
    cgroup_memory_bytes = int(cgroup_memory_text) if cgroup_memory_text not in [None, 'max'] else None
    effective_memory_bytes = min(physical_memory_bytes, cgroup_memory_bytes) if cgroup_memory_bytes is not None else physical_memory_bytes
    required_memory_bytes = (len(cpus) * cfg.get('child_memory_limit_mib', 8192) + 2048) * 1024 * 1024
    if effective_memory_bytes < required_memory_bytes:
        raise ValueError(f'Insufficient memory capacity for isolated lanes: {effective_memory_bytes} < {required_memory_bytes} bytes')
    runtime = {
        'pid': os.getpid(), 'cpuAffinity': sorted(os.sched_getaffinity(0)),
        'laneCpus': cpus, 'platform': sys.platform,
        'memoryPreflight': {
            'physicalBytes': physical_memory_bytes,
            'cgroupLimitBytes': cgroup_memory_bytes,
            'effectiveCapacityBytes': effective_memory_bytes,
            'requiredCapacityBytes': required_memory_bytes,
            'basis': 'Every configured child cap plus 2GiB controller/runtime headroom.',
        },
        'runnerName': os.environ.get('RUNNER_NAME'),
        'controllerSha': os.environ.get('GITHUB_SHA'),
        'cacheMode': cfg.get('cache_mode', 'disabled'),
        'pipelineCacheProvider': 'global-in-memory-default' if cfg.get('cache_mode') == 'production-default' else None,
        'architecture': os.uname().machine,
        'cgroupCpuMax': pathlib.Path('/sys/fs/cgroup/cpu.max').read_text().strip() if pathlib.Path('/sys/fs/cgroup/cpu.max').is_file() else None,
        'cgroupMemoryMax': pathlib.Path('/sys/fs/cgroup/memory.max').read_text().strip() if pathlib.Path('/sys/fs/cgroup/memory.max').is_file() else None,
        'memoryMetric': 'Fresh child maxRSS at end of solve and after trace lint + relaxed and board-aware DRC, excluding SVG generation and output hashing. Parent whole-process peak is separate diagnostic only.',
    }
    save(OUT / 'runtime.json', runtime)
    emit('PROOF_RUNTIME', runtime)
    for mode in ['performance'] + (['correctness'] if cfg['run_correctness'] else []):
        async def lane(index, cpu):
            for case in cfg['cases'][index::len(cpus)]:
                if mode == 'correctness':
                    for position, arm in enumerate(['base', *cfg['candidates']]):
                        await one(cfg, case, arm, cpu, mode, 'parity', 0, 'all', position)
                else:
                    for cycle in range(cfg['cycles']):
                        for candidate in cfg['candidates']:
                            for order in cfg['orders']:
                                for position, symbol in enumerate(order):
                                    arm = 'base' if symbol == 'A' else candidate
                                    await one(cfg, case, arm, cpu, mode, candidate, cycle, order, position)
        await asyncio.gather(*(lane(index, cpu) for index, cpu in enumerate(cpus)))


def summary(cfg):
    rows = [json.loads(line) for line in (OUT / 'results.jsonl').read_text().splitlines()] if (OUT / 'results.jsonl').is_file() else []
    expected_records = len(cfg['cases']) * (2 * len(cfg['candidates']) * cfg['cycles'] * len(cfg['orders']) + (1 + len(cfg['candidates']) if cfg['run_correctness'] else 0))
    result = {'phase': cfg['phase'], 'records': len(rows), 'expectedRecords': expected_records, 'runComplete': len(rows) == expected_records, 'arms': {}, 'harnessErrors': [row['taskId'] for row in rows if row['status'] == 'harness_error']}
    for arm in cfg['candidates']:
        item = {'matchedCases': [], 'parityMismatches': [], 'parityCensoredCases': [], 'failedSignatureComparisons': [], 'completedOutputParityCases': 0, 'censoredCases': [], 'censoredMemoryComparisons': [], 'datasetTotals': {}}
        for case in cfg['cases']:
            key = (case['dataset'], case['sample'])
            cohort = [row for row in rows if (row['dataset'], row['sample']) == key]
            parity = {row['arm']: row for row in cohort if row['mode'] == 'correctness'}
            if cfg['run_correctness'] or cfg.get('hash_after_performance', False):
                base_rows = [parity['base']] if 'base' in parity else [row for row in cohort if row['arm'] == 'base']
                left = base_rows[0] if base_rows else None
                right_rows = [parity[arm]] if arm in parity else [row for row in cohort if row['arm'] == arm]
                fields = ['status', 'inputSha256', 'drcErrorCount', 'drcErrorTypes', 'boardAwareDrcErrorCount', 'traceLintIssueCounts', 'traceCount', 'viaCount', 'wireCount', 'iterations', 'hashes']
                compared = [*base_rows[1:], *right_rows]
                if left and compared and all(row['status'] != 'solved' for row in [left, *compared]):
                    fields = ['status', 'inputSha256']
                    item['parityCensoredCases'].append({**case, 'statuses': sorted({row['status'] for row in [left, *compared]})})
                    if all(row['status'] in ['failed', 'exception'] for row in [left, *compared]):
                        left = {**left, 'failureSignature': failure_signature(left)}
                        compared = [{**row, 'failureSignature': failure_signature(row)} for row in compared]
                        fields.append('failureSignature')
                        item['failedSignatureComparisons'].append({**case, 'base': left['failureSignature'], 'observations': [{'arm': row['arm'], 'signature': row['failureSignature']} for row in compared], 'allSignaturesAgree': all(row['failureSignature'] == left['failureSignature'] for row in compared)})
                elif left and left.get('hashes') and compared and all(row.get('hashes') for row in compared):
                    item['completedOutputParityCases'] += 1
                differences = sorted({field for right in compared or [None] for field in fields if not left or not right or left.get(field) != right.get(field)})
                if not left or not right_rows:
                    differences = sorted(set(differences) | {'missing-result'})
                if differences:
                    item['parityMismatches'].append({**case, 'fields': differences})
            pair = {name: [row for row in cohort if row['mode'] == 'performance' and row['comparisonCandidate'] == arm and row['arm'] == name] for name in ['base', arm]}
            expected = cfg['cycles'] * len(cfg['orders'])
            if any(len(pair[name]) != expected or any(row['status'] != 'solved' for row in pair[name]) for name in pair):
                item['censoredCases'].append({**case, 'statuses': {name: [row['status'] for row in group] for name, group in pair.items()}})
                item['censoredMemoryComparisons'].append(censored_memory(case, pair, arm, cfg))
                continue
            medians = {name: {metric: statistics.median(row[metric] for row in group) for metric in ['constructorMs', 'solveMs', 'routingMs', 'validationMs', 'peakRssAfterSolveBytes', 'peakRssAfterValidationBytes']} for name, group in pair.items()}
            metrics = {**case, 'observationsPerArm': expected, 'base': medians['base'], 'candidate': medians[arm], 'relaxedDrcErrors': {name: sorted({row['drcErrorCount'] for row in group}) for name, group in pair.items()}}
            for metric in medians['base']:
                metrics[metric + 'Ratio'] = medians[arm][metric] / medians['base'][metric] if medians['base'][metric] > 0 else None
            item['matchedCases'].append(metrics)
        for dataset in ['srj18', 'srj24']:
            group = [case for case in item['matchedCases'] if case['dataset'] == dataset]
            base_ms = sum(case['base']['solveMs'] for case in group)
            candidate_ms = sum(case['candidate']['solveMs'] for case in group)
            base_routing = sum(case['base']['routingMs'] for case in group)
            candidate_routing = sum(case['candidate']['routingMs'] for case in group)
            item['datasetTotals'][dataset] = {'matchedCases': len(group), 'baseSolveMs': base_ms, 'candidateSolveMs': candidate_ms, 'solveRatio': candidate_ms / base_ms if base_ms else None, 'baseRoutingMs': base_routing, 'candidateRoutingMs': candidate_routing, 'ratio': candidate_routing / base_routing if base_routing else None}
            clean = [case for case in group if all(counts == [0] for counts in case['relaxedDrcErrors'].values())]
            clean_base = sum(case['base']['solveMs'] for case in clean)
            clean_candidate = sum(case['candidate']['solveMs'] for case in clean)
            clean_base_routing = sum(case['base']['routingMs'] for case in clean)
            clean_candidate_routing = sum(case['candidate']['routingMs'] for case in clean)
            item['datasetTotals'][dataset]['matchedClean'] = {'cases': len(clean), 'baseSolveMs': clean_base, 'candidateSolveMs': clean_candidate, 'solveRatio': clean_candidate / clean_base if clean_base else None, 'baseRoutingMs': clean_base_routing, 'candidateRoutingMs': clean_candidate_routing, 'ratio': clean_candidate_routing / clean_base_routing if clean_base_routing else None}
        item['maxCaseMedianSolveRssRatio'] = max((case['peakRssAfterSolveBytesRatio'] for case in item['matchedCases']), default=None)
        item['maxCaseMedianValidatedRssRatio'] = max((case['peakRssAfterValidationBytesRatio'] for case in item['matchedCases']), default=None)
        for metric in ['peakRssAfterSolveBytes', 'peakRssAfterValidationBytes']:
            ratios = [case['exactBoundaryMedians'][metric]['ratio'] for case in item['censoredMemoryComparisons'] if case['exactBoundaryMedians'][metric]['ratio'] is not None]
            item['maxCensoredExact' + metric[0].upper() + metric[1:] + 'Ratio'] = max(ratios, default=None)
        item['censoredMemoryScope'] = 'Every failed/timeout/missing case is listed. Native child boundary peaks are exact high-water observations to that boundary; /proc or progress peaks on killed processes are separate partial lower bounds. Partial ratios never establish absence of a memory regression. Error strings are retained.'
        item['parityPass'] = result['runComplete'] and not result['harnessErrors'] and (cfg['run_correctness'] or cfg.get('hash_after_performance', False)) and not item['parityMismatches']
        item['parityPassScope'] = 'Exact raw trace/output/error hashes on completed cases. Finished failures/exceptions also require identical normalized error first line, algorithm iterations and stable stage-name sequence. Timeouts establish only phase/type/input agreement, never algorithm-iteration or route parity.'
        item['protocolIsRepeatedAndBalanced'] = set(cfg['orders']) == {'AB', 'BA'}
        item['matchedSolveTimeUsesAllSolvedBoardsIncludingDirty'] = True
        item['primaryTimingMetric'] = 'routingMs: constructor plus solve, excluding input/module loading, validation and hashing; solveMs retained separately for stock benchmark comparison.'
        result['arms'][arm] = item
    save(OUT / 'summary.json', result)
    emit('PROOF_SUMMARY', result)
    return result


def censored_memory(case, pair, arm, cfg):
    metrics = ['peakRssAfterSolveBytes', 'peakRssAfterValidationBytes']
    detail = {**case, 'pairs': [], 'exactBoundaryMedians': {}, 'partialObservedMedians': {}}
    exact_values = {metric: {'base': [], arm: []} for metric in metrics}
    partial_values = {'base': [], arm: []}
    for cycle in range(cfg['cycles']):
        for order in cfg['orders']:
            selected = {name: [row for row in group if row['cycle'] == cycle and row['order'] == order] for name, group in pair.items()}
            records = {name: group[0] if len(group) == 1 else None for name, group in selected.items()}
            left, right = records['base'], records[arm]
            same_status = left is not None and right is not None and left['status'] == right['status']
            record = {'cycle': cycle, 'order': order, 'sameStatus': same_status, 'observations': {}}
            for name, row in records.items():
                if row is None:
                    record['observations'][name] = {'status': 'missing'}
                    continue
                progress = row.get('lastProgress') or {}
                observation = {'status': row['status'], 'error': row.get('error'), 'sourceSolveError': row.get('sourceSolveError'), 'lastPhase': progress.get('phase'), 'exactBoundaryPeaks': {metric: row.get(metric) for metric in metrics}}
                partial = max(row.get('parentObservedWholeProcessPeakRssBytes', 0), progress.get('peakRssBytes', 0))
                observation['partialObservedPeakLowerBoundBytes'] = partial or None
                record['observations'][name] = observation
            record['boundaryComparisons'] = {}
            for metric in metrics:
                a = left.get(metric) if left else None
                b = right.get(metric) if right else None
                both_exact = isinstance(a, (int, float)) and a > 0 and isinstance(b, (int, float)) and b > 0
                record['boundaryComparisons'][metric] = {'bothExact': both_exact, 'sameStatus': same_status, 'ratio': b / a if both_exact and same_status else None}
                if both_exact and same_status:
                    exact_values[metric]['base'].append(a)
                    exact_values[metric][arm].append(b)
            partial_pair = {name: record['observations'][name].get('partialObservedPeakLowerBoundBytes') for name in records}
            if same_status and all(isinstance(value, (int, float)) and value > 0 for value in partial_pair.values()):
                for name, value in partial_pair.items():
                    partial_values[name].append(value)
            detail['pairs'].append(record)
    for metric in metrics:
        values = exact_values[metric]
        a = statistics.median(values['base']) if values['base'] else None
        b = statistics.median(values[arm]) if values[arm] else None
        detail['exactBoundaryMedians'][metric] = {'pairedObservations': len(values['base']), 'baseBytes': a, 'candidateBytes': b, 'ratio': b / a if a and b else None, 'scope': 'Native high-water peaks only; same-status pairs only.'}
    a = statistics.median(partial_values['base']) if partial_values['base'] else None
    b = statistics.median(partial_values[arm]) if partial_values[arm] else None
    detail['partialObservedMedians'] = {'pairedObservations': len(partial_values['base']), 'baseLowerBoundBytes': a, 'candidateLowerBoundBytes': b, 'approximateRatio': b / a if a and b else None, 'scope': 'Diagnostic lower-bound RSS samples only; not pooled with exact boundary metrics and not proof of non-regression.'}
    return detail


def failure_signature(row):
    error = row.get('error')
    if error is None:
        error = row.get('sourceSolveError')
    if error is not None and not isinstance(error, str):
        error = json.dumps(error, sort_keys=True)
    first_line = error.splitlines()[0] if error else None
    if first_line:
        first_line = first_line.replace(str(SOURCES / row['arm']), '<SOURCE>')
    stage_timing = row.get('stageTiming')
    stage_names = [stage.get('stageName') for stage in stage_timing.get('stages', [])] if isinstance(stage_timing, dict) else None
    signature = {
        'status': row['status'],
        'errorFirstLine': first_line,
        'iterations': row.get('iterations'),
        'stageNames': stage_names,
        'lastStageName': stage_names[-1] if stage_names else None,
    }
    signature['normalizedSha256'] = hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()
    return signature


if __name__ == '__main__':
    cfg = config()
    OUT.mkdir(parents=True, exist_ok=True)
    action = sys.argv[1]
    if action == 'refs':
        with open(os.environ['GITHUB_OUTPUT'], 'a') as file:
            file.write('base_sha=' + cfg['base_sha'] + '\n')
    elif action == 'prepare':
        prepare(cfg)
    elif action == 'install':
        install(cfg)
    elif action == 'run':
        if (OUT / 'results.jsonl').exists():
            raise ValueError('Refuse to mix old results with a fresh run')
        asyncio.run(run(cfg))
        summary(cfg)
    elif action == 'summary':
        summary(cfg)
    else:
        raise ValueError('Unknown controller action')
