#!/usr/bin/env python3
"""Trusted, offline archive inspection. Never imports or executes payload code."""
import argparse, hashlib, io, json, os, pathlib, platform, re, shutil, tarfile

def require(condition, message):
    if not condition:
        raise ValueError(message)

ALLOWED = {'dist','dist-server','node_modules','package.json','release.json','dependencies.json','integrity.json','.managed-by'}
DENIED = re.compile(r'(^|/)(\.git|\.github|\.codex|\.claude|\.npmrc|\.pypirc|\.env(?:\..*)?|credentials[^/]*|secrets[^/]*|qa[^/]*\.html|qa-panel[^/]*|[^/]+\.(pem|key|p12|pfx|sql|dump))$', re.I)

def metadata(root, local=False):
    release = json.loads((root/'release.json').read_text())
    require(release.get('format') == 1 and re.fullmatch('[0-9a-f]{40}', release.get('commit','')), 'Invalid release identity')
    require(isinstance(release.get('dirty'), bool), 'Missing clean-build flag')
    require(local or (release['dirty'] is False and release.get('platform') == 'linux'), 'Production requires a clean Linux build')
    machine = {'x86_64':'x64','aarch64':'arm64','arm64':'arm64'}.get(platform.machine())
    require(local or release.get('arch') == machine, 'Wrong architecture')
    require(json.loads((root/'dist/release.json').read_text()) == release, 'Client identity mismatch')
    require(json.loads((root/'dist-server/release.json').read_text()) == release, 'Server identity mismatch')
    require((root/'.managed-by').read_text().strip() == 'roma-operation-67-v1', 'Unknown artifact')
    require((root/'dist/index.html').is_file() and (root/'dist-server/index.js').is_file(), 'Incomplete artifact')
    inventory = json.loads((root/'integrity.json').read_text())
    require(inventory.get('format') == 1 and inventory.get('commit') == release['commit'], 'Invalid integrity manifest')
    actual = {}
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in dirs[:] + files:
            p = pathlib.Path(base)/name
            rel = p.relative_to(root).as_posix()
            require(rel.split('/')[0] in ALLOWED and not DENIED.search(rel), 'Prohibited artifact entry')
            if p.is_symlink():
                target = os.readlink(p)
                require(not os.path.isabs(target) and p.resolve().is_relative_to(root.resolve()) and p.exists(), 'Unsafe link')
                actual[rel] = {'link':target}
                if name in dirs: dirs.remove(name)
            elif p.is_file() and rel != 'integrity.json':
                actual[rel] = {'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            else:
                require(p.is_dir() or rel == 'integrity.json', 'Unsupported file')
    require(actual == inventory['files'], 'Artifact integrity mismatch')
    return release

def extract(archive, checksum, destination, local=False):
    require(re.fullmatch('[0-9a-f]{64}',checksum), 'Expected SHA-256 is required')
    # Snapshot a bounded byte sequence: hashing and extraction must use the same bytes,
    # even if an uploader still holds a writable descriptor to the source archive.
    with open(archive,'rb') as f:
        payload=f.read(128*1024*1024+1)
    require(len(payload)<=128*1024*1024, 'Compressed archive too large')
    require(hashlib.sha256(payload).hexdigest() == checksum, 'Archive checksum mismatch')
    with io.BytesIO(payload) as verified:
        with tarfile.open(fileobj=verified, mode='r:gz') as tar:
            entries=[]; names=set(); links=set(); total=0
            for item in tar:
                name=item.name
                while name.startswith('./'): name=name[2:]
                if name in ('','.'): continue
                path=pathlib.PurePosixPath(name)
                require(not path.is_absolute() and '..' not in path.parts and '\\' not in name and '\x00' not in name, 'Unsafe archive path')
                normalized=path.as_posix()
                require(normalized not in names and len(names)<50000, 'Duplicate or excessive entries')
                require(path.parts[0] in ALLOWED and not DENIED.search(normalized), 'Prohibited archive entry')
                require(item.isfile() or item.isdir() or item.issym(), 'Unsupported archive entry')
                require(not (item.mode & 0o7000), 'Unsafe file mode')
                total+=item.size
                require(total<=512*1024*1024 and item.size<=128*1024*1024, 'Archive too large')
                if item.issym():
                    target=item.linkname
                    resolved=os.path.normpath(os.path.join(os.path.dirname(normalized),target))
                    require(not os.path.isabs(target) and '\\' not in target and resolved!='..' and not resolved.startswith('../'), 'Unsafe archive link')
                    links.add(normalized)
                names.add(normalized);entries.append((item,normalized))
            for item,name in entries:
                require(not any(p.as_posix() in links for p in pathlib.PurePosixPath(name).parents), 'Archive writes through symlink')
            root=pathlib.Path(destination).resolve()
            require(root.is_dir() and not any(root.iterdir()), 'Destination must be empty')
            # All names, links and sizes validated before the first payload write.
            for item,name in entries:
                p=root/name
                p.parent.mkdir(parents=True,exist_ok=True)
                if item.isdir(): p.mkdir(exist_ok=True)
                elif item.issym(): os.symlink(item.linkname,p)
                else:
                    with tar.extractfile(item) as src, p.open('xb') as out: shutil.copyfileobj(src,out)
                    p.chmod(0o755 if item.mode&0o111 else 0o644)
    return metadata(root,local)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['extract','verify'])
    parser.add_argument('source'); parser.add_argument('checksum',nargs='?'); parser.add_argument('destination',nargs='?')
    parser.add_argument('--allow-local',action='store_true',help='Local testing only; never used by release.sh')
    args=parser.parse_args()
    try:
        r=extract(args.source,args.checksum,args.destination,args.allow_local) if args.mode=='extract' else metadata(pathlib.Path(args.source),args.allow_local)
        print(r['commit'])
    except Exception as e:
        raise SystemExit('Artifact rejected: '+str(e))
