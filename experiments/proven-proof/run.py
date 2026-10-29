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
        row = {'status': killed, 'hashes': None, 'lastProgress': read_progress(folder / 'progress.json')}
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
    runtime = {
        'pid': os.getpid(), 'cpuAffinity': sorted(os.sched_getaffinity(0)),
        'laneCpus': cpus, 'platform': sys.platform,
        'runnerName': os.environ.get('RUNNER_NAME'),
        'controllerSha': os.environ.get('GITHUB_SHA'),
        'pipelineCacheProvider': None,
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
    result = {'phase': cfg['phase'], 'records': len(rows), 'arms': {}, 'harnessErrors': [row['taskId'] for row in rows if row['status'] == 'harness_error']}
    for arm in cfg['candidates']:
        item = {'matchedCases': [], 'parityMismatches': [], 'parityCensoredCases': [], 'completedOutputParityCases': 0, 'censoredCases': [], 'datasetTotals': {}}
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
                elif left and left.get('hashes') and compared and all(row.get('hashes') for row in compared):
                    item['completedOutputParityCases'] += 1
                differences = sorted({field for right in compared or [None] for field in fields if not left or not right or left.get(field) != right.get(field)})
                if differences:
                    item['parityMismatches'].append({**case, 'fields': differences})
            pair = {name: [row for row in cohort if row['mode'] == 'performance' and row['comparisonCandidate'] == arm and row['arm'] == name] for name in ['base', arm]}
            expected = cfg['cycles'] * len(cfg['orders'])
            if any(len(pair[name]) != expected or any(row['status'] != 'solved' for row in pair[name]) for name in pair):
                item['censoredCases'].append({**case, 'statuses': {name: [row['status'] for row in group] for name, group in pair.items()}})
                continue
            medians = {name: {metric: statistics.median(row[metric] for row in group) for metric in ['solveMs', 'peakRssAfterSolveBytes', 'peakRssAfterValidationBytes']} for name, group in pair.items()}
            metrics = {**case, 'observationsPerArm': expected, 'base': medians['base'], 'candidate': medians[arm], 'relaxedDrcErrors': {name: sorted({row['drcErrorCount'] for row in group}) for name, group in pair.items()}}
            for metric in medians['base']:
                metrics[metric + 'Ratio'] = medians[arm][metric] / medians['base'][metric]
            item['matchedCases'].append(metrics)
        for dataset in ['srj18', 'srj24']:
            group = [case for case in item['matchedCases'] if case['dataset'] == dataset]
            base_ms = sum(case['base']['solveMs'] for case in group)
            candidate_ms = sum(case['candidate']['solveMs'] for case in group)
            item['datasetTotals'][dataset] = {'matchedCases': len(group), 'baseSolveMs': base_ms, 'candidateSolveMs': candidate_ms, 'ratio': candidate_ms / base_ms if base_ms else None}
            clean = [case for case in group if all(counts == [0] for counts in case['relaxedDrcErrors'].values())]
            clean_base = sum(case['base']['solveMs'] for case in clean)
            clean_candidate = sum(case['candidate']['solveMs'] for case in clean)
            item['datasetTotals'][dataset]['matchedClean'] = {'cases': len(clean), 'baseSolveMs': clean_base, 'candidateSolveMs': clean_candidate, 'ratio': clean_candidate / clean_base if clean_base else None}
        item['maxCaseMedianSolveRssRatio'] = max((case['peakRssAfterSolveBytesRatio'] for case in item['matchedCases']), default=None)
        item['maxCaseMedianValidatedRssRatio'] = max((case['peakRssAfterValidationBytesRatio'] for case in item['matchedCases']), default=None)
        item['parityPass'] = (cfg['run_correctness'] or cfg.get('hash_after_performance', False)) and not item['parityMismatches']
        item['parityPassScope'] = 'Exact raw trace/output/error hashes on completed cases; censored cases establish status/input agreement only, never route parity.'
        item['protocolIsRepeatedAndBalanced'] = set(cfg['orders']) == {'AB', 'BA'}
        item['matchedSolveTimeUsesAllSolvedBoardsIncludingDirty'] = True
        result['arms'][arm] = item
    save(OUT / 'summary.json', result)
    emit('PROOF_SUMMARY', result)
    return result


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
