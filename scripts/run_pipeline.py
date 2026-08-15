#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import shutil
import subprocess
import sys
from pathlib import Path

def run(cmd):
    print(f"\n==> {' '.join(cmd)}")
    r = subprocess.run(cmd, check=False)
    if r.returncode != 0:
        raise SystemExit(r.returncode)

def sync_performers_file():
    src = Path("performers.txt")
    dst = Path("docs/performers.txt")

    if not src.exists():
        raise SystemExit(f"Missing required file: {src}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"==> synced {src} -> {dst}")

def main():
    # Run in repo root
    sync_performers_file()
    run([sys.executable, "scripts/fetch.py"])
    run([sys.executable, "scripts/rate.py"])
    run([sys.executable, "scripts/build_photo_index.py"])
    run([sys.executable, "scripts/export_json.py"])
    run([sys.executable, "scripts/fetch_concerts.py"])
    print("\n✅ Pipeline finished")

if __name__ == "__main__":
    main()
