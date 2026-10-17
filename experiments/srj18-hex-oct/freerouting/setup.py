#!/usr/bin/env python3
"""Download verified, isolated Linux x64 runtimes for the optional baseline."""
import argparse,hashlib,subprocess,tarfile
from pathlib import Path

FILES={
    'freerouting-2.5.0.jar':(
        'https://github.com/freerouting/freerouting/releases/download/v2.5.0/freerouting-2.5.0.jar',
        'f6f51bb02245e8e717f9359bd260cc9c5c0b1bc0acc8b7cb2cd5b8ffeb5de3c7'),
    'jre.tar.gz':(
        'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jre_x64_linux_hotspot_25.0.4.1_1.tar.gz',
        '1731a34baadec5479258ea0202e4d5d865d2efeee60cb0c7d7eb056fe96ca219')}

def setup(directory):
    directory.mkdir(parents=True,exist_ok=True)
    for name,(url,checksum) in FILES.items():
        path=directory/name
        if not path.exists():subprocess.run(['curl','--fail','--location','--max-time','180',url,'--output',str(path)],check=True)
        actual=hashlib.sha256(path.read_bytes()).hexdigest()
        if actual!=checksum:raise ValueError(f'Checksum mismatch for {name}: {actual}')
    with tarfile.open(directory/'jre.tar.gz') as archive:archive.extractall(directory,filter='data')
    print(directory/'jdk-25.0.4.1+1-jre/bin/java')
    print(directory/'freerouting-2.5.0.jar')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--runtime',type=Path,default=Path('work/freerouting-runtime'));setup(parser.parse_args().runtime)
