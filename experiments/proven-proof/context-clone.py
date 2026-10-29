"""Private loader paths, unchanged package bytes and inodes; no package install.

Directory aliases are remapped within the private context so module identity is
preserved. Runtime file symlinks are rejected unless their target is already
materialized; arbitrary external paths, broken links and ancestor cycles fail.
"""
import hashlib
import json
import os
import pathlib
import stat

EXCLUDED = {'.git', '.vite', '.cache', '.bin'}
PACKAGE = 'circuit-json-to-connectivity-map'


def inside(path, roots):
    return any(path == root or path.is_relative_to(root) for root in roots)


def clone_context(source, destination, allowed_roots):
    source = source.absolute()
    destination = destination.absolute()
    allowed = [pathlib.Path(root).resolve(strict=True) for root in allowed_roots]
    if destination.exists() or destination.is_symlink():
        raise ValueError('Private context destination already exists: ' + str(destination))
    directories, files, links, exclusions, backlinks, shared_files = {}, {}, {}, [], [], []
    root_actual = source.resolve(strict=True)

    def visit(current, target, ancestors):
        try:
            actual = current.resolve(strict=True)
        except (FileNotFoundError, RuntimeError) as error:
            raise ValueError('Broken or cyclic dependency link: ' + str(current)) from error
        if not inside(actual, allowed):
            raise ValueError('Dependency path escapes the explicit installation roots: ' + str(current))
        metadata = actual.stat()
        identity = (metadata.st_dev, metadata.st_ino)
        if stat.S_ISDIR(metadata.st_mode):
            if identity in ancestors:
                if current.is_symlink() and current.name == 'node_modules' and actual == root_actual:
                    relative = os.path.relpath(destination, target.parent)
                    target.symlink_to(relative, target_is_directory=True)
                    links[str(target.relative_to(destination))] = relative
                    backlinks.append({'sourceLink': str(current), 'privateLink': str(target.relative_to(destination)), 'declaredSourceRoot': str(root_actual), 'privateTarget': relative})
                    return
                raise ValueError('Ancestor directory cycle in dependency context: ' + str(current))
            if identity in directories:
                relative = os.path.relpath(directories[identity], target.parent)
                target.symlink_to(relative, target_is_directory=True)
                links[str(target.relative_to(destination))] = relative
                return
            target.mkdir()
            directories[identity] = target
            children = sorted(actual.iterdir(), key=lambda child: (child.name != PACKAGE, child.name))
            for child in children:
                if child.name in EXCLUDED:
                    exclusions.append(str(child))
                    continue
                visit(child, target / child.name, ancestors | {identity})
            return
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError('Dependency entry is not a regular file or directory: ' + str(current))
        # A file symlink denotes module identity, unlike an ordinary hardlink.
        # Preserve that identity with a private symlink to its prior target.
        if current.is_symlink():
            if actual not in files:
                raise ValueError('Runtime file symlink target is not already materialized: ' + str(current))
            relative = os.path.relpath(files[actual], target.parent)
            target.symlink_to(relative)
            links[str(target.relative_to(destination))] = relative
            return
        os.link(actual, target)
        # Overlay filesystems may copy a lower-layer inode upward on link().
        # Compare the two live paths after that operation, never a stale inode.
        original = actual.stat()
        files[actual] = target
        copied = target.stat()
        if (copied.st_dev, copied.st_ino, stat.S_IMODE(copied.st_mode)) != (original.st_dev, original.st_ino, stat.S_IMODE(metadata.st_mode)):
            raise ValueError('Unchanged dependency file lost its shared inode or mode: ' + str(current))
        shared_files.append({'privatePath': str(target), 'sharedPath': str(actual), 'sha256': hashlib.sha256(actual.read_bytes()).hexdigest(), 'mode': stat.S_IMODE(metadata.st_mode)})

    visit(source, destination, set())
    return {'directoryCount': len(directories), 'fileCount': len(files), 'privateAliases': links, 'sharedFiles': shared_files, 'declaredRootNodeModulesBacklinks': backlinks, 'excludedNonRuntimeDirectories': exclusions, 'allowedRoots': [str(path) for path in allowed]}


def replace_published_package(destination, official, name, version):
    package = destination / name
    official = official.resolve(strict=True)
    if package.is_symlink() or not package.is_dir():
        raise ValueError('Root replacement package must have its own materialized context')
    expected = json.loads((official / 'package.json').read_text())
    if expected.get('name') != name or expected.get('version') != version:
        raise ValueError('Official package identity differs from the frozen replacement')
    if (official / 'node_modules').exists():
        raise ValueError('Official published files unexpectedly contain node_modules')
    original_nested = package / 'node_modules'
    nested_identity = (original_nested.stat().st_dev, original_nested.stat().st_ino) if original_nested.exists() else None
    # Unlink before writing: these paths are hardlinked to the shared install.
    # Opening them for replacement would silently overwrite the baseline.
    import shutil
    for entry in list(package.iterdir()):
        if entry.name == 'node_modules':
            continue
        if entry.is_symlink() or entry.is_file():
            entry.unlink()
        elif entry.is_dir():
            shutil.rmtree(entry)
        else:
            raise ValueError('Unsupported package replacement entry: ' + str(entry))
    for folder, dirs, names in os.walk(official):
        relative = pathlib.Path(folder).relative_to(official)
        target = package / relative
        for child in dirs:
            if (pathlib.Path(folder) / child).is_symlink():
                raise ValueError('Official published package contains a directory symlink')
            (target / child).mkdir()
        for child in names:
            src, dst = pathlib.Path(folder) / child, target / child
            if src.is_symlink() or not src.is_file():
                raise ValueError('Official published package contains a nonregular file')
            with dst.open('xb') as output:
                output.write(src.read_bytes())
            os.chmod(dst, stat.S_IMODE(src.stat().st_mode))
    if nested_identity != ((original_nested.stat().st_dev, original_nested.stat().st_ino) if original_nested.exists() else None):
        raise ValueError('Replacement changed the existing nested dependency context')
    return {'name': name, 'version': version, 'nestedContextPreserved': True, 'officialFiles': {str(path.relative_to(official)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(official.rglob('*')) if path.is_file()}}
