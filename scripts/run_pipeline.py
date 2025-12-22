#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import subprocess
import sys

def run(cmd):
    print(f"\n==> {' '.join(cmd)}")
    r = subprocess.run(cmd, check=False)
    if r.returncode != 0:
        raise SystemExit(r.returncode)

def main():
    # Run in repo root
    run([sys.executable, "scripts/fetch.py"])
    run([sys.executable, "scripts/rate.py"])
    run([sys.executable, "scripts/export_json.py"])
    print("\n✅ Pipeline finished")

if __name__ == "__main__":
    main()
