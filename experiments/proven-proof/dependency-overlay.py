"""One unedited published npm upgrade with private, authenticated loader contexts."""
import base64
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import tarfile
import urllib.request

ROOT = pathlib.Path.cwd()
SOURCES = ROOT / 'proof-source'
UPSTREAM = ROOT / 'proof-upstream'
OUT = ROOT / 'proof-results'
PACKAGE = 'circuit-json-to-connectivity-map'
HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('context_clone', HERE / 'context-clone.py')
context = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(context)

def command(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')

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


def validate_config(cfg):
    mode = cfg['dependency_overlay']
    if mode['mode'] != 'one-frozen-published-npm-dependency' or mode['name'] != PACKAGE or mode['repository'] != 'tscircuit/circuit-json-to-connectivity-map':
        raise ValueError('Unexpected dependency upgrade scope')
    if len(cfg['candidates']) != 1 or mode['base_version'] != '0.0.34' or mode['candidate_version'] != '0.0.35':
        raise ValueError('Only the frozen0.0.34to0.0.35 upgrade is authorized')
    if mode['base_range'] != '^0.0.34' or mode['candidate_range'] != '^0.0.35':
        raise ValueError('Unexpected root dependency ranges')
    if any('INVALID_' in name for name in mode['root_changed_files']):
        raise ValueError('Root source/test inventory is not frozen')
    if set(mode['published_packages']) != {'0.0.34', '0.0.35'}:
        raise ValueError('Published package inventory differs')
    for version, item in mode['published_packages'].items():
        if item['version'] != version or not re.fullmatch('[0-9a-f]{40}', item['gitHead']):
            raise ValueError('Invalid frozen published package source')
        expected_url = 'https://registry.npmjs.org/' + PACKAGE + '/-/' + PACKAGE + '-' + version + '.tgz'
        if item['tarball'] != expected_url or not item['integrity'].startswith('sha512-'):
            raise ValueError('Unexpected published package transport or integrity')
        if set(item['files']) != {'LICENSE', 'README.md', 'package.json', 'dist/index.js', 'dist/index.js.map', 'dist/index.d.ts'}:
            raise ValueError('Published package exceeds its frozen six-file inventory')


def validate_root_pair(cfg, target):
    mode = cfg['dependency_overlay']
    left = json.loads((SOURCES / 'base/package.json').read_text())
    right = json.loads((target / 'package.json').read_text())
    if left['devDependencies'][PACKAGE] != mode['base_range'] or right['devDependencies'][PACKAGE] != mode['candidate_range']:
        raise ValueError('Root manifests do not match the frozen dependency upgrade')
    for name, pin in mode['invariant_dependency_pins'].items():
        if left['devDependencies'].get(name) != pin or right['devDependencies'].get(name) != pin:
            raise ValueError('Frozen ordinary main dependency pin differs: ' + name)
    right['devDependencies'][PACKAGE] = left['devDependencies'][PACKAGE]
    if left != right:
        raise ValueError('Root package manifest changed beyond the one npm dependency range')
    changed = command(['git', 'diff', '--name-only', cfg['base_sha'], 'HEAD'], target).splitlines()
    if sorted(changed) != sorted(mode['root_changed_files']):
        raise ValueError('Root candidate changed-file inventory differs')


def package_files(path):
    return {str(item.relative_to(path)): {'bytes': item.stat().st_size, 'sha256': sha(item)} for item in sorted(path.rglob('*')) if item.is_file() and 'node_modules' not in item.relative_to(path).parts}


def prepare_upstreams(cfg):
    # This method name is retained by the stock controller interface. The
    # artifacts are unmodified registry packages, never edited dist bundles.
    UPSTREAM.mkdir(parents=True, exist_ok=True)
    provenance = {}
    for version, frozen in cfg['dependency_overlay']['published_packages'].items():
        with urllib.request.urlopen('https://registry.npmjs.org/' + PACKAGE + '/' + version, timeout=60) as response:
            registry = json.load(response)
        if registry['name'] != PACKAGE or registry['version'] != version or registry['gitHead'] != frozen['gitHead']:
            raise ValueError('Registry package identity or source commit differs')
        if registry['dist']['integrity'] != frozen['integrity'] or registry['dist']['tarball'] != frozen['tarball']:
            raise ValueError('Registry transport differs from frozen integrity')
        with urllib.request.urlopen(frozen['tarball'], timeout=60) as response:
            encoded = response.read()
        actual_integrity = 'sha512-' + base64.b64encode(hashlib.sha512(encoded).digest()).decode()
        if actual_integrity != frozen['integrity'] or len(encoded) != frozen['tarballBytes']:
            raise ValueError('Published tarball failed its frozen SHA512 or size check')
        target = UPSTREAM / version
        target.mkdir()
        names = set()
        with tarfile.open(fileobj=io.BytesIO(encoded), mode='r:gz') as archive:
            for member in archive.getmembers():
                name = pathlib.PurePosixPath(member.name)
                if not member.isfile() or not name.parts or name.parts[0] != 'package' or '..' in name.parts or name.is_absolute():
                    raise ValueError('Unsafe or nonregular published tarball entry')
                relative = str(pathlib.PurePosixPath(*name.parts[1:]))
                if relative not in frozen['files'] or relative in names:
                    raise ValueError('Unexpected or duplicate published tarball entry')
                expected = frozen['files'][relative]
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError('Missing published tarball bytes')
                data = source.read()
                if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['sha256']:
                    raise ValueError('Published file bytes differ from frozen inventory')
                path = target / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as output:
                    output.write(data)
                os.chmod(path, member.mode & 0o777)
                names.add(relative)
        if names != set(frozen['files']) or package_files(target) != frozen['files']:
            raise ValueError('Extracted official package inventory differs')
        provenance[version] = {'gitHead': frozen['gitHead'], 'integrity': actual_integrity, 'tarballSha256': hashlib.sha256(encoded).hexdigest(), 'tarballBytes': len(encoded), 'files': package_files(target)}
    left = json.loads((UPSTREAM / '0.0.34/package.json').read_text())
    right = json.loads((UPSTREAM / '0.0.35/package.json').read_text())
    for field in ['main', 'type', 'dependencies', 'peerDependencies']:
        if left.get(field) != right.get(field):
            raise ValueError('Published package changed a loader or dependency field: ' + field)
    save('published-package-provenance.json', provenance)


def runtime_graph(repo, name):
    path = OUT / name
    subprocess.run(['bun', '--tsconfig-override', str(repo / 'tsconfig.json'), str(HERE / 'runtime-graph.ts'), str(repo), str(path)], cwd=repo, check=True)
    value = json.loads(path.read_text())
    if value['unsupported']:
        raise ValueError('Runtime graph contains unaudited computed imports')
    return value


def disk_preflight(shared, copies):
    # Hardlinking cached lower-layer files can copy them upward on overlayfs.
    # Reserve the entire apparent install size before either private context,
    # plus conservative directory/file metadata and two GiB fixed headroom.
    files = list(walk_files(shared))
    apparent = sum(path.stat().st_size for path in files)
    metadata = copies * len(files) * 8192
    headroom = 2 * 1024 ** 3
    required = apparent + metadata + headroom
    available = shutil.disk_usage(ROOT).free
    value = {'fileCount': len(files), 'apparentBytes': apparent, 'privateCopies': copies, 'reservedMetadataBytes': metadata, 'fixedHeadroomBytes': headroom, 'requiredFreeBytes': required, 'availableFreeBytes': available, 'handlesLowerLayerCopyUpWorstCase': True}
    save('context-disk-preflight.json', value)
    if available < required:
        raise ValueError('Insufficient free disk for safe private loader contexts: ' + json.dumps(value))
    return value


def verify_cloned_files(cfg, copies):
    reports = {}
    candidate = cfg['selected_candidate']
    for arm, clone in copies.items():
        private = SOURCES / arm / 'node_modules'
        replacement = private / PACKAGE
        changed, unchanged = [], 0
        for row in clone['sharedFiles']:
            target, source = pathlib.Path(row['privatePath']), pathlib.Path(row['sharedPath'])
            if not source.is_file() or sha(source) != row['sha256']:
                raise ValueError('Shared installed file changed during context creation')
            is_changed = arm == candidate and target.is_relative_to(replacement) and 'node_modules' not in target.relative_to(replacement).parts
            if is_changed:
                name = str(target.relative_to(replacement))
                expected = cfg['dependency_overlay']['published_packages']['0.0.35']['files'][name]
                if sha(target) != expected['sha256']:
                    raise ValueError('Replacement differs from official published file')
                changed.append(name)
            else:
                left, right = source.stat(), target.stat()
                if (left.st_dev, left.st_ino, stat.S_IMODE(left.st_mode)) != (right.st_dev, right.st_ino, stat.S_IMODE(right.st_mode)):
                    raise ValueError('Unchanged private file does not share its baseline inode/mode')
                if sha(target) != row['sha256']:
                    raise ValueError('Unchanged private dependency bytes differ')
                unchanged += 1
        expected_changed = sorted(cfg['dependency_overlay']['published_packages']['0.0.35']['files']) if arm == candidate else []
        if sorted(changed) != expected_changed:
            raise ValueError('Dependency replacement changed an unexpected file inventory')
        reports[arm] = {'unchangedSharedInodeFiles': unchanged, 'officialReplacementFiles': sorted(changed), 'privateAliases': len(clone['privateAliases']), 'declaredRootBacklinks': clone['declaredRootNodeModulesBacklinks']}
    return reports


def audit_graphs(cfg, stock, graphs, copies, installed, shared):
    def stock_path(value):
        path = pathlib.Path(value)
        if path.is_relative_to(installed):
            return str(shared / path.relative_to(installed))
        if path.is_relative_to(SOURCES / 'base'):
            return '<ROOT>/' + str(path.relative_to(SOURCES / 'base'))
        return str(path)
    stock_files = {stock_path(path): digest for path, digest in stock['files'].items()}
    stock_edges = sorted((stock_path(row['importer']), row['specifier'], stock_path(row['resolved']), row['kind']) for row in stock['edges'])
    nested_math = [pathlib.Path(stock_path(row['resolved'])) for row in stock['edges'] if row['specifier'] == '@tscircuit/math-utils' and stock_path(row['importer']) == str(shared / PACKAGE / 'dist/index.js')]
    if len(nested_math) != 1:
        raise ValueError('Root connectivity package must have exactly one audited math-utils import')
    owner = nested_math[0].parent
    while not (owner / 'package.json').is_file() and owner.parent != owner:
        owner = owner.parent
    math_package = json.loads((owner / 'package.json').read_text())
    if math_package.get('name') != '@tscircuit/math-utils' or math_package.get('version') != '0.0.9':
        raise ValueError('The original nested math-utils0.0.9 context must be preserved')
    report = {}
    for arm, graph in graphs.items():
        lookup = {row['privatePath']: row['sharedPath'] for row in copies[arm]['sharedFiles']}
        def private_path(value):
            if value in lookup:
                return lookup[value]
            path = pathlib.Path(value)
            if path.is_relative_to(SOURCES / arm / 'node_modules'):
                raise ValueError('Runtime dependency file is not authenticated by context manifest: ' + value)
            if path.is_relative_to(SOURCES / arm):
                return '<ROOT>/' + str(path.relative_to(SOURCES / arm))
            raise ValueError('Runtime module escaped its arm-private context: ' + value)
        edges = sorted((private_path(row['importer']), row['specifier'], private_path(row['resolved']), row['kind']) for row in graph['edges'])
        if edges != stock_edges:
            raise ValueError('Runtime import resolutions differ from original stock install: ' + arm)
        normalized_files = {private_path(path): digest for path, digest in graph['files'].items()}
        if set(normalized_files) != set(stock_files):
            raise ValueError('Runtime module inventory changed')
        changed = []
        for name, digest in normalized_files.items():
            if digest == stock_files[name]:
                continue
            expected = str(shared / PACKAGE / 'dist/index.js')
            official = cfg['dependency_overlay']['published_packages']['0.0.35']['files']['dist/index.js']['sha256']
            if arm == 'base' or name != expected or digest != official:
                raise ValueError('Unexpected runtime module byte change: ' + name)
            changed.append(name)
        if arm != 'base' and changed != [str(shared / PACKAGE / 'dist/index.js')]:
            raise ValueError('Candidate graph did not load the actual official0.0.35 implementation')
        target_consumers = [row for row in graph['edges'] if row['specifier'] == PACKAGE and private_path(row['resolved']) == str(shared / PACKAGE / 'dist/index.js')]
        report[arm] = {'moduleCount': graph['moduleCount'], 'edgeCount': len(edges), 'computedImports': 0, 'normalizedGraphEqualsOriginalStock': True, 'changedRuntimeFiles': changed, 'preservedNestedMathUtils': {'name': math_package['name'], 'version': math_package['version'], 'sharedResolvedPath': str(nested_math[0])}, 'actualRootPackageConsumers': [{'importer': row['importer'], 'resolved': row['resolved']} for row in target_consumers]}
    save('runtime-resolution-audit.json', report)
    return report


def install_overlays(cfg, installed):
    frozen = cfg['dependency_overlay']['published_packages']
    if package_files(installed / PACKAGE) != frozen['0.0.34']['files']:
        raise ValueError('Installed baseline package is not the exact official0.0.34 publication')
    stock_graph = runtime_graph(SOURCES / 'base', 'runtime-graph-stock.json')
    dependency_root = ROOT / 'proof-dependencies'
    dependency_root.mkdir()
    shared = dependency_root / 'node_modules'
    installed.rename(shared)
    common_before = fingerprint(shared)
    disk = disk_preflight(shared, 2)
    copies = {}
    for arm in ['base', cfg['selected_candidate']]:
        target = SOURCES / arm / 'node_modules'
        copies[arm] = context.clone_context(shared, target, [shared])
        save('context-clone-' + arm + '.json', copies[arm])
    replacement = context.replace_published_package(SOURCES / cfg['selected_candidate'] / 'node_modules', UPSTREAM / '0.0.35', PACKAGE, '0.0.35')
    if fingerprint(shared) != common_before:
        raise ValueError('Context preparation modified the common baseline installation')
    file_parity = verify_cloned_files(cfg, copies)
    save('context-file-parity.json', file_parity)
    graphs = {arm: runtime_graph(SOURCES / arm, 'runtime-graph-' + arm + '.json') for arm in ['base', cfg['selected_candidate']]}
    resolutions = audit_graphs(cfg, stock_graph, graphs, copies, installed, shared)
    before = guard(cfg)
    save('dependency-overlay-guard-before.json', before)
    metadata = {'mode': cfg['dependency_overlay']['mode'], 'name': PACKAGE, 'shared': str(shared), 'versions': {arm: json.loads((SOURCES / arm / 'node_modules' / PACKAGE / 'package.json').read_text())['version'] for arm in ['base', cfg['selected_candidate']]}, 'rootOverlay': {arm: str(SOURCES / arm / 'node_modules') for arm in ['base', cfg['selected_candidate']]}, 'publishedPackageProvenance': 'published-package-provenance.json', 'diskPreflight': disk, 'privateContextParity': file_parity, 'runtimeResolutionAudit': resolutions, 'replacement': replacement, 'beforeGuard': guard_summary(before)}
    save('dependency-overlay.json', metadata)
    return shared, metadata


def context_guard(root):
    links, files = {}, {}
    for folder, dirs, names in os.walk(root, followlinks=False):
        for name in [*dirs, *names]:
            path = pathlib.Path(folder) / name
            relative = str(path.relative_to(root))
            if path.is_symlink():
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(root):
                    raise ValueError('Private context alias escaped its arm: ' + str(path))
                links[relative] = os.readlink(path)
            elif path.is_file():
                files[relative] = {'sha256': sha(path), 'mode': stat.S_IMODE(path.stat().st_mode)}
            elif not path.is_dir():
                raise ValueError('Unsupported entry in private context guard')
    return {'files': files, 'links': links, 'fileCount': len(files), 'linkCount': len(links), 'sha256': hashlib.sha256(json.dumps({'files': files, 'links': links}, sort_keys=True).encode()).hexdigest()}


def guard(cfg):
    return {'roots': {arm: tracked_guard(SOURCES / arm) for arm in ['base', cfg['selected_candidate']]}, 'published': {version: package_files(UPSTREAM / version) for version in ['0.0.34', '0.0.35']}, 'privateContexts': {arm: context_guard(SOURCES / arm / 'node_modules') for arm in ['base', cfg['selected_candidate']]}, 'sharedFiles': fingerprint(ROOT / 'proof-dependencies/node_modules')}


def guard_summary(value):
    return {'guardSha256': hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest(), 'roots': {arm: {'sha': item['sha'], 'tree': item['tree'], 'regularFileCount': len(item['files']), 'gitlinks': item['gitlinks'], 'symlinkCount': len(item['symlinks'])} for arm, item in value['roots'].items()}, 'publishedPackageFileCounts': {version: len(files) for version, files in value['published'].items()}, 'privateContexts': {arm: {name: item[name] for name in ['fileCount', 'linkCount', 'sha256']} for arm, item in value['privateContexts'].items()}, 'sharedPhysicalFileCount': value['sharedFiles']['fileCount'], 'sharedPhysicalFilesSha256': value['sharedFiles']['sha256']}


