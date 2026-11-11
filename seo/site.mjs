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

/** Ambil nilai numerik/string dari objek `site` di site.ts. */
function pick(path) {
  const key = path[path.length - 1];
  const re = new RegExp(`\\b${key}\\s*:\\s*("[^"]*"|'[^']*'|[\\d_][\\d_']*)`);
  const m = src.match(re);
  if (!m) throw new Error(`site.mjs: "${key}" tidak ditemukan di ${SITE_DATA_PATH}`);
  const raw = m[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) return raw.slice(1, -1);
  return Number(raw.replace(/_/g, ''));
}

export const BRAND = pick(['name']);
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
      platform: `Tipe 45/72 — ${ADDRESS.street}, ${ADDRESS.city}`,
      price: rupiah(PRICING.kprPrice),
      installment: `${rupiah(PRICING.monthly)}/bulan`,
      note: `Booking fee ${rupiah(PRICING.bookingFee)}, tenor hingga ${PRICING.tenureYears} tahun`,
    },
  ],
};

/** Link CTA kanonik — mesin tidak pernah mengarang URL kontak. */
export const WA_LINK = (message) =>
  `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`;

// ---- deploy / indexing identifiers (env-overridable) --------------------
export const CF_PROJECT = process.env.CF_PAGES_PROJECT || 'valleycity-id';
export const GSC_SITE_URL = process.env.GSC_SITE_URL || `sc-domain:${SITE.replace(/^https?:\/\//, '')}`;
export const SITEMAP_URL = `${SITE}/sitemap-index.xml`;
export const INDEXNOW_KEY_FILE = 'indexnow.txt';
export const NOTIFY_PREFIX = process.env.NOTIFY_PREFIX || 'valleycity-seo';
