#!/usr/bin/env python3
"""Fase 10b — llms.mjs jangan advertise post yang di-redirect 301.

Audit Fase 10 meninggalkan 17 post dengan `redirectTo:` di frontmatter. Routenya
masih ada (menerima 301), tapi isinya tidak tayang. Mendaftarkannya di llms.txt
= mengirim crawler ke URL yang menjawab "pindah ke sana", dan angka "71 artikel"
di llms.txt tidak akan pernah cocok dengan sitemap (67 URL).
"""
import sys
from pathlib import Path

P = str(Path(__file__).resolve().parents[1]) + '/seo/llms.mjs'
src = open(P, encoding='utf-8').read()

old = "    if (!parsed || parsed.fm.status === 'draft') continue; // draft tidak dirender"
new = """    if (!parsed || parsed.fm.status === 'draft') continue; // draft tidak dirender
    // redirectTo = post 301 hasil audit Fase 10. Routenya ada, kontennya tidak;
    // memasukkannya ke llms.txt berarti mengirim AI ke halaman yang jawabannya
    // "pindah ke URL lain", dan jumlah artikel tidak akan cocok dengan sitemap.
    if (parsed.fm.redirectTo) continue;"""
if src.count(old) != 1:
    print(f'GAGAL: penanda {src.count(old)}x')
    sys.exit(1)
src = src.replace(old, new, 1)

old2 = """function readSitemapUrls() {
  const sitemap = SITEMAP_PATH;
  if (!existsSync(sitemap)) return [];"""
new2 = """function readSitemapUrls() {
  const sitemap = SITEMAP_PATH;
  // Best-effort: pada checkout bersih belum ada dist/. Bagian llms.txt yang
  // memakai daftar URL tetap benar karena money page datang dari registry.
  if (!existsSync(sitemap)) return [];"""
if src.count(old2) != 1:
    print(f'GAGAL: penanda readSitemapUrls {src.count(old2)}x')
    sys.exit(1)
src = src.replace(old2, new2, 1)

open(P, 'w', encoding='utf-8').write(src)
print('ok: llms.mjs skip post redirect + catatan sitemap best-effort')
