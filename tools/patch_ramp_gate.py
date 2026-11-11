#!/usr/bin/env python3
"""Fase 10b — ramp-gate: bedakan "belum diukur" dari "Google tidak menemukan".

Lama: discoveryGapRatio = (not_discovered + unknown) / total. unknown berarti
"tidak ada hasil inspeksi GSC untuk URL ini" (lib/gsc belum pernah dipanggil),
jadi di checkout pertama gate selalu bilang "Google belum menemukan 0/54 URL" —
pesan yang menyalahkan situs atas sesuatu yang belum kami ukur, dan menutup
jalur ke cabang `sample tipis` yang justru benar.
"""
import sys
from pathlib import Path

P = str(Path(__file__).resolve().parents[1]) + '/seo/ramp-gate.mjs'
src = open(P, encoding='utf-8').read()

EDITS = [
    (
        "  // `discovered` = Google punya data tentang URL (bukan \"unknown to Google\").\n"
        "  // Ini penyebut index_rate. Exclude not_discovered + unknown.\n"
        "  const discovered = buckets.indexed + buckets.not_indexed + buckets.blocked;\n"
        "  const indexRate = discovered > 0 ? buckets.indexed / discovered : null;\n"
        "  const discoveryGapRatio = total > 0 ? (buckets.not_discovered + buckets.unknown) / total : null;",
        "  // `discovered` = Google punya data tentang URL (bukan \"unknown to Google\").\n"
        "  // Ini penyebut index_rate. Exclude not_discovered + unknown.\n"
        "  const discovered = buckets.indexed + buckets.not_indexed + buckets.blocked;\n"
        "  const indexRate = discovered > 0 ? buckets.indexed / discovered : null;\n"
        "  // `unknown` = KAMI yang belum mengukur (tidak ada hasil inspeksi untuk URL ini),\n"
        "  // bukan Google yang gagal menemukan. Memasukkannya ke gap membuat checkout baru\n"
        "  // selalu berbunyi \"Google belum menemukan 0/54 URL\" dan menutup cabang `sample\n"
        "  // tipis` yang justru benar. Gap hanya dihitung atas URL yang punya pengukuran.\n"
        "  const measured = total - buckets.unknown;\n"
        "  const discoveryGapRatio = measured > 0 ? buckets.not_discovered / measured : null;",
    ),
    (
        "  const { total, discovered, indexRate, discoveryGapRatio, buckets } = metrics;\n",
        "  const { total, discovered, indexRate, discoveryGapRatio, buckets } = metrics;\n"
        "\n"
        "  // Kekurangan pengukuran itu sendiri harus terlihat, sebagai fakta — bukan\n"
        "  // sebagai diagnosis. Naikkan volume tanpa data tetap tidak boleh, jadi cabang\n"
        "  // `sample tipis` di bawah yang menahan ramp.\n"
        "  if (total > 0 && buckets.unknown > 0) {\n"
        "    alerts.push({\n"
        "      level: 'info',\n"
        "      code: 'no_measurement',\n"
        "      msg: `${buckets.unknown}/${total} URL belum punya hasil inspeksi GSC — jalankan \\`node seo/gsc-inspect.mjs\\`. Ini pengukuran yang belum ada, bukan bukti Google gagal menemukan.`,\n"
        "    });\n"
        "  }\n",
    ),
]

for old, new in EDITS:
    if src.count(old) != 1:
        print(f'GAGAL: penanda cocok {src.count(old)}x: {old[:70]!r}')
        sys.exit(1)
    src = src.replace(old, new, 1)

open(P, 'w', encoding='utf-8').write(src)
print('ok: discovery gap hanya atas URL terukur + alert no_measurement')
