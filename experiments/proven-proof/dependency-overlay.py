"""One explicitly pinned upstream TS package; no installed package source edits."""
import hashlib
import json
import os
import pathlib
import re
import subprocess

ROOT = pathlib.Path.cwd()
SOURCES = ROOT / 'proof-source'
UPSTREAM = ROOT / 'proof-upstream'
OUT = ROOT / 'proof-results'
PACKAGE = '@tscircuit/high-density-a01'
UPSTREAM_REPO = 'tscircuit/high-density-a01'
BASE_UPSTREAM = '10cdce5ad507adfaaec8ac32ea905ab02ffefa8a'
PIN_PREFIX = 'git+https://github.com/' + UPSTREAM_REPO + '.git#'
IMPORT_RE = re.compile(r'''(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']''')


def command(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')


def validate_config(cfg):
    mode = cfg['dependency_overlay']
    if mode['mode'] != 'one-frozen-typescript-git-dependency' or mode['name'] != PACKAGE or mode['repository'] != UPSTREAM_REPO or mode['base_sha'] != BASE_UPSTREAM:
        raise ValueError('Unexpected dependency overlay scope')
    if len(cfg['candidates']) != 1:
        raise ValueError('This dependency overlay permits exactly one candidate')
    if not re.fullmatch('[0-9a-f]{40}', mode['candidate_sha']) or mode['candidate_sha'] == '0' * 40:
        raise ValueError('Upstream candidate requires a literal nonzero full SHA')
    expected = ['lib/HighDensitySolverA01/HighDensitySolverA01.ts', 'tests/a01/zero-initialized-occupancy.test.ts']
    if sorted(mode['upstream_changed_files']) != sorted(expected):
        raise ValueError('Only the authorized A01 source and one focused test may differ')
    if mode['root_changed_files'] != ['package.json']:
        raise ValueError('This zero-occupancy experiment permits only the root package Git pin change')


def validate_root_pair(cfg, target):
    mode = cfg['dependency_overlay']
    base = SOURCES / 'base'
    left = json.loads((base / 'package.json').read_text())
    right = json.loads((target / 'package.json').read_text())
    if left['devDependencies'][PACKAGE] != PIN_PREFIX + mode['base_sha'] or right['devDependencies'][PACKAGE] != PIN_PREFIX + mode['candidate_sha']:
        raise ValueError('Root dependency pins do not match the two frozen upstream commits')
    right['devDependencies'][PACKAGE] = left['devDependencies'][PACKAGE]
    if left != right:
        raise ValueError('Root package manifest changed beyond the one allowed upstream git pin')
    changed = command(['git', 'diff', '--name-only', cfg['base_sha'], 'HEAD'], target).splitlines()
    if sorted(changed) != sorted(mode['root_changed_files']):
        raise ValueError('Root candidate diff does not match its frozen source/test whitelist')


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


def tracked_guard(path):
    if command(['git', 'status', '--porcelain', '--untracked-files=no'], path):
        raise ValueError('Dirty pinned Git source: ' + str(path))
    return {'sha': command(['git', 'rev-parse', 'HEAD'], path), 'tree': command(['git', 'rev-parse', 'HEAD^{tree}'], path), **tracked_source_manifest(path)}


def prepare_upstreams(cfg):
    mode = cfg['dependency_overlay']
    UPSTREAM.mkdir(parents=True, exist_ok=True)
    base = UPSTREAM / 'base'
    command(['git', 'clone', '--filter=blob:none', '--no-checkout', 'https://github.com/' + UPSTREAM_REPO + '.git', str(base)])
    command(['git', 'fetch', '--no-tags', '--depth=2', 'origin', mode['base_sha'], mode['candidate_sha']], base)
    command(['git', 'checkout', '--detach', mode['base_sha']], base)
    candidate = UPSTREAM / cfg['selected_candidate']
    command(['git', 'worktree', 'add', '--detach', str(candidate), mode['candidate_sha']], base)
    if command(['git', 'rev-parse', 'HEAD^'], candidate) != mode['base_sha']:
        raise ValueError('Upstream candidate must be a direct child of frozen official baseline')
    changed = command(['git', 'diff', '--name-only', mode['base_sha'], 'HEAD'], candidate).splitlines()
    if sorted(changed) != sorted(mode['upstream_changed_files']):
        raise ValueError('Upstream diff exceeds its one-source/one-test whitelist')
    manifest = {arm: tracked_guard(UPSTREAM / arm) for arm in ['base', cfg['selected_candidate']]}
    if manifest['base']['sha'] != mode['base_sha'] or manifest[cfg['selected_candidate']]['sha'] != mode['candidate_sha']:
        raise ValueError('Upstream checkout SHA mismatch')
    save('upstream-sources-before.json', manifest)


def walk_files(root):
    seen = set()
    for folder, dirs, names in os.walk(root, followlinks=True):
        stat = os.stat(folder)
        identity = (stat.st_dev, stat.st_ino)
        if identity in seen:
            dirs[:] = []
            continue
        seen.add(identity)
        dirs[:] = sorted(name for name in dirs if name not in ['.git', '.vite', '.cache', '.bin'])
        for name in sorted(names):
            path = pathlib.Path(folder) / name
            if path.is_file():
                yield path


def fingerprint(root):
    rows = [{'path': str(path.relative_to(root)), 'physicalPath': str(path.resolve()), 'sha256': sha(path)} for path in walk_files(root)]
    return {'files': rows, 'fileCount': len(rows), 'sha256': hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()}


def imports(path):
    if path.suffix not in ['.ts', '.js', '.mjs', '.cjs'] or path.name.endswith('.d.ts'):
        return []
    try:
        text = path.read_text()
    except UnicodeError:
        return []
    return [match.group(1) for match in IMPORT_RE.finditer(text) if not match.group(1).startswith(('.', '/', 'node:', 'bun:'))]


def entry_targets(primary, preferred=None):
    values = {}
    for root in [primary, preferred]:
        if root is None or not root.is_dir():
            continue
        for path in root.iterdir():
            if path.name.startswith('@') and path.is_dir():
                for child in path.iterdir():
                    values[path.name + '/' + child.name] = child.resolve()
            else:
                values[path.name] = path.resolve()
    return values


def make_overlay(target, entries):
    target.mkdir()
    for name, physical in sorted(entries.items()):
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(physical, target_is_directory=physical.is_dir())


def resolve_requests(requests):
    task = OUT / 'dependency-resolution-task.json'
    task.write_text(json.dumps(requests))
    script = "const q=JSON.parse(await Bun.file(process.argv[1]).text()); console.log(JSON.stringify(q.map(x=>({...x,resolved:Bun.resolveSync(x.specifier,x.importer)}))))"
    return json.loads(command(['bun', '-e', script, str(task)]))


def install_overlays(cfg, installed):
    mode = cfg['dependency_overlay']
    installed_package = installed / PACKAGE
    expected = tracked_guard(UPSTREAM / 'base')
    official_files = [name for name in expected['files'] if name == 'package.json' or name.startswith('lib/')]
    for name in official_files:
        if not (installed_package / name).is_file() or sha(installed_package / name) != expected['files'][name]:
            raise ValueError('Installed baseline package differs from official Git source: ' + name)
    installed_lib = {str(path.relative_to(installed_package)) for path in (installed_package / 'lib').rglob('*') if path.is_file()}
    if installed_lib != {name for name in official_files if name.startswith('lib/')}:
        raise ValueError('Installed baseline lib inventory differs from official Git tree')
    stock_git_files = {}
    stock_extra_runtime_files = []
    for path in installed_package.rglob('*'):
        if not path.is_file() or any(part in ['node_modules', '.git'] for part in path.relative_to(installed_package).parts):
            continue
        name = str(path.relative_to(installed_package))
        if name in expected['files']:
            actual = sha(path)
            if actual != expected['files'][name]:
                raise ValueError('Stock installed Git package file differs from frozen official checkout: ' + name)
            stock_git_files[name] = actual
        elif path.suffix in ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.toml', '.wasm'] and name not in ['bun.lock', 'bun.lockb']:
            stock_extra_runtime_files.append(name)
    if stock_extra_runtime_files:
        raise ValueError('Unknown runtime files in stock installed package context: ' + str(stock_extra_runtime_files))
    context_names = {'tsconfig.json', 'jsconfig.json', 'bunfig.toml', '.babelrc', '.swcrc'}
    official_context = {name for name in expected['files'] if pathlib.Path(name).name in context_names or pathlib.Path(name).name.startswith('tsconfig.')}
    installed_context = {str(path.relative_to(installed_package)) for path in installed_package.rglob('*') if path.is_file() and 'node_modules' not in path.relative_to(installed_package).parts and (path.name in context_names or path.name.startswith('tsconfig.'))}
    if official_context != installed_context:
        raise ValueError('Stock installed and Git checkout loader/config context inventories differ')
    save('stock-installed-source-context.json', {'officialCommit': mode['base_sha'], 'stockGitFilesVerified': len(stock_git_files), 'files': stock_git_files, 'loaderContextFiles': sorted(official_context), 'scope': 'Every stock-installed file represented in official Git matches byte for byte. Package/lib inventory and loader config presence must match; unknown extra runtime files are rejected.'})
    before_upstream_requests = []
    for name in official_files:
        for specifier in imports(installed_package / name):
            before_upstream_requests.append({'arm': 'installed', 'relativeImporter': name, 'specifier': specifier, 'importer': str(installed_package / name)})
    baseline_resolution = resolve_requests(before_upstream_requests)
    for arm in ['base', cfg['selected_candidate']]:
        for name in official_files:
            if sorted(imports(UPSTREAM / arm / name)) != sorted(imports(installed_package / name)):
                raise ValueError('Upstream bare import graph changed beyond the frozen dependency topology: ' + name)
    # Move the complete single installation as one unit. Both measured root arms
    # then use explicit overlays; no installed source bytes are changed.
    dependency_root = ROOT / 'proof-dependencies'
    dependency_root.mkdir()
    shared = dependency_root / 'node_modules'
    installed.rename(shared)
    installed_package = shared / PACKAGE
    shared_entries = entry_targets(shared)
    requests = []
    for arm in ['base', cfg['selected_candidate']]:
        upstream = UPSTREAM / arm
        root_entries = {**shared_entries, PACKAGE: upstream}
        make_overlay(SOURCES / arm / 'node_modules', root_entries)
        package_entries = entry_targets(shared, installed_package / 'node_modules')
        package_entries[PACKAGE] = upstream
        make_overlay(upstream / 'node_modules', package_entries)
        requests.append({'arm': arm, 'specifier': PACKAGE, 'importer': str(SOURCES / arm / 'lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver.ts'), 'expected': str(upstream / 'lib/index.ts')})
        for row in baseline_resolution:
            requests.append({'arm': arm, 'specifier': row['specifier'], 'relativeImporter': row['relativeImporter'], 'importer': str(upstream / row['relativeImporter']), 'installedResolvedBeforeMove': row['resolved']})
    resolved = resolve_requests(requests)
    for row in resolved:
        if 'expected' in row and pathlib.Path(row['resolved']).resolve() != pathlib.Path(row['expected']).resolve():
            raise ValueError('Root Portfolio resolved the wrong upstream package')
        if 'installedResolvedBeforeMove' in row:
            old = pathlib.Path(row['installedResolvedBeforeMove'])
            expected_path = shared / old.relative_to(installed) if old.is_relative_to(installed) else old
            if pathlib.Path(row['resolved']).resolve() != expected_path.resolve():
                raise ValueError('Upstream transitive dependency resolution changed: ' + row['specifier'])
    external_importers = []
    for path in walk_files(shared):
        if path.resolve().is_relative_to(installed_package.resolve()):
            continue
        for specifier in imports(path):
            if specifier == PACKAGE or specifier.startswith(PACKAGE + '/'):
                external_importers.append({'specifier': specifier, 'importer': str(path)})
    external_resolved = resolve_requests(external_importers)
    for row in external_resolved:
        if pathlib.Path(row['resolved']).resolve().is_relative_to(installed_package.resolve()):
            raise ValueError('Shared runtime importer would bypass the candidate dependency overlay: ' + row['importer'])
    save('dependency-resolution.json', {'baselineInstalled': baseline_resolution, 'armResolution': resolved, 'sharedPackageImporters': external_resolved, 'scanScope': 'Literal static from/require/import specifiers across all installed TS/JS runtime files, following directory symlinks; excludes .d.ts, .vite and .cache. Unknown shared top-package consumers fail shut.'})
    metadata = {'mode': mode['mode'], 'name': PACKAGE, 'shared': str(shared), 'installedBaselineMatchesOfficialGitFiles': len(official_files), 'upstreamCommit': {arm: tracked_guard(UPSTREAM / arm)['sha'] for arm in ['base', cfg['selected_candidate']]}, 'rootOverlay': {arm: str(SOURCES / arm / 'node_modules') for arm in ['base', cfg['selected_candidate']]}, 'resolutionReport': 'dependency-resolution.json'}
    before = guard(cfg)
    save('dependency-overlay-guard-before.json', before)
    metadata.update(stockInstalledGitFilesVerified=len(stock_git_files), loaderContextFiles=sorted(official_context), upstreamTransitiveResolutionCount=len(baseline_resolution), rootPackageResolvedPaths={row['arm']: row['resolved'] for row in resolved if 'expected' in row}, sharedPackageImporters=external_resolved, beforeGuard=guard_summary(before))
    save('dependency-overlay.json', metadata)
    return shared, metadata


def guard_summary(value):
    return {
        'guardSha256': hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest(),
        'roots': {arm: {'sha': item['sha'], 'tree': item['tree'], 'regularFileCount': len(item['files']), 'gitlinks': item['gitlinks'], 'symlinkCount': len(item['symlinks'])} for arm, item in value['roots'].items()},
        'upstream': {arm: {'sha': item['sha'], 'tree': item['tree'], 'regularFileCount': len(item['files']), 'gitlinks': item['gitlinks'], 'symlinkCount': len(item['symlinks'])} for arm, item in value['upstream'].items()},
        'overlayLinkCount': len(value['overlayLinks']),
        'sharedPhysicalFileCount': value['sharedFiles']['fileCount'],
        'sharedPhysicalFilesSha256': value['sharedFiles']['sha256'],
    }


def guard(cfg):
    shared = ROOT / 'proof-dependencies/node_modules'
    links = {}
    for arm in ['base', cfg['selected_candidate']]:
        for target in [SOURCES / arm / 'node_modules', UPSTREAM / arm / 'node_modules']:
            for name, physical in entry_targets(target).items():
                path = target / name
                if not path.is_symlink():
                    raise ValueError('Dependency overlay entry is not a symlink: ' + str(path))
                links[str(path)] = str(physical)
    return {'roots': {arm: tracked_guard(SOURCES / arm) for arm in ['base', cfg['selected_candidate']]}, 'upstream': {arm: tracked_guard(UPSTREAM / arm) for arm in ['base', cfg['selected_candidate']]}, 'overlayLinks': links, 'sharedFiles': fingerprint(shared)}
