/**
 * seo/lib/geo-anchor.mjs — anchor area WAJIB untuk artikel geo (anti-doorway).
 *
 * Alasan modul ini dipertahankan dari socio.id: temuan di sana berlaku umum.
 * Anchor kota dikirim ke queue tapi hanya diteruskan ke prompt LLM; jalur
 * template deterministik membuangnya, sehingga halaman "geo" antarkota punya
 * similarity 0,58-0,68 — persis pola 71 post impor Valley Cityview yang baru
 * diaudit (delapan halaman "harga Podomoro Park" yang berbeda hanya namanya).
 * Anchor disuntik DETERMINISTIK, bukan diharapkan dari kepatuhan model.
 *
 * Yang diubah untuk repo ini:
 *   - Isi anchor = karakter lokasi (komuter KCIC, tol Baros, kampus Unjani),
 *     bukan ekonomi kreatif antarkota.
 *   - Penanda section berupa HEADING, bukan `{/* komentar *\/}`. Konten di repo
 *     ini Markdown biasa yang dilewatkan rehype-raw; kurung kurawal akan tercetak
 *     apa adanya ke halaman, dan komentar HTML tidak dijamin lolos serializer.
 *     Headline tidak bisa bocor ke teks terlihat karena memang teks.
 */

export const ANCHOR_MARKER = 'geo-anchor';

/** Heading penanda — dipakai juga oleh hasGeoAnchor(). */
const headingFor = (city) => `## Kenapa memilih hunian di ${city}`;

/** Bangun section H2 berisi fakta lokal area. Null kalau data kurang. */
export function renderGeoAnchor(geo) {
  const city = geo.city;
  const provinsi = geo.provinsi;
  const anchor = geo.local_anchor ?? geo.anchor;
  const buyer = geo.local_buyer ?? geo.buyer;
  if (!city || !anchor || String(anchor).trim().length < 20) return null;

  const p = [];
  p.push(headingFor(city));
  p.push('');
  p.push(
    `${city}${provinsi ? ` (${provinsi})` : ''} bukan nama di peta yang netral — karakter hariannya ` +
      'menentukan apakah sebuah alamat layak ditinggali atau hanya layak dibeli.',
  );
  p.push('');
  p.push(`- **Konteks lokasi:** ${anchor}`);
  if (buyer) p.push(`- **Siapa yang biasanya mencari di sini:** ${buyer}`);
  p.push('');
  p.push(
    'Perhatikan angka waktunya pada jam berangkat kerja, bukan angka "menit ke tol" di brosur. ' +
      'Untuk menghitung apakah cicilannya masuk dengan penghasilan Anda, pakai [simulasi KPR](/simulasi-kpr/).',
  );
  return p.join('\n');
}

/** Sisipkan content tepat setelah blok H2 pertama. */
function insertAfterFirstH2(body, content) {
  const B = String.fromCharCode(92);
  const re = new RegExp(
    '^##' + B + 's+[^' + B + 'n]+' + B + 'n([' + B + 's' + B + 'S]*?)(?=' + B + 'n## |' + B + '*$)',
    'm',
  );
  const m = body.match(re);
  if (!m) return `${body}

${content}`;
  const at = m.index + m[0].length;
  return `${body.slice(0, at)}

${content}

${body.slice(at)}`;
}

/**
 * Idempoten. Sudah ada heading anchor, atau LLM sudah menyebut potongan anchor
 * yang sama? body dikembalikan apa adanya — regenerasi tidak menumpuk section
 * kembar.
 */
export function injectGeoAnchor(markdown, geo) {
  if (!markdown || !geo || !geo.local_anchor) return markdown;
  const section = renderGeoAnchor(geo);
  if (!section) return markdown;
  if (markdown.includes(headingFor(geo.city))) return markdown;
  if (alreadyCited(markdown, geo.local_anchor)) return markdown;
  return insertAfterFirstH2(markdown, section);
}

/**
 * Kata kunci pembeda dari anchor area. Kata terpanjang dipilih lebih dulu —
 * yang khas ("komuter", "Padalarang"), bukan kata umum ("dengan", "serta").
 */
export function anchorProbe(anchor) {
  if (!anchor) return [];
  return [
    ...new Set(
      String(anchor)
        .split(/[\s,.;:()]+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter((w) => w.length > 4),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

/** Sudah tercantum? Dua dari tiga kata cukup — model sering menyebut sebagian. */
function alreadyCited(text, anchor) {
  const probe = anchorProbe(anchor);
  if (probe.length < 2) return false;
  const hits = probe.filter((w) => text.toLowerCase().includes(w.toLowerCase())).length;
  return hits >= 2;
}

/** Cek apakah artikel geo sudah punya anchor. Dipakai gate qc-uniqueness. */
export function hasGeoAnchor(text, anchor, city) {
  if (!text || !anchor) return false;
  if (city && text.includes(headingFor(city))) return true;
  if (text.includes(ANCHOR_MARKER)) return true;
  const probe = String(anchor)
    .split(/[\s,.;]+/)
    .filter((w) => w.length > 5)
    .slice(0, 3);
  return probe.length >= 2 && probe.every((w) => text.toLowerCase().includes(w.toLowerCase()));
}
