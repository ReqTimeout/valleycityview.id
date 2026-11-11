/**
 * site/src/lib/jsonld.ts — skema dasar yang sama untuk semua halaman.
 *
 * Kenapa di satu tempat: sampai file ini ada, hanya homepage yang mengirim
 * JSON-LD. Enam halaman lain (termasuk /nup/, /sale/, /agent/ yang justru
 * halaman komersial) tampil tanpa struktur sama sekali, dan cara paling murah
 * untuk "lupa" adalah membiarkan tiap halaman merangkai skema sendiri.
 *
 * Aturan namanya sama dengan aturan di seluruh repo: tidak ada angka atau
 * klaim yang dikarang di sini. WebPage/BreadcrumbList hanya menjelaskan
 * halaman mana yang sedang dibuka — semuanya berasal dari props yang sudah
 * ada (title, description, path) dan dari tabel label navigasi.
 */
import { site } from '../data/site';

/** Label remah per segmen path. Kalau segmen tidak ada di tabel, remah itu dilewati. */
const CRUMB_LABELS: Record<string, string> = {
  blog: 'Artikel',
  'simulasi-kpr': 'Simulasi KPR',
  nup: 'Nomor Urut Pemesanan',
  sale: 'Penawaran Unit',
  agent: 'Program Agen',
  terms: 'Syarat & Ketentuan',
  privacy: 'Kebijakan Privasi',
};

export interface Crumb {
  name: string;
  item: string;
}

/**
 * Jalur remah untuk satu path. Segmen tengah harus ada di CRUMB_LABELS —
 * kalau tidak, kami tidak menebak namanya (remah palsu terlihat normal di
 * SERP dan justru itu yang bikin hasil pencarian menyesatkan).
 */
export function breadcrumbsFor(path: string, leafName: string): Crumb[] {
  const clean = (path || '/').replace(/^\/+|\/+$/g, '');
  const segments = clean ? clean.split('/') : [];
  const crumbs: Crumb[] = [{ name: 'Beranda', item: `${site.origin}/` }];
  let href = '';
  for (let i = 0; i < segments.length - 1; i += 1) {
    href += `/${segments[i]}`;
    const label = CRUMB_LABELS[segments[i]];
    if (label) crumbs.push({ name: label, item: `${site.origin}${href}/` });
  }
  crumbs.push({ name: leafName, item: new URL(path, site.origin).href });
  return crumbs;
}

/** WebPage = halaman ini; bukan tempat menaruh klaim pemasaran. */
export function webPageSchema(opts: {
  title: string;
  description: string;
  path: string;
}): Record<string, unknown> {
  const { title, description, path } = opts;
  const url = new URL(path, site.origin).href;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': url,
    name: title.includes(site.name) ? title : `${title} | ${site.name}`,
    description,
    url,
    inLanguage: site.locale,
    isPartOf: { '@type': 'WebSite', name: site.name, url: `${site.origin}/` },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbsFor(path, title).map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: c.item,
      })),
    },
  };
}
