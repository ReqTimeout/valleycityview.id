#!/usr/bin/env python3
"""Fase 10b — seo/site.mjs: pembaca string tersambung (description) + buang
'45/72' yang ditulis manual padahal PRICING sudah punya buildingArea/landArea."""
import sys
from pathlib import Path

P = str(Path(__file__).resolve().parents[1]) + '/seo/site.mjs'
src = open(P, encoding='utf-8').read()

EDITS = [
    (
        "/** Ambil nilai numerik/string dari objek `site` di site.ts. */",
        """/** Ambil nilai numerik/string satu baris dari objek `site` di site.ts. */""",
    ),
    (
        "export const BRAND = pick(['name']);",
        """/**
 * String yang ditulis tersambung dengan '+' di site.ts (description) tidak bisa
 * diambil dengan pick() — regex-nya berhenti di kutip pertama dan kami mengirim
 * kalimat terpotong ke AI crawler. Jadi baca baris demi baris selama masih '+'
 * dan gabung seluruh literalnya.
 */
function pickStr(key) {
  const lines = src.split(String.fromCharCode(10));
  const start = lines.findIndex((l) => new RegExp(`\\\\b${key}\\\\s*:`).test(l));
  if (start < 0) throw new Error(`site.mjs: "${key}" tidak ditemukan di ${SITE_DATA_PATH}`);
  let expr = lines[start].replace(new RegExp(`^\\\\s*${key}\\\\s*:`), '').trim();
  let i = start + 1;
  while (expr.endsWith('+') && i < lines.length) {
    expr = expr.slice(0, -1).trim() + ' ' + lines[i].trim();
    i += 1;
  }
  const parts = [...expr.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => (m[1] === undefined ? m[2] : m[1]));
  if (!parts.length) throw new Error(`site.mjs: "${key}" bukan string literal`);
  return parts.join('').trim();
}

export const BRAND = pick(['name']);
export const DESCRIPTION = pickStr('description');""",
    ),
    (
        "      platform: `Tipe 45/72 — ${ADDRESS.street}, ${ADDRESS.city}`,",
        "      platform: `Tipe ${PRICING.buildingArea}/${PRICING.landArea} — ${ADDRESS.street}, ${ADDRESS.city}`,",
    ),
]

for old, new in EDITS:
    if src.count(old) != 1:
        print(f'GAGAL: penanda cocok {src.count(old)}x: {old[:70]!r}')
        sys.exit(1)
    src = src.replace(old, new, 1)

open(P, 'w', encoding='utf-8').write(src)
print('ok: 3 edit site.mjs')
