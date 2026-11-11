#!/usr/bin/env python3
"""Perbaiki regex literal yang dipecah tool edit: setiap '\\n' (backslash + n)
di dalam berkas sumber diganti menjadi baris nyata. Script ini membandingkan
terhadap berkas aslinya dan menyusun kembali baris yang cocok."""
import sys

ORIG, CUR = sys.argv[1], sys.argv[2]
BS = chr(92)
NL = chr(10)

orig = open(ORIG, encoding='utf-8').read().split(NL)
cur = open(CUR, encoding='utf-8').read()

fixed = 0
for line in orig:
    if BS + 'n' not in line:
        continue
    broken = line.replace(BS + 'n', NL)
    if broken in cur and line not in cur:
        cur = cur.replace(broken, line, 1)
        fixed += 1

open(CUR, 'w', encoding='utf-8').write(cur)
print(f"restored {fixed} baris regex multi-baris")
