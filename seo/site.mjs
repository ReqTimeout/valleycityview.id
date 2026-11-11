/**
 * seo/site.mjs — identitas situs untuk mesin SEO, dibaca dari satu sumber.
 *
 * Angka-angka kunci (harga KPR, cicilan, booking fee, luas) diambil langsung
 * dari site/src/data/site.ts — tidak disalin ke konstanta kedua. Alasannya sama
 * dengan aturan di plan: tidak boleh ada dua dokumen yang saling menyangkal.
 * WordPress lama punya tiga nomor WhatsApp berbeda yang hidup serentak;
 * mesin yang menyimpan angkanya sendiri mengulang kegagalan yang sama.
 *
 * Yang tidak ada di site.ts (nama project Pages, domain GSC) lewat env
 * dengan default eksplisit, supaya runner container bisa override.
 */
import { readFileSync } from 'node:fs';
import { SITE_DATA_PATH } from './paths.mjs';

const src = readFileSync(SITE_DATA_PATH, 'utf8');

/** Ambil nilai numerik/string satu baris dari objek `site` di site.ts. */
function pick(path) {
  const key = path[path.length - 1];
  const re = new RegExp(`\\b${key}\\s*:\\s*("[^"]*"|'[^']*'|[\\d_][\\d_']*)`);
  const m = src.match(re);
  if (!m) throw new Error(`site.mjs: "${key}" tidak ditemukan di ${SITE_DATA_PATH}`);
  const raw = m[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) return raw.slice(1, -1);
  return Number(raw.replace(/_/g, ''));
}

/**
 * String yang ditulis tersambung dengan '+' di site.ts (description) tidak bisa
 * diambil dengan pick() — regex-nya berhenti di kutip pertama dan kami mengirim
 * kalimat terpotong ke AI crawler. Jadi baca baris demi baris selama masih '+'
 * dan gabung seluruh literalnya.
 */
function pickStr(key) {
  const lines = src.split(String.fromCharCode(10));
  const start = lines.findIndex((l) => new RegExp(`\\b${key}\\s*:`).test(l));
  if (start < 0) throw new Error(`site.mjs: "${key}" tidak ditemukan di ${SITE_DATA_PATH}`);
  let expr = lines[start].replace(new RegExp(`^\\s*${key}\\s*:`), '').trim();
  let i = start + 1;
  // `description:` di site.ts berdiri sendiri, nilainya di baris berikutnya.
  if (!expr && i < lines.length) {
    expr = lines[i].trim();
    i += 1;
  }
  while (expr.endsWith('+') && i < lines.length) {
    expr = expr.slice(0, -1).trim() + ' ' + lines[i].trim();
    i += 1;
  }
  const parts = [...expr.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => (m[1] === undefined ? m[2] : m[1]));
  if (!parts.length) throw new Error(`site.mjs: "${key}" bukan string literal`);
  return parts.join('').trim();
}

export const BRAND = pick(['name']);
export const DESCRIPTION = pickStr('description');
export const SITE = pick(['origin']);
export const TAGLINE = pick(['tagline']);
export const WHATSAPP = pick(['whatsapp']);
export const WHATSAPP_DISPLAY = pick(['whatsappDisplay']);
export const EMAIL = pick(['email']);
export const ADDRESS = {
  street: pick(['street']),
  city: pick(['city']),
  region: pick(['region']),
  postalCode: pick(['postalCode']),
  country: pick(['country']),
  countryName: pick(['countryName']),
};

export const PRICING = {
  kprPrice: pick(['kprPrice']),
  monthly: pick(['monthly']),
  bookingFee: pick(['bookingFee']),
  tenureYears: pick(['tenureYears']),
  buildingArea: pick(['buildingArea']),
  landArea: pick(['landArea']),
};

const rupiah = (n) => 'Rp ' + n.toLocaleString('id-ID');

/**
 * Blok harga yang disuntikkan generator ke artikel — pengganti prices.json
 * valleycity.id. Satu produk, jadi "top" berisi varian skema, bukan katalog.
 * generate.mjs mengharapkan bentuk { top: [{ platform, ... }] }.
 */
export const PRICES = {
  updated: new Date().toISOString().slice(0, 10),
  top: [
    {
      platform: `Tipe ${PRICING.buildingArea}/${PRICING.landArea} — ${ADDRESS.street}, ${ADDRESS.city}`,
      price: rupiah(PRICING.kprPrice),
      installment: `${rupiah(PRICING.monthly)}/bulan`,
      note: `Booking fee ${rupiah(PRICING.bookingFee)}, tenor hingga ${PRICING.tenureYears} tahun`,
    },
  ],
};

/** Link CTA kanonik — mesin tidak pernah mengarang URL kontak. */
export const WA_LINK = (message) =>
  `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`;

/**
 * Halaman komersial situs — satu registry untuk seluruh mesin.
 *
 * generate.mjs memakainya untuk memilih link dalam artikel, llms.mjs untuk
 * bagian "Money pages" di llms.txt. Kalau daftarnya disimpan dua kali, suatu
 * saat kedua salinan pasti berbeda dan kami tidak tahu yang mana yang benar.
 *
 * `match` = potongan keyword yang membuat halaman ini relevan; `url` relatif
 * terhadap SITE (yang ber-`#` adalah section di homepage, bukan halaman baru).
 */
export const MONEY_PAGES = [
  { url: '/simulasi-kpr/', anchor: 'simulator cicilan KPR', match: ['kpr', 'cicil', 'angsur', 'bunga', 'dp', 'tenor', 'credit', 'financ'] },
  { url: '/#unit', anchor: 'denah dan tipe unit 45/72', match: ['denah', 'tipe', 'lu', 'kamar', 'desain', 'spesifikasi', 'unit'] },
  { url: '/#lokasi', anchor: 'peta lokasi Padalarang', match: ['lokasi', 'akses', 'jarak', 'tol', 'kcic', 'padalarang', 'cimahi', 'bandung'] },
  { url: '/agent/', anchor: 'program agen properti', match: ['agen', 'makelar', 'komisi', 'mitra'] },
  { url: '/nup/', anchor: 'nomor urut pemesanan', match: ['nup', 'pemesanan', 'booking', 'pesan'] },
  { url: '/sale/', anchor: 'penawaran unit yang ada', match: ['promo', 'diskon', 'potongan', 'cashback', 'sale'] },
];

// ---- deploy / indexing identifiers (env-overridable) --------------------
export const CF_PROJECT = process.env.CF_PAGES_PROJECT || 'valleycity-id';
export const GSC_SITE_URL = process.env.GSC_SITE_URL || `sc-domain:${SITE.replace(/^https?:\/\//, '')}`;
export const SITEMAP_URL = `${SITE}/sitemap-index.xml`;
export const INDEXNOW_KEY_FILE = 'indexnow.txt';
export const NOTIFY_PREFIX = process.env.NOTIFY_PREFIX || 'valleycity-seo';
