#!/usr/bin/env python3
"""Buat script patch port-10b portable: root repo dari __file__, bukan path laptop.

Sekali jalan per berkas; kalau baris targetnya sudah berubah ia berhenti dengan
exit 1 (bukan menulis ulang sembarangan), jadi aman dijalankan dua kali.
"""
from pathlib import Path

BASE = '/Volumes/miniex/Users/maabook/web-project/valleycityview.id'
ROOT_EXPR = "str(Path(__file__).resolve().parents[1])"
repo = Path(__file__).resolve().parents[1]
IMPORT = "from pathlib import Path"

# rel -> (prefix berkas yang dipatch, path relatif dari root repo). Berkas
# port_* memakai ROOT sebagai prefix f-string, jadi nilainya str(root).
TARGETS = [
    ('tools/patch_llms.py', 'seo/llms.mjs'),
    ('tools/patch_llms2.py', 'seo/llms.mjs'),
    ('tools/patch_llms3.py', 'seo/llms.mjs'),
    ('tools/patch_ramp_gate.py', 'seo/ramp-gate.mjs'),
    ('tools/patch_site_mjs.py', 'seo/site.mjs'),
    ('tools/port_jsonld_baseline.py', 'seo/jsonld-validate.mjs'),
    ('tools/port_jsonld_validate.py', 'seo/jsonld-validate.mjs'),
    ('tools/port_keyword_suggest.py', 'seo/keyword-suggest.mjs'),
    ('tools/port_live_predicate.py', None),
    ('tools/port_sweep_10b.py', None),
]

for rel, sub in TARGETS:
    path = repo / rel
    src = path.read_text(encoding='utf-8')
    if 'Path(__file__).resolve().parents[1]' in src:
        print(f'skip  {rel} (sudah portable)')
        continue
    old = f"ROOT = '{BASE}'" if sub is None else f"P = '{BASE}/{sub}'"
    if src.count(old) != 1:
        raise SystemExit(f'FATAL: target "{old}" ditemukan {src.count(old)}x di {rel}')
    new = f'ROOT = {ROOT_EXPR}' if sub is None else f"P = {ROOT_EXPR} + '/{sub}'"
    src = src.replace(old, new, 1)
    if IMPORT not in src:
        if 'import sys' not in src:
            raise SystemExit(f'FATAL: tidak ada "import sys" untuk menyisipkan import di {rel}')
        src = src.replace('import sys', f'import sys\n{IMPORT}', 1)
    path.write_text(src, encoding='utf-8')
    print(f'ok    {rel}')
