import asyncio
import decimal
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
import importlib.util

OVERLAY_SPEC = importlib.util.spec_from_file_location("dependency_overlay", pathlib.Path(__file__).with_name("dependency-overlay.py"))
overlay = importlib.util.module_from_spec(OVERLAY_SPEC)
OVERLAY_SPEC.loader.exec_module(overlay)

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
    overlay.validate_config(value)
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
    if value['base_sha'] != '0da00f5bef6d9945b3fa63e1aa72c138e68e1c7f' or value['candidates'] != {'paged_occupancy': '87529e893888fec3831a18444ccfdd085a2bdd4c'} or value['dependency_overlay']['candidate_sha'] != '8e89038924235f3553d51e73c8b97fd1ad7ece3b':
        raise ValueError('This component diagnostic freezes the original public0da/875/8e source pair')
    if value['phase'] != 'a01-component-diagnostic' or value['cache_mode'] != 'production-default':
        raise ValueError('Component diagnostic requires its explicit phase and production-default pipeline caching')
    if value['cpu_lanes'] != 2 or value['child_memory_limit_mib'] != 8192 or value['effort'] != 1:
        raise ValueError('Frozen component scope requires2lanes,8GiBperchild andeffort1')
    if value['cases'] != [{'dataset': 'srj18', 'sample': 15}, {'dataset': 'srj24', 'sample': 20}] or value['orders'] != ['AB', 'BA'] or value['cycles'] != 1:
        raise ValueError('Component case selection and same-core ABBA order are frozen before data')
    if value['run_correctness'] is not False or value['hash_after_performance'] is not True:
        raise ValueError('Component quality is mandatory and capture/verification phases are explicit')
    if value['acceptance']['maximumAfterReplayNativeRssRatioByCase'] != {'srj18/15': 0.75, 'srj24/20': 1.05} or value['acceptance']['maximumTotalReplayTimeIncreaseFraction'] != 0.05 or value['acceptance']['requireEveryCaseAndOrder'] is not True:
        raise ValueError('Component primary25percentRSS/secondary5percentRSS/ALL5percenttime EVERYorder is predeclared')
    if set(value['baseline_quality_fingerprints']) != {'srj18/15', 'srj24/20'}:
        raise ValueError('Missing prepublication baseline quality fingerprints')
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
        if arm != 'base':
            overlay.validate_root_pair(cfg, target)
        if command(['git', 'status', '--porcelain', '--untracked-files=no'], target):
            raise ValueError('Dirty measured source')
        source_manifest[arm] = {
            'sha': command(['git', 'rev-parse', 'HEAD'], target),
            'tree': command(['git', 'rev-parse', 'HEAD^{tree}'], target),
            'packageSha256': hashlib.sha256((target / 'package.json').read_bytes()).hexdigest(),
        }
    overlay.prepare_upstreams(cfg)
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
    shared, overlay_metadata = overlay.install_overlays(cfg, shared)
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
        'dependencyParityMethod': 'One baseline install; arm-private symlink overlays share every other physical package, while the one explicitly pinned TS package resolves to its actual frozen Git checkout. Full source/link/dependency guards and resolution audit are separate artifacts.',
        'explicitDependencyOverlay': overlay_metadata,
        'installArgs': args,
        'lockSha256': locks,
        'singlePhysicalNodeModules': str(shared),
        'armNodeModules': {arm: str((SOURCES / arm / 'node_modules').resolve()) for arm in ['base', *cfg['candidates']]},
        'packageManifestSha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
    }
    if len(set(info['armNodeModules'].values())) != len(info['armNodeModules']):
        raise ValueError('Root arms require distinct validated dependency overlay directories')
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


def memory_preflight(cpu_count, child_limit_mib, meminfo_path=pathlib.Path('/proc/meminfo'), cgroup_v2_path=pathlib.Path('/sys/fs/cgroup/memory.max'), cgroup_v1_path=pathlib.Path('/sys/fs/cgroup/memory/memory.limit_in_bytes')):
    memory_lines = [line.split() for line in meminfo_path.read_text().splitlines() if line.startswith('MemTotal:')]
    if len(memory_lines) != 1 or len(memory_lines[0]) != 3 or memory_lines[0][2] != 'kB':
        raise ValueError('Cannot authenticate physical memory capacity from MemTotal')
    physical = int(memory_lines[0][1]) * 1024
    observations = {}
    numeric_limits = []
    for kind, path in [('v2', cgroup_v2_path), ('v1', cgroup_v1_path)]:
        try:
            path.stat()
        except FileNotFoundError:
            observations[kind] = {'path': str(path), 'state': 'interface-unavailable', 'value': None}
            continue
        if not path.is_file():
            raise ValueError('Memory limit interface is not a regular readable file: ' + str(path))
        text = path.read_text().strip()
        if kind == 'v2' and text == 'max':
            observations[kind] = {'path': str(path), 'state': 'unlimited', 'value': text}
            continue
        if not re.fullmatch('[0-9]+', text):
            raise ValueError('Malformed ' + kind + ' memory limit: ' + str(path))
        limit = int(text)
        observations[kind] = {'path': str(path), 'state': 'numeric-limit', 'value': limit}
        numeric_limits.append(limit)
    effective = min([physical, *numeric_limits])
    required = (cpu_count * child_limit_mib + 2048) * 1024 * 1024
    info = {'physicalBytes': physical, 'cgroupInterfaces': observations, 'effectiveCapacityBytes': effective, 'requiredCapacityBytes': required, 'basis': 'Physical MemTotal bounded by every numeric v1/v2 ceiling exposed by this runner. Missing optional kernel interfaces are recorded explicitly; they are not read as files or assumed to impose a hidden numeric limit.'}
    if physical <= 0 or effective < required:
        raise ValueError('Insufficient isolated diagnostic memory capacity: ' + json.dumps(info, sort_keys=True))
    return info



QUALITY_SHA_FIELDS = [
    'initialParamsSha256', 'sequenceSha256', 'outputSha256', 'ownersSha256',
    'visitedSha256', 'penaltySha256', 'heapSha256', 'poolSha256',
    'otherPrivateStateSha256', 'setupStateSha256',
]
NATIVE_FIELDS = ['peakRssBeforeConstructorBytes', 'peakRssAfterSetupBytes', 'peakRssAfterReplayBytes']
TIME_FIELDS = ['constructorMs', 'setupMs', 'replayMs', 'totalReplayMs']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quality_fingerprint(row, cfg):
    if any(field not in row for field in cfg['baseline_quality_fields']):
        raise ValueError('Baseline capture omitted a frozen full-pipeline quality field')
    return {field: row[field] for field in cfg['baseline_quality_fields']}


def require_hash(value, name):
    if not isinstance(value, str) or re.fullmatch('[0-9a-f]{64}', value) is None:
        raise ValueError('Missing or malformed immutable SHA256: ' + name)


def validate_capture(cfg, case, row, path):
    key = f'{case["dataset"]}/{case["sample"]}'
    if row['arm'] != 'base' or row['mode'] != 'capture' or row['status'] != 'solved':
        raise ValueError('Baseline instrumented capture did not finish successfully: ' + key)
    if row.get('sourceSha') != cfg['base_sha'] or row.get('cacheMode') != 'production-default' or row.get('bunVersion') != cfg['bun_version'] or row.get('effort') != 1:
        raise ValueError('Baseline capture runtime/source/defaults differ from frozen scope')
    if quality_fingerprint(row, cfg) != cfg['baseline_quality_fingerprints'][key]:
        raise ValueError('Instrumentation changed frozen baseline full-pipeline quality: ' + key)
    capture = json.loads(path.read_text())
    selection = capture['selection']
    if capture['schemaVersion'] != 1 or selection['concreteClass'] != 'HighDensitySolverA01':
        raise ValueError('Capture selected a different component class')
    if type(selection['instanceIndex']) is not int or selection['instanceIndex'] < 0 or type(selection['logicalOwnerBytes']) is not int or selection['logicalOwnerBytes'] <= 0:
        raise ValueError('Capture selection is not an allocated actually-stepped component')
    if not isinstance(capture['params'], list) or len(capture['params']) != 4 or capture['params'][0] != 'array' or capture['params'][2] != 1 or not isinstance(capture['setup'], dict) or not isinstance(capture['steps'], list) or not capture['steps']:
        raise ValueError('Missing lossless constructor/setup/actual step sequence capture')
    if type(capture['totalStepCalls']) is not int or capture['totalStepCalls'] <= 0 or any(type(run['count']) is not int or run['count'] <= 0 or not isinstance(run['beforeControls'], dict) for run in capture['steps']) or sum(run['count'] for run in capture['steps']) != capture['totalStepCalls']:
        raise ValueError('Captured step-control RLE does not represent the complete positive ordered call sequence')
    public = capture['expectedPublicReplay']
    if set(public) != {'setupPublicState', 'terminalPublicState', 'outputSha256', 'referenceSequenceSha256', 'captureObservedScalarTrajectorySha256', 'totalStepCalls'}:
        raise ValueError('Unexpected actual baseline public trajectory fingerprint schema')
    require_hash(public['outputSha256'], 'capture output')
    require_hash(public['referenceSequenceSha256'], 'capture reference sequence')
    require_hash(public['captureObservedScalarTrajectorySha256'], 'capture complete observed public scalar trajectory')
    if public['totalStepCalls'] != capture['totalStepCalls']:
        raise ValueError('Public trajectory count differs from captured RLE sequence')
    if public['setupPublicState'] != capture['setup']['publicStateAfterSetup'] or public['terminalPublicState'] != capture['terminalPublicState'] or public['outputSha256'] != capture['terminalOutputSha256'] or public['captureObservedScalarTrajectorySha256'] != capture['publicTrajectorySha256']:
        raise ValueError('Public replay expectation disagrees with actual observed capture fields')
    return capture


def validate_replay_fingerprint(value):
    if not isinstance(value, dict) or any(field not in value for field in [*QUALITY_SHA_FIELDS, 'setupPublicState', 'terminalPublicState']):
        raise ValueError('Incomplete standalone semantic replay fingerprint')
    for field in QUALITY_SHA_FIELDS:
        require_hash(value[field], field)


def validate_verified(row, path, capture, capture_sha, cfg):
    if row['arm'] != 'base' or row['mode'] != 'verify' or row['status'] != 'verified':
        raise ValueError('Unmeasured official standalone verification did not finish')
    if row.get('inputCaptureSha256') != capture_sha or row.get('publicReplayFingerprint') != capture['expectedPublicReplay']:
        raise ValueError('Official standalone verification differs from actual pipeline public trajectory')
    if row.get('sourceSha') != cfg['base_sha'] or row.get('cacheMode') != 'production-default' or row.get('bunVersion') != cfg['bun_version'] or row.get('effort') != 1 or row.get('observedScalarTrajectorySha256') != capture['publicTrajectorySha256']:
        raise ValueError('Verification did not authenticate the official runtime/defaults and actual observed scalar trajectory')
    verified = json.loads(path.read_text())
    if verified['schemaVersion'] != 1 or verified['componentCaptureSha256'] != capture_sha:
        raise ValueError('Verified component record is not bound to the immutable pipeline capture')
    if verified.get('sourceSha') != cfg['base_sha'] or verified.get('expectedPublicReplay') != capture['expectedPublicReplay'] or verified.get('observedScalarTrajectorySha256') != capture['publicTrajectorySha256']:
        raise ValueError('Frozen verification omitted its official source or independently observed public trajectory')
    expected = verified['expectedReplayFingerprint']
    validate_replay_fingerprint(expected)
    if row.get('replayFingerprint') != expected:
        raise ValueError('Verification row and frozen private-state fingerprint differ')
    for field, public_field in [('setupPublicState', 'setupPublicState'), ('terminalPublicState', 'terminalPublicState'), ('outputSha256', 'outputSha256'), ('sequenceSha256', 'referenceSequenceSha256')]:
        if expected[field] != capture['expectedPublicReplay'][public_field]:
            raise ValueError('Frozen standalone state disagrees with pipeline public state: ' + field)
    return verified


def allocation_problems(row, record):
    problems = []
    for field, origin in [('occupancyAtSetup', 'postMetricSetupReconstruction'), ('occupancyAtEnd', 'measuredInstanceAfterFrozenMetrics')]:
        diagnostic = row.get(field)
        if not isinstance(diagnostic, dict) or diagnostic.get('diagnosticOrigin') != origin or not isinstance(diagnostic.get('storages'), dict) or set(diagnostic['storages']) != {'usedCellsFlat', 'portOwnerFlat', 'usedDiagFlat'}:
            problems.append('Missing allocation diagnostic or incorrect post-metric origin: ' + field)
            continue
        if any(type(diagnostic.get(key)) is not int or diagnostic[key] < 0 for key in ['payloadBytes', 'logicalBytes']):
            problems.append('Allocation totals must be nonnegative integer bytes: ' + field)
        payload, logical = 0, 0
        for name, storage in diagnostic['storages'].items():
            if not isinstance(storage, dict) or any(type(storage.get(key)) is not int or storage[key] < 0 for key in ['logicalLength', 'logicalBytes', 'payloadBytes']):
                problems.append('Invalid actual allocation bytes: ' + field + '/' + name)
                continue
            if storage['logicalBytes'] != storage['logicalLength'] * 4 or storage['payloadBytes'] > storage['logicalBytes']:
                problems.append('Allocation logical length/payload mismatch: ' + field + '/' + name)
            payload += storage['payloadBytes']
            logical += storage['logicalBytes']
            if storage.get('representation') == 'native-dense':
                if storage['payloadBytes'] != storage['logicalBytes'] or storage.get('pageCount') is not None or storage.get('directorySlotCount') is not None:
                    problems.append('Native storage misreported as page storage: ' + field + '/' + name)
            elif storage.get('representation') == 'paged':
                count, slots = storage.get('pageCount'), storage.get('directorySlotCount')
                if type(count) is not int or type(slots) is not int or not 0 <= count <= slots or slots != math.ceil(storage['logicalLength'] / 4096) or storage['payloadBytes'] > count * 4096 * 4 or (count == 0) != (storage['payloadBytes'] == 0):
                    problems.append('Paged allocation counts/payload inconsistent: ' + field + '/' + name)
                else:
                    expected_payloads = {count * 4096 * 4}
                    tail_cells = storage['logicalLength'] % 4096
                    if count > 0 and tail_cells:
                        expected_payloads.add((count - 1) * 4096 * 4 + tail_cells * 4)
                    if storage['payloadBytes'] not in expected_payloads:
                        problems.append('Actual page payload must equal whole 4096-cell buffers plus an optional exact final tail: ' + field + '/' + name)
            else:
                problems.append('Unknown actual storage representation: ' + field + '/' + name)
        if diagnostic.get('payloadBytes') != payload or diagnostic.get('logicalBytes') != logical or logical != record['selection']['logicalOwnerBytes']:
            problems.append('Three-storage diagnostic totals differ from actual frozen logical selection: ' + field)
    return problems


async def one(cfg, case, arm, cpu, mode, order, position, frozen=None):
    label = f'{mode}-{order}-{position}-{arm}-{case["dataset"]}-{case["sample"]:03}'
    folder = OUT / 'tasks' / label
    folder.mkdir(parents=True, exist_ok=False)
    inputs = json.loads((OUT / 'inputs' / 'manifest.json').read_text())
    source_input = next(item for item in inputs if item['dataset'] == case['dataset'] and item['sample'] == case['sample'])
    input_path = OUT / 'inputs' / source_input['filename']
    if digest(input_path) != source_input['inputSha256']:
        raise ValueError('Prepared source input changed')
    task = {
        'repo': str(SOURCES / arm), 'arm': arm,
        'sourceSha': cfg['base_sha'] if arm == 'base' else cfg['candidates'][arm],
        'mode': mode, **case, 'effort': cfg['effort'],
        'resultPath': str(folder / 'result.json'), 'progressPath': str(folder / 'progress.json'),
        'hashAfterPerformance': True, 'cacheMode': 'production-default',
        'inputPath': str(input_path), 'inputSha256': source_input['inputSha256'],
        'scenarioName': source_input['scenarioName'], 'totalSamples': source_input['totalSamples'],
    }
    if mode == 'capture':
        task['componentCapturePath'] = str(folder / 'component-capture.json')
    else:
        if digest(pathlib.Path(frozen['capturePath'])) != frozen['captureSha256']:
            raise ValueError('Frozen baseline component capture changed before task')
        task.update(componentCapturePath=frozen['capturePath'], componentCaptureSha256=frozen['captureSha256'])
        if mode == 'verify':
            task['componentVerifiedPath'] = str(folder / 'component-verified.json')
        elif mode == 'replay':
            if digest(pathlib.Path(frozen['verifiedPath'])) != frozen['verifiedSha256']:
                raise ValueError('Frozen official standalone verification changed before measurement')
            task.update(componentVerifiedPath=frozen['verifiedPath'], componentVerifiedSha256=frozen['verifiedSha256'])
        else:
            raise ValueError('Unknown diagnostic task mode')
    save(folder / 'task.json', task)
    start = time.monotonic()
    started_at = time.time()
    phase, phase_start = 'loading', start
    killed, parent_peak = None, 0
    with (folder / 'stdout.log').open('w') as stdout, (folder / 'stderr.log').open('w') as stderr:
        process = await asyncio.create_subprocess_exec(
            'taskset', '-c', str(cpu), 'bun', '--tsconfig-override', str(SOURCES / arm / 'tsconfig.json'),
            str(HERE / 'child.ts'), str(folder / 'task.json'), cwd=SOURCES / arm,
            stdout=stdout, stderr=stderr, start_new_session=True,
        )
        deadline = {
            'loading': cfg['startup_timeout_s'], 'constructor': cfg['startup_timeout_s'],
            'setup': cfg['startup_timeout_s'], 'solve': cfg['capture_timeout_s'],
            'validation': cfg['validation_timeout_s'], 'verify': cfg['replay_timeout_s'],
            'replay': cfg['replay_timeout_s'], 'hash': cfg['hash_timeout_s'],
            'diagnostics': cfg['hash_timeout_s'], 'complete': 30,
        }
        while process.returncode is None:
            state = read_progress(folder / 'progress.json')
            if state and state['phase'] != phase:
                phase, phase_start = state['phase'], time.monotonic()
            if phase not in deadline:
                raise ValueError('Child reported an unknown phase: ' + str(phase))
            try:
                for line in pathlib.Path(f'/proc/{process.pid}/status').read_text().splitlines():
                    if line.startswith('VmRSS:'):
                        parent_peak = max(parent_peak, int(line.split()[1]) * 1024)
            except FileNotFoundError:
                pass
            if time.monotonic() - phase_start > deadline[phase]:
                killed = f'timeout_{phase}'
            if parent_peak > cfg['child_memory_limit_mib'] * 1024 * 1024:
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
        row = {**checkpoint, 'status': killed, 'lastProgress': last_progress}
    elif process.returncode != 0 or not (folder / 'result.json').is_file():
        row = {'status': 'harness_error', 'stderrTail': (folder / 'stderr.log').read_text()[-4000:]}
    else:
        row = json.loads((folder / 'result.json').read_text())
    if mode == 'replay':
        for field in [*NATIVE_FIELDS, *TIME_FIELDS]:
            row.setdefault(field, None)
    row.update({
        'taskId': label, 'arm': arm, 'mode': mode, **case, 'order': order, 'position': position,
        'cpu': cpu, 'startedAtUnix': started_at, 'wallMs': (time.monotonic() - start) * 1000,
        'exitCode': process.returncode, 'parentObservedWholeProcessPeakRssBytes': parent_peak,
        'inputSha256': task['inputSha256'],
        'measurementScope': 'Standalone A01 only; not a global pipeline gain' if mode == 'replay' else 'UNMEASURED diagnostic; timing/RSS cannot establish improvement',
        'performanceObservation': mode == 'replay',
    })
    if mode != 'capture':
        row['frozenCaptureSha256'] = frozen['captureSha256']
    if mode == 'replay':
        row['frozenVerifiedSha256'] = frozen['verifiedSha256']
    save(folder / 'record.json', row)
    with (OUT / 'results.jsonl').open('a') as file:
        file.write(json.dumps(row, separators=(',', ':')) + '\n')
    emit('PROOF_RESULT', row)
    return row, task


async def run(cfg):
    cpus = sorted(os.sched_getaffinity(0))[:2]
    memory_info = memory_preflight(2, cfg['child_memory_limit_mib'])
    runtime = {
        'pid': os.getpid(), 'cpuAffinity': sorted(os.sched_getaffinity(0)), 'laneCpus': cpus,
        'platform': sys.platform, 'architecture': os.uname().machine,
        'memoryPreflight': memory_info, 'runnerName': os.environ.get('RUNNER_NAME'),
        'controllerSha': os.environ.get('GITHUB_SHA'), 'cacheMode': 'production-default',
        'pipelineCacheProvider': 'global-in-memory-default',
        'scope': '2unmeasured baseline pipeline captures,2unmeasured stock standalone verifications,8fresh standalone A01 ABBA performance observations. Global paged gates remain FAILED.',
        'nativeMetricBoundaries': 'Afterconstructor+setup and afterexactreplay sequence, beforeANYoutput/statehash/pagecounts. Parent whole-process RSS is separate, includes later diagnostics, and is never substituted.',
    }
    save(OUT / 'runtime.json', runtime)
    emit('PROOF_RUNTIME', runtime)
    captures = await asyncio.gather(*(one(cfg, case, 'base', cpus[index], 'capture', 'diagnostic', 0) for index, case in enumerate(cfg['cases'])))
    frozen = []
    for case, (row, task) in zip(cfg['cases'], captures):
        path = pathlib.Path(task['componentCapturePath'])
        capture = validate_capture(cfg, case, row, path)
        target = OUT / 'frozen-captures' / f'{case["dataset"]}-{case["sample"]}.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
        frozen.append({**case, 'capturePath': str(target), 'captureSha256': digest(target), 'selection': capture['selection'], 'expectedPublicReplay': capture['expectedPublicReplay']})
    save(OUT / 'frozen-captures.json', frozen)
    emit('PROOF_COMPONENT_CAPTURES', frozen)
    verified_rows = await asyncio.gather(*(one(cfg, case, 'base', cpus[index], 'verify', 'diagnostic', 0, frozen[index]) for index, case in enumerate(cfg['cases'])))
    for index, (case, (row, task)) in enumerate(zip(cfg['cases'], verified_rows)):
        record = frozen[index]
        capture = json.loads(pathlib.Path(record['capturePath']).read_text())
        path = pathlib.Path(task['componentVerifiedPath'])
        verified = validate_verified(row, path, capture, record['captureSha256'], cfg)
        target = OUT / 'frozen-verified' / f'{case["dataset"]}-{case["sample"]}.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
        record.update(verifiedPath=str(target), verifiedSha256=digest(target), expectedReplayFingerprint=verified['expectedReplayFingerprint'])
    save(OUT / 'frozen-verified.json', frozen)
    emit('PROOF_COMPONENT_VERIFIED', frozen)

    async def lane(index):
        case, record = cfg['cases'][index], frozen[index]
        for order in ['AB', 'BA']:
            for position, symbol in enumerate(order):
                arm = 'base' if symbol == 'A' else cfg['selected_candidate']
                await one(cfg, case, arm, cpus[index], 'replay', order, position, record)

    await asyncio.gather(*(lane(index) for index in range(2)))
    for record in frozen:
        if digest(pathlib.Path(record['capturePath'])) != record['captureSha256'] or digest(pathlib.Path(record['verifiedPath'])) != record['verifiedSha256']:
            raise ValueError('Frozen component inputs or stock verification changed during measurement')


def evaluate_replays(cfg, rows, frozen):
    result = {'expectedMeasuredRecords': 8, 'measuredRecords': len(rows), 'qualityPass': True, 'componentGatePass': True, 'pairs': [], 'problems': [], 'globalGateStatus': 'FAILED_UNCHANGED', 'scope': 'Component only. A component win does not establish global speed/memory improvement, does not waive prior global gates, and does not authorize full-run promotion or a PR.'}
    if len(rows) != 8:
        result['problems'].append('Expected exactly8measured replay rows')
    expected_cases = [{'dataset': 'srj18', 'sample': 15}, {'dataset': 'srj24', 'sample': 20}]
    if cfg['cases'] != expected_cases or cfg['base_sha'] != '0da00f5bef6d9945b3fa63e1aa72c138e68e1c7f' or cfg['candidates'] != {'paged_occupancy': '87529e893888fec3831a18444ccfdd085a2bdd4c'} or cfg['orders'] != ['AB', 'BA'] or cfg['cycles'] != 1:
        result['problems'].append('Frozen source/case/order configuration was changed')
    if {(r.get('dataset'), r.get('sample'), r.get('order'), r.get('position'), r.get('arm')) for r in rows} != {(c['dataset'], c['sample'], o, p, 'base' if s == 'A' else cfg['selected_candidate']) for c in expected_cases for o in ['AB', 'BA'] for p, s in enumerate(o)} or any(type(r.get('position')) is not int or type(r.get('sample')) is not int for r in rows):
        result['problems'].append('Missing/duplicate/unexpected measured ABBA task identity')
    if len(frozen) != 2 or {(r.get('dataset'), r.get('sample')) for r in frozen} != {('srj18', 15), ('srj24', 20)}:
        result['problems'].append('Missing/duplicate/unexpected frozen capture/verification inventory')
    case_cpus = []
    for case in expected_cases:
        cohort = [r for r in rows if (r.get('dataset'), r.get('sample')) == (case['dataset'], case['sample'])]
        cpus = {r.get('cpu') for r in cohort}
        if len(cpus) != 1 or any(type(cpu) is not int or cpu < 0 for cpu in cpus):
            result['problems'].append('A case changed CPU lanes within its standalone ABBA sequence')
        else:
            case_cpus.append(next(iter(cpus)))
        if [(r.get('order'), r.get('position')) for r in cohort] != [('AB', 0), ('AB', 1), ('BA', 0), ('BA', 1)]:
            result['problems'].append('Raw result ordering does not preserve sequential same-case AB then BA')
        starts = [r.get('startedAtUnix') for r in cohort]
        if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0 for value in starts) or any(a >= b for a, b in zip(starts, starts[1:])):
            result['problems'].append('Actual task start timestamps do not preserve same-case AB then BA')
    if len(case_cpus) != 2 or len(set(case_cpus)) != 2:
        result['problems'].append('The two independent cases did not retain distinct fixed CPU lanes')
    for case in cfg['cases']:
        record = next((r for r in frozen if (r['dataset'], r['sample']) == (case['dataset'], case['sample'])), None)
        for order in ['AB', 'BA']:
            cohort = [r for r in rows if (r['dataset'], r['sample'], r['order']) == (case['dataset'], case['sample'], order)]
            pair = {arm: [r for r in cohort if r['arm'] == arm] for arm in ['base', cfg['selected_candidate']]}
            item = {**case, 'order': order, 'qualityPass': True, 'metricsAvailable': True, 'problems': []}
            if record is None or any(len(group) != 1 for group in pair.values()):
                item.update(qualityPass=False, metricsAvailable=False)
                item['problems'].append('Missing frozen input or exact per-arm observation')
            else:
                selected = {arm: group[0] for arm, group in pair.items()}
                for arm, row in selected.items():
                    expected_source = cfg['base_sha'] if arm == 'base' else cfg['candidates'][arm]
                    expected_task = f'replay-{order}-{row.get("position")}-{arm}-{case["dataset"]}-{case["sample"]:03}'
                    if row.get('mode') != 'replay' or row.get('taskId') != expected_task or row.get('status') != 'replayed' or row.get('exitCode') != 0 or row.get('sourceSha') != expected_source or row.get('cacheMode') != 'production-default' or row.get('bunVersion') != cfg['bun_version'] or row.get('effort') != 1 or row.get('inputSha256') != cfg['baseline_quality_fingerprints'][f'{case["dataset"]}/{case["sample"]}']['inputSha256'] or row.get('inputCaptureSha256') != record['captureSha256'] or row.get('frozenCaptureSha256') != record['captureSha256'] or row.get('frozenVerifiedSha256') != record['verifiedSha256'] or row.get('unmeasuredStockVerificationSha256') != record['verifiedSha256'] or row.get('publicTrajectoryObservation') != 'baseline-capture-and-unmeasured-stock-verification-only; measuredpassdoesnotobserveeachframe' or row.get('publicReplayFingerprint') != record['expectedPublicReplay'] or row.get('replayFingerprint') != record['expectedReplayFingerprint']:
                        item['qualityPass'] = False
                        item['problems'].append(arm + ': incomplete/censored/capture-public/private-state mismatch')
                    allocation_errors = allocation_problems(row, record)
                    if allocation_errors:
                        item['qualityPass'] = False
                        item['problems'].extend(arm + ': ' + error for error in allocation_errors)
                    for field in [*NATIVE_FIELDS, *TIME_FIELDS]:
                        value = row.get(field)
                        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or (field in NATIVE_FIELDS and type(value) is not int) or (value <= 0 if field in NATIVE_FIELDS or field == 'totalReplayMs' else value < 0):
                            item['metricsAvailable'] = False
                            item['problems'].append(arm + ': missing/invalid native metric ' + field)
                    if item['metricsAvailable']:
                        if not row['peakRssBeforeConstructorBytes'] <= row['peakRssAfterSetupBytes'] <= row['peakRssAfterReplayBytes']:
                            item['metricsAvailable'] = False
                            item['problems'].append(arm + ': native high-water checkpoints not monotonic')
                        if not math.isclose(row['totalReplayMs'], row['constructorMs'] + row['setupMs'] + row['replayMs'], rel_tol=1e-10, abs_tol=1e-6):
                            item['metricsAvailable'] = False
                            item['problems'].append(arm + ': total time is not the declared constructor/setup/replay sum')
                item['observations'] = {arm: {key: row.get(key) for key in [*NATIVE_FIELDS, *TIME_FIELDS, 'occupancyAtSetup', 'occupancyAtEnd', 'status', 'parentObservedWholeProcessPeakRssBytes']} for arm, row in selected.items()}
                if item['qualityPass'] and item['metricsAvailable']:
                    base, candidate = selected['base'], selected[cfg['selected_candidate']]
                    item['afterReplayNativeRssRatio'] = candidate['peakRssAfterReplayBytes'] / base['peakRssAfterReplayBytes']
                    item['totalReplayTimeRatio'] = candidate['totalReplayMs'] / base['totalReplayMs']
                    item['afterSetupNativeRssRatioSecondary'] = candidate['peakRssAfterSetupBytes'] / base['peakRssAfterSetupBytes']
                    rss_limit = cfg['acceptance']['maximumAfterReplayNativeRssRatioByCase'][f'{case["dataset"]}/{case["sample"]}']
                    item['afterReplayNativeRssRatioLimit'] = rss_limit
                    rss_pass = candidate['peakRssAfterReplayBytes'] * 4 <= base['peakRssAfterReplayBytes'] * 3 if (case['dataset'], case['sample']) == ('srj18', 15) else candidate['peakRssAfterReplayBytes'] * 20 <= base['peakRssAfterReplayBytes'] * 21
                    time_pass = decimal.Decimal(str(candidate['totalReplayMs'])) * 20 <= decimal.Decimal(str(base['totalReplayMs'])) * 21
                    item['rawIntegerRssCriterionPass'] = rss_pass
                    item['exactReportedDecimalTimeCriterionPass'] = time_pass
                    item['componentGatePass'] = rss_pass and time_pass
            item.setdefault('componentGatePass', False)
            result['qualityPass'] = result['qualityPass'] and item['qualityPass'] and item['metricsAvailable']
            result['componentGatePass'] = result['componentGatePass'] and item['componentGatePass']
            result['pairs'].append(item)
    if result['problems']:
        result['qualityPass'] = result['componentGatePass'] = False
    return result


def summary(cfg):
    rows = [json.loads(line) for line in (OUT / 'results.jsonl').read_text().splitlines()] if (OUT / 'results.jsonl').is_file() else []
    captures = [r for r in rows if r['mode'] == 'capture']
    verifications = [r for r in rows if r['mode'] == 'verify']
    replays = [r for r in rows if r['mode'] == 'replay']
    frozen = json.loads((OUT / 'frozen-verified.json').read_text()) if (OUT / 'frozen-verified.json').is_file() else []
    result = evaluate_replays(cfg, replays, frozen)
    result.update(phase=cfg['phase'], records=len(rows), expectedRecords=12, captureRecords=len(captures), expectedCaptureRecords=2, verificationRecords=len(verifications), expectedVerificationRecords=2, runComplete=len(rows) == 12, capturesPerformanceEvidence=False, verificationsPerformanceEvidence=False, setupAllocationScope='occupancyAtSetup is a separately reconstructed setup-only diagnostic AFTER measured native boundaries, not a primary-window pagecount or nativeRSS sample. occupancyAtEnd is actual replay solver state AFTER boundaries. Neither payload count is peak/cumulative memory.', censoredRows=[{key: row.get(key) for key in ['taskId', 'mode', 'status', *NATIVE_FIELDS, 'parentObservedWholeProcessPeakRssBytes', 'lastProgress']} for row in rows if row['status'] not in ['solved', 'verified', 'replayed']])
    if len(captures) != 2 or len(verifications) != 2 or len(rows) != 12:
        result['qualityPass'] = result['componentGatePass'] = False
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
            raise ValueError('Refuse to mix prior results with a fresh component diagnostic')
        before = overlay.guard(cfg)
        if before != json.loads((OUT / 'dependency-overlay-guard-before.json').read_text()):
            raise ValueError('Source/dependency/overlay changed after install')
        try:
            asyncio.run(run(cfg))
        finally:
            after = overlay.guard(cfg)
            save(OUT / 'dependency-overlay-guard-after.json', after)
            emit('PROOF_DEPENDENCY_OVERLAY_GUARD', {'before': overlay.guard_summary(before), 'after': overlay.guard_summary(after), 'equal': before == after})
            if before != after:
                raise ValueError('Source/dependency/overlay changed during diagnostic')
        if not summary(cfg)['qualityPass']:
            raise ValueError('Component diagnostic did not complete its immutable input, native-boundary and exact semantic parity protocol')
    elif action == 'summary':
        summary(cfg)
    else:
        raise ValueError('Unknown controller action')
