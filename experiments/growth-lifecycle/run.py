import asyncio
import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time

ROOT = pathlib.Path.cwd()
HERE = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'proof-results'
BASE = ROOT / 'proof-source/base'


def command(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')


def emit(kind, value):
    print(kind + ' ' + json.dumps(value, separators=(',', ':')), flush=True)


def tracked_source_manifest(path):
    records = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=path, text=True).split('\0')
    files, gitlinks, symlinks, index = {}, {}, {}, {}
    for record in records:
        if not record:
            continue
        header, name = record.split('\t', 1)
        mode, object_sha, stage = header.split()
        if stage != '0':
            raise ValueError('Unmerged tracked source entry: ' + name)
        target = path / name
        index[name] = {'mode': mode, 'objectSha': object_sha}
        if mode in ['100644', '100755']:
            if target.is_symlink() or not target.is_file():
                raise ValueError('Missing or nonregular tracked source file: ' + name)
            files[name] = hashlib.sha256(target.read_bytes()).hexdigest()
        elif mode == '120000':
            if not target.is_symlink():
                raise ValueError('Tracked source symlink is not materialized as a symlink: ' + name)
            link = os.readlink(target)
            symlinks[name] = {'target': link, 'targetSha256': hashlib.sha256(os.fsencode(link)).hexdigest()}
        elif mode == '160000':
            if target.is_symlink():
                raise ValueError('Tracked Gitlink is unexpectedly a symlink: ' + name)
            if not target.exists():
                materialization = {'state': 'absent'}
            elif target.is_symlink() or not target.is_dir():
                raise ValueError('Tracked Gitlink is not a directory: ' + name)
            elif (target / '.git').exists():
                actual_top = pathlib.Path(command(['git', 'rev-parse', '--show-toplevel'], target)).resolve()
                if actual_top != target.resolve():
                    raise ValueError('Initialized Gitlink resolves to a different Git working tree: ' + name)
                actual_head = command(['git', 'rev-parse', 'HEAD'], target)
                if actual_head != object_sha or command(['git', 'status', '--porcelain', '--untracked-files=no'], target):
                    raise ValueError('Initialized Gitlink differs from its recorded object: ' + name)
                materialization = {'state': 'initialized', 'checkedOutSha': actual_head}
            elif not any(target.iterdir()):
                materialization = {'state': 'uninitialized-empty-directory'}
            else:
                raise ValueError('Uninitialized Gitlink contains unauthenticated files: ' + name)
            gitlinks[name] = {'mode': mode, 'objectSha': object_sha, **materialization}
        else:
            raise ValueError('Unsupported tracked source mode ' + mode + ': ' + name)
    return {'files': files, 'gitlinks': gitlinks, 'symlinks': symlinks, 'index': index}


def source_guard():
    if command(['git', 'status', '--porcelain', '--untracked-files=no'], BASE):
        raise ValueError('Diagnostic source is dirty')
    tracked = tracked_source_manifest(BASE)
    official = json.loads((HERE / 'official-hd-source.json').read_text())
    package = BASE / 'node_modules/@tscircuit/high-density-a01'
    hd_files = {}
    for item in official['files']:
        actual = hashlib.sha256((package / item['path']).read_bytes()).hexdigest()
        if actual != item['sha256']:
            raise ValueError('Installed HD package does not match official Git source: ' + item['path'])
        hd_files[item['path']] = actual
    dependency_manifests = {}
    seen = set()
    shared = BASE / 'node_modules'
    for folder, dirs, files in os.walk(shared, followlinks=True):
        stat = os.stat(folder)
        identity = (stat.st_dev, stat.st_ino)
        if identity in seen:
            dirs[:] = []
            continue
        seen.add(identity)
        dirs[:] = sorted(name for name in dirs if name not in ['.git', '.vite', '.cache', '.bin'])
        if 'package.json' in files:
            path = pathlib.Path(folder) / 'package.json'
            dependency_manifests[str(path.relative_to(shared))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {'sha': command(['git', 'rev-parse', 'HEAD'], BASE), 'tree': command(['git', 'rev-parse', 'HEAD^{tree}'], BASE), 'sourceFiles': tracked['files'], 'sourceGitlinks': tracked['gitlinks'], 'sourceSymlinks': tracked['symlinks'], 'sourceIndex': tracked['index'], 'officialHdSourceCommit': official['commit'], 'officialHdFiles': hd_files, 'singlePhysicalNodeModules': str(shared.resolve()), 'installedPackageManifestSha256': hashlib.sha256(json.dumps(dependency_manifests, sort_keys=True).encode()).hexdigest(), 'installedPackageManifestCount': len(dependency_manifests)}


async def child(cfg, case, cpu, instrumented):
    arm = 'instrumented' if instrumented else 'reference'
    directory = OUT / 'tasks' / f'{case["dataset"]}-{case["sample"]:03}-{arm}'
    directory.mkdir(parents=True)
    inputs = json.loads((OUT / 'inputs/manifest.json').read_text())
    item = next(value for value in inputs if value['dataset'] == case['dataset'] and value['sample'] == case['sample'])
    task = {'repo': str(BASE), 'arm': 'base', 'sourceSha': cfg['base_sha'], 'mode': 'correctness', 'dataset': case['dataset'], 'sample': case['sample'], 'effort': cfg['effort'], 'inputPath': str(OUT / 'inputs' / item['filename']), 'inputSha256': item['inputSha256'], 'scenarioName': item['scenarioName'], 'totalSamples': item['totalSamples'], 'hashAfterPerformance': True, 'cacheMode': 'production-default', 'resultPath': str(directory / 'result.json'), 'progressPath': str(directory / 'progress.json'), 'detailsPath': str(directory / 'lifecycle-details.json')}
    (directory / 'task.json').write_text(json.dumps(task))
    phase = 'loading'
    phase_start = time.monotonic()
    killed = None
    with (directory / 'stdout.log').open('w') as stdout, (directory / 'stderr.log').open('w') as stderr:
        process = await asyncio.create_subprocess_exec('taskset', '-c', str(cpu), 'bun', '--tsconfig-override', str(BASE / 'tsconfig.json'), str(HERE / ('lifecycle.ts' if instrumented else 'reference-child.ts')), str(directory / 'task.json'), cwd=BASE, stdout=stdout, stderr=stderr, start_new_session=True)
        while process.returncode is None:
            try:
                observed = json.loads((directory / 'progress.json').read_text())['phase']
            except (FileNotFoundError, json.JSONDecodeError):
                observed = phase
            if observed != phase:
                phase, phase_start = observed, time.monotonic()
            limits = {'loading': cfg['startup_timeout_s'], 'constructor': cfg['startup_timeout_s'], 'solve': cfg['solve_timeout_s'], 'validation': cfg['validation_timeout_s'], 'hash': cfg['hash_timeout_s'], 'complete': 30}
            if time.monotonic() - phase_start > limits[phase]:
                killed = 'timeout_' + phase
            try:
                status = pathlib.Path(f'/proc/{process.pid}/status').read_text().splitlines()
                rss = int(next(line for line in status if line.startswith('VmRSS:')).split()[1]) * 1024
                if rss > cfg['child_memory_limit_mib'] * 1024 * 1024:
                    killed = 'external_safety_memory_limit_' + phase
            except (FileNotFoundError, StopIteration):
                pass
            if killed:
                os.killpg(process.pid, signal.SIGKILL)
                break
            await asyncio.sleep(0.25)
        await process.wait()
    if killed or process.returncode != 0:
        failure = {'dataset': case['dataset'], 'sample': case['sample'], 'arm': arm, 'status': killed or 'harness_error', 'exitCode': process.returncode, 'stderrTail': (directory / 'stderr.log').read_text()[-4000:], 'scope': 'Incomplete diagnostic; no route or unused-work parity claim.'}
        save('failure-' + directory.name + '.json', failure)
        emit('LIFECYCLE_FAILURE', failure)
        raise RuntimeError('Lifecycle diagnostic did not complete: ' + directory.name)
    return json.loads((directory / 'result.json').read_text())


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


async def run(cfg):
    cpus = sorted(os.sched_getaffinity(0))[:cfg['cpu_lanes']]
    if len(cpus) != cfg['cpu_lanes']:
        raise ValueError('Insufficient isolated diagnostic CPU capacity')
    memory = memory_preflight(len(cpus), cfg['child_memory_limit_mib'])
    effective, required = memory['effectiveCapacityBytes'], memory['requiredCapacityBytes']
    emit('LIFECYCLE_RUNTIME', {'controllerSha': os.environ.get('GITHUB_SHA'), 'bunVersion': command(['bun', '--version']), 'laneCpus': cpus, 'effectiveMemoryBytes': effective, 'requiredMemoryBytes': required, 'memoryPreflight': memory, 'scope': cfg['scope']})
    async def lane(index, cpu):
        for case in cfg['cases'][index::len(cpus)]:
            reference = await child(cfg, case, cpu, False)
            instrumented = await child(cfg, case, cpu, True)
            fields = ['status', 'inputSha256', 'iterations', 'drcErrorCount', 'boardAwareDrcErrorCount', 'traceLintIssueCounts', 'traceCount', 'hashes']
            differences = [field for field in fields if reference.get(field) != instrumented.get(field)]
            result = {'dataset': case['dataset'], 'sample': case['sample'], 'cpu': cpu, 'sourceSha': cfg['base_sha'], 'scope': cfg['scope'], 'uninstrumentedVsInstrumentedParity': not differences, 'differences': differences, 'reference': {field: reference.get(field) for field in fields}, 'instrumented': {field: instrumented.get(field) for field in fields}, 'diagnostics': instrumented['diagnostics']}
            save(f'result-{case["dataset"]}-{case["sample"]:03}.json', result)
            emit('LIFECYCLE_RESULT', result)
            if differences:
                raise ValueError('Instrumentation changed complete routing output/work: ' + str(case))
    outcomes = await asyncio.gather(*(lane(index, cpu) for index, cpu in enumerate(cpus)), return_exceptions=True)
    errors = [str(value) for value in outcomes if isinstance(value, BaseException)]
    if errors:
        raise RuntimeError('Lifecycle lanes failed after every child finished: ' + '; '.join(errors))


if __name__ == '__main__':
    cfg = json.loads((HERE / 'config.json').read_text())
    if cfg['base_sha'] != '3c42bb98f062c00cce2a5cd617553b7968c3f201' or not re.fullmatch('[a-f0-9]{40}', cfg['base_sha']):
        raise ValueError('Unexpected lifecycle diagnostic baseline')
    if cfg['cache_mode'] != 'production-default':
        raise ValueError('Lifecycle diagnostic requires production defaults')
    OUT.mkdir(parents=True, exist_ok=True)
    action = sys.argv[1]
    if action == 'refs':
        with open(os.environ['GITHUB_OUTPUT'], 'a') as file:
            file.write('base_sha=' + cfg['base_sha'] + '\n')
    elif action == 'install':
        if command(['git', 'rev-parse', 'HEAD'], BASE) != cfg['base_sha'] or command(['bun', '--version']) != cfg['bun_version']:
            raise ValueError('Lifecycle source/Bun pin mismatch')
        tracked = command(['git', 'ls-files', 'bun.lock', 'bun.lockb'], BASE).splitlines()
        subprocess.run(['bun', 'install'] + (['--frozen-lockfile'] if tracked else []), cwd=BASE, check=True)
        initial_guard = source_guard()
        save('source-before.json', initial_guard)
        emit('LIFECYCLE_SOURCES', {**{key: value for key, value in initial_guard.items() if key not in ['sourceFiles', 'sourceIndex', 'officialHdFiles']}, 'regularFileCount': len(initial_guard['sourceFiles']), 'officialHdFileCount': len(initial_guard['officialHdFiles']), 'guardSha256': hashlib.sha256(json.dumps(initial_guard, sort_keys=True).encode()).hexdigest()})
        save('protocol.json', cfg)
        subprocess.run(['bun', '--tsconfig-override', str(BASE / 'tsconfig.json'), str(HERE / 'prepare-inputs.ts'), str(BASE), str(OUT / 'protocol.json'), str(OUT / 'inputs')], cwd=BASE, check=True)
        emit('LIFECYCLE_INPUTS', json.loads((OUT / 'inputs/manifest.json').read_text()))
    elif action == 'run':
        before = source_guard()
        if before != json.loads((OUT / 'source-before.json').read_text()):
            raise ValueError('Lifecycle source changed after installation')
        if list(OUT.glob('result-*.json')):
            raise ValueError('Refuse to mix existing diagnostic results')
        try:
            asyncio.run(run(cfg))
        finally:
            after = source_guard()
            save('source-after.json', after)
            emit('LIFECYCLE_SOURCE_GUARD', {'beforeSha256': hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(), 'afterSha256': hashlib.sha256(json.dumps(after, sort_keys=True).encode()).hexdigest(), 'equal': after == before, 'regularFileCount': len(after['sourceFiles']), 'gitlinks': after['sourceGitlinks'], 'symlinkCount': len(after['sourceSymlinks']), 'officialHdFileCount': len(after['officialHdFiles']), 'installedPackageManifestSha256': after['installedPackageManifestSha256']})
            if after != before:
                raise ValueError('Lifecycle source or official package changed during diagnostic')
        emit('LIFECYCLE_COMPLETE', {'cases': len(cfg['cases']), 'freshReferenceProcesses': len(cfg['cases']), 'freshInstrumentedProcesses': len(cfg['cases']), 'sourceAndOfficialPackageUnchanged': True, 'scope': cfg['scope']})
    else:
        raise ValueError('Unknown lifecycle diagnostic action')
