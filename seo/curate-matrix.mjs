#!/usr/bin/env node
/**
 * seo/curate-matrix.mjs — kurasi pool mine-matrix jadi keyword siap-approve.
 *
 * Pool (seo/keywords.mined.json) = ratusan variasi long-tail. Kurasi ini:
 *   1. pagar ulang fail-closed (termasuk noise Malaysia: johor/skim, DP0, expo)
 *   2. petakan geo ke slug sah cities.json (5 anchor)
 *   3. klasifikasi INTENT-bucket + INFO-modifier → decision-key
 *   4. satu keputusan = satu keyword (varian judul digabung, sel matriks distinct dipertahankan)
 *   5. auto-schema: category/cluster/priority/demand_signal/intent jujur + bukti demand
 *   6. gabung dengan keywords.json lama (dedupe slug + decision-key), gate TETAP tertutup
 *
 * Idempoten: item hasil kurasi matriks sebelumnya (evidence.source=autocomplete-matrix)
 * dibuang dulu sebelum re-kurasi, supaya perbaikan pagar tidak menumpuk duplikat.
 *
 * PEMAKAIAN: node seo/curate-matrix.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

const MINED = join(ROOT, 'seo/keywords.mined.json');
const KW = join(ROOT, 'seo/keywords.json');
const CITIES = join(ROOT, 'seo/cities.json');

// ── Pagar fail-closed ───────────────────────────────────────────────────────
const WRONG_PRODUCT = /(subsidi|second|bekas|sewa|kontrakan|ngontrak|kos\b|kost|indekos|renovasi|disewakan|kostum)/i;
const NON_HOUSE = /\b(makan|daging|sakit|restoran|resto|cafe|kafe|hotel|wisata|kuliner|penginapan|losmen|salon|spa\b|klinik|apotek|sekolah|masjid|gereja|grosir|pakaian|supplier|busana|fashion|baju|konveksi|tekstil|garment|mebel|furniture|elektronik|sembako|warung|dagangan|kios|lapak|dealer|showroom|bengkel|internet|wifi|indihome|biznet|firstmedia|pulsa|kuota|provider|isp)\b/i;
const WRONG_COUNTRY = /\b(kwsp|lppsa|subsale|epf|socso|full\s?loan|maybank|cimb|rhb|public\s?bank|hong\s?leong|bank\s?islam|loan\s?agreement|strata|bumiputra|nak\b|kerajaan|loan\b|deposit\b|johor|skim|skema|melaka|penang|selangor|perak|sabah|sarawak|kedah|kelantan|terengganu|pahang|sembilan|bantuan\s?kasih|faedah|kediaman|belanjawan|hartanah|bumiputera|geran|ansuran|cagaran|gadai|mot)\b/i;
// Bukan keputusan beli unit BARU kita: upacara, warisan, berita, sisi-penjual, konstruksi.
const OFF_PRODUCT = /\bpeletakan\b|\bbatu\s?pertama\b|\bwaris\b|\bwarisan\b|\bwali\s?kota\b|\bbupati\b|\bcepat\s?terjual\b|\bmenjual\s?rumah\b|\bcara\s?menjual\b|\bbangun\s?rumah\b|\bbiaya\s?bangun\b|\bmembangun\b|\bkampung\b|\bdinas\b|\bjoglo\b|\blimasan\b|\bmenggambar\b|\badat\b|\barsitektur\b|\bmbr\b|\bnafkah\b|\bcerai\b|\btalak\b|\biddah\b|\bmahar\b|\bjaman\s?dulu\b|\bzaman\s?dulu\b|\bberikat\b|\bindustri\b/i;
const OUT_GEO = /\b(jakarta|depok|tangerang|bogor|bekasi|bks|cinere|jatinangor|banjaran|banjar|banjarnegara|semarang|surabaya|yogyakarta|solo|medan|makassar|denpasar|bali|malaysia|singapura|sukabumi|kuningan|garut|tasikmalaya|cirebon|subang|purwakarta|karawang|cianjur|rangkasbitung|serang|cilegon|pandeglang|lebak|batam|pekanbaru|palembang|lampung|jambi|padang|manado|balikpapan|banjarmasin|pontianak|samarinda|mataram|kupang|ambon|jayapura|ternate|gorontalo|palu|kendari|bima|aceh|binjai|dumai|bukittinggi|payakumbuh|solok|pariaman|sibolga|langsa|lhokseumawe|parepare|palopo|gowa|maros|takalar|jeneponto|bantaeng|bulukumba|sinjai|bone|watampone|sengkang|majene|mamuju|polewali|mamasa|masamba|malili|sorowako|rantepao|makale|toraja|bandung\s?kulon)\b/i;
// Sub-area Kota/Kab Bandung di LUAR koridor Padalarang–Cimahi (bukan pasar proyek).
const OUT_GEO_CITY = /\b(kota\s?bandung|bandung\s?(kota|timur|selatan|utara|wetan|kidul|kaler)|cibiru|buahbatu|gedebage|rancasari|arcamanik|antapani|cicaheum|cicadas|sukapura|kiaracondong|cileunyi|cimenyan|cilengkrang|bojongsoang|dayeuhkolot|baleendah|katapang|soreang|ciwidey|pangalengan|cicalengka|rancaekek|majalaya|ciparay|pacet|paseh|cikancung|nagreg|solokanjeruk|ibun|cangkuang|rancabali|pasirjambu|cimaung|cipongkor|kertasari|kutawaringin|margaasih|andir|astanaanyar|babakanciparay|bojongloa|cibeunying|cinambo|cidadap|coblong|lengkong|mandalajati|panyileukan|regol|sukajadi|sukasari|sumur\s?bandung|ujungberung|leuwisari|turangga|batununggal|cisaranten|pasteur|gegerkalong|cipedes|cirangrang|cijerah|maleber|campaka|berkebun|kebonjeruk|cibuntu|ciseureuh|ciroyom|cijagra|palasari|merdeka|babakan|sukarasa|cipaganti|isola|sukawarna|gunungbatu|kebonkalapa|lembang|cisarua|parongpong|cihampelas|setiabudi)\b/i;
const COMPETITOR = /\b(summarecon|podomoro|malaya|g\s?land|citra\s?pesona|permata\s?cimahi|pharmindo|cipageran|cihanjuang|bukit\s?indah|nusa\s?hijau|ciuyah|pancanaka|grand\s?cimahi|pesona\s?alam|permana|amanda|emily|kbp|parahyangan|pondok\s?padalarang|mitra\s?dago|dago|antapani|kota\s?baru|regency|burgundy|rendeh|techno|valley\s?view|city\s?view|padalarang\s?indah|padalarang\s?valley|barukai|persada|bumi\s?baros|pondok|melong|green\s?garden|residence|residency|griya)\b/i;
// Nama kompleks perumahan lain (navigasional/competitor) — penanda proper-name ID/EN.
// Tidak memuat kata tipe legit (cluster/minimalis/tipe/baru/murah/siap huni).
const COMPLEX_NAME = /\b(graha|puri|taman|tamansari|tanimulya|mutiara|indah|lestari|permai|kencana|wastukencana|fajar|bunga|bodas|cilame|kopo|singosari|pelangi|hijau|raya|asri|sentosa|harapan|sejahtera|mandiri|mulya|kemilau|cemerlang|gemilang|pertiwi|nusantara|sari|wangi|melati|anggrek|kenanga|cempaka|flamboyan|kamboja|tulip|mawar|dahlia|seruni|mentari|surya|bumi|mas|emas|permata|wisma|garden|gardenia|greenville|gantole|green|valley|hill|hills|estate|royal|grand|orchid|orchard|dream|sharon|rosalie|village|town|square|park|court|place|point|view|ridge|height|heights|spring|summer|autumn|winter|lake|river|mountain|mansion|villa|condo|apartment|suite|loft|studio|plaza|tower|towers)\b/i;
// Heuristik struktural: "rumah/perumahan [token] [geo]" — token di antara yang BUKAN
// deskriptor generik / kata geo / landmark = proper-name kompleks lain → tolak.
const GENERIC_DESC = new Set(('murah kpr baru cluster minimalis tipe type siap huni dijual jual di dekat pertama mewah sederhana kecil besar luas strategis nyaman aman sehat modern classic american european japanese gadung ready stock indent promo diskon termurah terbaru terbaik terdekat populer rekomendasi impian idaman keluarga muda milenial bphtb ppjb shm hgb denah booking nup dp cicilan angsur angsuran harga biaya syarat cara apa apakah berapa tips panduan simulasi agen mitra subsidi bekas sewa kost kos second renovasi tumbuh kembang full furnished unfurnished kosong lantai lt lb tanah bangunan lahan sertifikat balik nama pbb imb pbg notaris bank btn bni bri mandiri bca bsi cimb niaga danamon permata maybank panin bukopin jabar bjb dan untuk dengan sekitar yang atau serta buat bagi tentang soal ke dari pada dalam adalah para si sang plus tanpa pakai pake bisa boleh mau ingin cari butuh perlu wajib harus akan sedang sudah telah belum tidak bukan jangan hanya saja juga lagi lebih paling sangat agak cukup mulai sejak sampai hingga antara vs versus terjangkau ekonomis elite elit premium luxury lux megah cantik bagus baik ideal cocok tepat pas favorit unggulan pilihan alternatif solusi').split(' '));
const GEO_WORDS = new Set(('cimahi padalarang bandung baros laksanamekar ngamprah batujajar cililin barat timur utara selatan tengah jawa wetan cikalong cipeundeuy cipatat kota kabupaten kab di dekat tol stasiun kcic whoosh unjani kampus gerbang').split(' '));
function namedComplex(t) {
  const m = t.match(/^(?:rumah|perumahan)\s+(.+?)\s+(cimahi|padalarang|bandung|baros|laksanamekar|ngamprah|batujajar|cililin|cikalong wetan|cipeundeuy|cipatat|jawa barat)(?:\s+(utara|selatan|tengah|barat|timur))?(?:\s+(harga|murah|terbaru|terbaik|2026|2025|dijual|jual|kpr|cicilan))?$/);
  if (!m) return false;
  for (const w of m[1].split(/\s+/)) {
    if (/^\d+$/.test(w) || GENERIC_DESC.has(w) || GEO_WORDS.has(w)) continue;
    return true;
  }
  return false;
}
const PRICE_OUT = /\b([1-4]\d{2}|7\d{2}|[89]\d{2}|1\d{3})\s?(jutaan|juta|jt)\b/i;
const PRICE_MILYAR = /\b\d+([.,]\d+)?\s?(milyar|miliar|milliar)\b/i;
const CICILAN_OUT = /\b([12]|5|[6-9])\s?(jutaan|juta|jt)\b/i;
const DP0 = /\btanpa\s?dp\b|\bdp\s?0\b|\b0\s?dp\b|\bdp\s?nol\b|\btanpa\s?uang\s?muka\b/i; // DP0 tidak ada di rekaman
const TRANSIENT = /\b(expo|pameran|bazaar|lelang|dilelang|festival|fest)\b/i; // event/lelang, bukan produk baru kita
const NONSENSE = /\bdi\s?dunia\b|\bkakak\b|\biparku\b|\bipar\b|\bqanita\b|\bpak\s?darto\b|\blulu\b/i;
const JUNK = /\b(login|apk|template|wallpaper|lowongan|loker|film|drakor|game|slot|judi|download|gratis|free|olx|facebook|instagram|tiktok|foto|gambar|peta|maps|reviews?|vibes)\b/i;
const QUESTION = /\b(apa|cara|mengapa|kenapa|bagaimana|apakah|berapa|mana|kapan)\b/i;
const INTENT_HIGH = /(kpr|cicil|angsur|dp\b|booking|nup\b|ppjb|bphtb|denah|tipe\s?45|type\s?45|unit\b|dijual|jual|harga|mitra|agen|simulasi|gaji|pertama|kcic|stasiun|tol\b|unjani|whoosh)/i;
const IN_GEO = /\b(cimahi|padalarang|bandung\s?barat|bandung|laksanamekar|baros|ngamprah|batujajar|cililin|cikalong\s?wetan|jawa\s?barat)\b/i;

function fence(t) {
  if (WRONG_PRODUCT.test(t)) return 'produk-salah';
  if (NON_HOUSE.test(t)) return 'bukan-rumah';
  if (WRONG_COUNTRY.test(t)) return 'pembiayaan-malaysia';
  if (OFF_PRODUCT.test(t)) return 'bukan-keputusan-beli-baru';
  if (JUNK.test(t)) return 'junk/navigasi';
  if (COMPETITOR.test(t)) return 'cluster-kompetitor';
  if (COMPLEX_NAME.test(t)) return 'nama-kompleks-lain';
  if (namedComplex(t)) return 'nama-kompleks-lain';
  if (OUT_GEO.test(t)) return 'geo-luar-pasar';
  if (OUT_GEO_CITY.test(t)) return 'geo-luar-koridor';
  if (PRICE_OUT.test(t) || PRICE_MILYAR.test(t)) return 'bracket-di-luar-rekaman';
  if (/\bcicilan\b/i.test(t) && CICILAN_OUT.test(t)) return 'bracket-cicilan-di-luar-rekaman';
  if (DP0.test(t)) return 'dp0-di-luar-rekaman';
  if (TRANSIENT.test(t)) return 'event/lelang-transient';
  if (NONSENSE.test(t)) return 'nonsense';
  const w = t.split(/\s+/).filter(Boolean);
  if (w.length < 2 || w.length > 8) return 'panjang-tidak-wajar';
  if (!INTENT_HIGH.test(t) && !IN_GEO.test(t)) return 'tanpa-intent/geo';
  return null;
}

// ── Geo → slug sah cities.json ──────────────────────────────────────────────
function geoOf(t) {
  if (/laksanamekar/i.test(t)) return 'laksanamekar';
  if (/padalarang|kcic|whoosh|stasiun/i.test(t)) return 'padalarang';
  if (/\bbaros\b/i.test(t)) return 'baros';
  if (/unjani|kampus cimahi/i.test(t)) return 'cimahi';
  if (/\bcimahi\b/i.test(t)) return 'cimahi';
  if (/bandung\s?barat|ngamprah|batujajar|cililin|cikalong\s?wetan|cipeundeuy|cipatat/i.test(t)) return 'bandung-barat';
  if (/\bbandung\b/i.test(t)) return 'bandung-barat';
  return null;
}
const GEO_LABEL = { padalarang: 'Padalarang', cimahi: 'Cimahi', 'bandung-barat': 'Bandung Barat', laksanamekar: 'Laksanamekar', baros: 'Baros' };
// Frasa geo spesifik dari keyword (sub-area dipertahankan supaya intent jujur & granular).
function geoPhrase(t, geo) {
  const m = t.match(/cimahi\s+(utara|selatan|tengah)/i);
  if (m) return 'Cimahi ' + m[1][0].toUpperCase() + m[1].slice(1);
  if (/laksanamekar/i.test(t)) return 'Laksanamekar';
  if (/ngamprah/i.test(t)) return 'Ngamprah';
  if (/batujajar/i.test(t)) return 'Batujajar';
  if (/cililin/i.test(t)) return 'Cililin';
  if (/cikalong\s?wetan/i.test(t)) return 'Cikalong Wetan';
  if (/cipeundeuy/i.test(t)) return 'Cipeundeuy';
  if (/cipatat/i.test(t)) return 'Cipatat';
  return geo ? GEO_LABEL[geo] : null;
}
// Canonical dedup: buang stopword trivial + urutkan kata. Variasi geo sub-area &
// info modifier TETAP distinct; hanya duplikat trivial (di/yang/urutan kata) dilipat.
const STOP = new Set(['di', 'yang', 'dan', 'untuk', 'dengan', 'sekitar', 'ke', 'dari', 'pada', 'dalam', 'adalah', 'para', 'si', 'sang', 'atau', 'serta', 'buat', 'bagi', 'tentang', 'soal']);
function canonical(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).sort().join(' ');
}

// ── INTENT-bucket: urutan penting (harga/jual/kpr dulu, landmark hanya landmark kita) ──
function bucketOf(t) {
  if (/agen|mitra/i.test(t)) return 'agen';
  if (/denah|tipe\s?45|type\s?45/i.test(t)) return 'denah-tipe';
  if (/booking|nup\b/i.test(t)) return 'booking-nup';
  if (/simulasi/i.test(t)) return 'simulasi';
  if (/bphtb|ppjb|shm|hgb|imb|pbg|sertifikat|balik nama|akta/i.test(t)) return 'legal';
  if (/cicil|angsur/i.test(t)) return 'cicilan';
  if (/\bdp\b|uang muka/i.test(t)) return 'dp';
  if (/harga/i.test(t)) return 'harga';
  if (/jual|dijual/i.test(t)) return 'jual';
  if (/kpr/i.test(t)) return 'kpr';
  if (/rumah pertama|beli rumah pertama/i.test(t)) return 'beli-pertama';
  if (/dekat\s+(stasiun|kcic|whoosh|tol|unjani|kampus)|\b(stasiun|kcic|whoosh|unjani)\b/i.test(t)) return 'landmark';
  if (/murah/i.test(t)) return 'rumah-murah';
  if (/baru|siap huni/i.test(t)) return 'rumah-baru';
  return 'rumah-general';
}
function infoOf(t) {
  const m = t.match(/\b(cara|berapa|apakah|syarat|biaya|apa itu|tips|panduan|perbedaan|terbaik|terdekat|2026)\b/i);
  return m ? m[1].toLowerCase().replace(/\s+/g, '-') : null;
}
const BUCKET_CATEGORY = { agen: 'agen', landmark: 'lokasi', 'denah-tipe': 'unit', 'booking-nup': 'harga', simulasi: 'kpr', dp: 'kpr', cicilan: 'harga', legal: 'legalitas', kpr: 'kpr', 'beli-pertama': 'panduan', harga: 'harga', jual: 'lokasi', 'rumah-murah': 'harga', 'rumah-baru': 'unit', 'rumah-general': 'lokasi' };
function clusterOf(bucket, geo) {
  if (bucket === 'agen') return 'agen';
  if (bucket === 'landmark') return 'komuter-kcic';
  if (bucket === 'denah-tipe') return 'unit-45-72';
  if (bucket === 'booking-nup') return 'biaya-tersembunyi';
  if (bucket === 'simulasi' || bucket === 'dp') return 'hitung-dulu';
  if (bucket === 'cicilan') return 'bracket-harga';
  if (bucket === 'legal') return 'cek-legalitas';
  if (bucket === 'kpr') return 'ajukan-kpr';
  if (bucket === 'beli-pertama') return 'keputusan-beli';
  if (geo === 'padalarang' || geo === 'laksanamekar') return 'area-padalarang';
  if (geo === 'cimahi') return 'area-cimahi';
  if (geo === 'bandung-barat') return 'area-bandung-barat';
  if (geo === 'baros') return 'komuter-kcic';
  return 'keputusan-beli';
}
function priorityOf(bucket, score) {
  let p = 70;
  if (['harga', 'jual', 'cicilan', 'dp', 'kpr', 'beli-pertama'].includes(bucket)) p = 85;
  if (bucket === 'landmark') p = 88;
  if (bucket === 'agen' || bucket === 'denah-tipe') p = 75;
  if (bucket === 'rumah-general' || bucket === 'rumah-baru') p = 72;
  if (score >= 40) p += 5; else if (score >= 33) p += 3;
  return Math.min(95, p);
}
function demandOf(bucket, geo, info, t) {
  if (/apa itu/i.test(t)) return 'aeo';
  if (geo) return 'geo-matrix';
  if (bucket === 'cicilan' || bucket === 'dp' || bucket === 'harga') return 'high';
  if (info) return 'longtail-intent';
  return 'high';
}
function intentOf(bucket, geo, info, t) {
  const g = geoPhrase(t, geo);
  const di = g ? ` di ${g}` : '';
  switch (bucket) {
    case 'harga': return `berapa harga rumah${di} saat ini, dan di mana posisi Rp 599 juta tipe 45/72 dibanding pasar sekitar`;
    case 'jual': return `rumah dijual${di} — apa yang harus dicek sebelum membeli unit baru di koridor ini`;
    case 'rumah-murah': return `rumah murah${di} yang layak huni dan legalitasnya jelas, bukan murah karena cacat`;
    case 'rumah-baru': return `rumah baru / siap huni${di} — apa yang dicek saat serah terima unit`;
    case 'rumah-general': return `rumah${di} — pilihan tipe 45/72 untuk pembeli rumah pertama di koridor Bandung Barat`;
    case 'landmark': return `rumah dekat ${/unjani|kampus/i.test(t) ? 'kampus Unjani Cimahi' : /tol|baros/i.test(t) ? 'gerbang tol Baros' : 'stasiun KCIC Padalarang'} — berapa menit sebenarnya dan apakah cocok untuk komuter`;
    case 'cicilan': return `cicilan rumah ${/3 jutaan|3 juta/i.test(t) ? '3 jutaan' : /4 juta/i.test(t) ? '4 jutaan' : 'terjangkau'} — apakah Rp 3.871.000/bl tenor 20 tahun masuk akal untuk penghasilan saya`;
    case 'dp': return 'berapa DP KPR rumah yang harus disiapkan, dan biaya apa saja yang muncul di luar DP';
    case 'simulasi': return 'cara simulasi KPR rumah yang benar sebelum survei — hitung cicilan, tenor, dan kemampuan bayar';
    case 'kpr':
      if (/apa itu/i.test(t)) return 'apa itu KPR rumah dan bagaimana kerjanya untuk pembeli rumah pertama';
      if (/terbaik|bank mana|bank apa/i.test(t)) return 'bank mana yang terbaik untuk KPR rumah — cara membandingkan bunga, biaya, dan tenor sebelum akad';
      if (/tips/i.test(t)) return 'tips mengambil KPR rumah agar disetujui — dokumen, rasio cicilan, dan riwayat kredit';
      if (/syarat/i.test(t)) return 'syarat pengajuan KPR rumah — dokumen dan kondisi yang harus dipenuhi sebelum akad';
      if (/biaya/i.test(t)) return 'biaya KPR rumah di luar cicilan — provisi, admin, asuransi, dan notaris';
      if (/berapa/i.test(t)) return 'berapa cicilan dan biaya KPR rumah untuk tipe 45/72 harga Rp 599 juta';
      return `KPR rumah${di} — syarat, biaya, dan perhitungan sebelum akad`;
    case 'legal': return `${/bphtb/i.test(t) ? 'BPHTB' : /ppjb/i.test(t) ? 'PPJB' : /shm|hgb/i.test(t) ? 'SHM/HGB' : /balik nama/i.test(t) ? 'balik nama sertifikat' : 'legalitas'} rumah baru — apa itu, biaya, dan cara mengurusnya`;
    case 'beli-pertama':
      if (/syarat/i.test(t)) return 'syarat beli rumah pertama — dokumen, penghasilan, dan kondisi yang harus dipenuhi';
      return 'panduan beli rumah pertama dari nol: NUP, booking, KPR, akad, sampai serah terima — urutannya bagaimana';
    case 'booking-nup': return 'booking fee / NUP rumah — apa itu, berapa (Rp 5 juta), dan apakah bisa dicicil';
    case 'denah-tipe': return 'denah rumah tipe 45/72 — bangunan 45 m² dan lahan 72 m², cukup untuk keluarga kecil?';
    case 'agen': return `cara jadi agen properti${di} — komisi, syarat, dan program kemitraan developer`;
    default: return `pertanyaan pembeli tentang rumah${di}`;
  }
}

const mined = JSON.parse(readFileSync(MINED, 'utf8'));
const kw = JSON.parse(readFileSync(KW, 'utf8'));
const cities = JSON.parse(readFileSync(CITIES, 'utf8'));
const validGeo = new Set(cities.cities.map((c) => c.slug));

// Idempoten: buang item kurasi-matriks lama, sisakan basis (31 lama + 18 first-pass).
const before = kw.items.length;
kw.items = kw.items.filter((i) => i.evidence?.source !== 'autocomplete-matrix');
const reset = before - kw.items.length;

function keyOfItem(i) {
  return canonical(i.keyword);
}
const takenSlugs = new Set(kw.items.map((i) => i.slug));
const takenKeys = new Set(kw.items.map(keyOfItem));

const rejected = {};
const cells = new Map();
for (const c of mined.items) {
  const t = c.keyword.toLowerCase();
  const r = fence(t);
  if (r) { rejected[r] = (rejected[r] || 0) + 1; continue; }
  if (takenSlugs.has(c.slug)) { rejected['tabrakan-slug'] = (rejected['tabrakan-slug'] || 0) + 1; continue; }
  const geo = geoOf(t);
  if (geo && !validGeo.has(geo)) { rejected['geo-invalid'] = (rejected['geo-invalid'] || 0) + 1; continue; }
  const bucket = bucketOf(t);
  const info = infoOf(t);
  const key = canonical(c.keyword);
  if (takenKeys.has(key)) { rejected['duplikat-trivial (sudah ada)'] = (rejected['duplikat-trivial (sudah ada)'] || 0) + 1; continue; }
  const prev = cells.get(key);
  if (!prev || c.score > prev.score) cells.set(key, { ...c, geo, bucket, info, key });
}

let added = 0;
for (const c of cells.values()) {
  kw.items.push({
    keyword: c.keyword, slug: c.slug,
    category: BUCKET_CATEGORY[c.bucket] || 'panduan',
    intent: intentOf(c.bucket, c.geo, c.info, c.keyword.toLowerCase()),
    cluster: clusterOf(c.bucket, c.geo),
    priority: priorityOf(c.bucket, c.score),
    demand_signal: demandOf(c.bucket, c.geo, c.info, c.keyword.toLowerCase()),
    geo: c.geo, approved: false,
    evidence: { source: 'autocomplete-matrix', engines: c.engines, score: c.score, volume: c.volume, seed: c.seed, harvestedAt: mined.harvestedAt },
  });
  takenSlugs.add(c.slug); takenKeys.add(c.key); added++;
}
kw.items.sort((a, b) => b.priority - a.priority || (b.evidence?.score || 0) - (a.evidence?.score || 0));
kw._meta.curated = { at: new Date().toISOString(), tool: 'seo/curate-matrix.mjs', pool: mined.items.length, reset, added, total: kw.items.length, rejected, note: 'Matriks LOCAL×INTENT×INFO dikurasi jadi sel keputusan distinct. Gate TETAP tertutup sampai owner approve.' };
writeFileSync(KW, JSON.stringify(kw, null, 2) + '\n');

const state = JSON.parse(readFileSync(join(ROOT, 'seo/state.json'), 'utf8'));
const published = new Set(state.published.map((p) => p.slug));
const errs = []; const slugs = new Set();
for (const i of kw.items) {
  if (slugs.has(i.slug)) errs.push('duplikat slug ' + i.slug); slugs.add(i.slug);
  if (published.has(i.slug)) errs.push('tabrakan 54 post ' + i.slug);
  if (i.geo && !validGeo.has(i.geo)) errs.push('geo invalid ' + i.slug);
  for (const f of ['keyword', 'slug', 'category', 'intent', 'cluster', 'priority', 'demand_signal']) if (!i[f] && i[f] !== 0) errs.push('kosong ' + f + ' ' + i.slug);
}
console.log('reset item matriks lama :', reset);
console.log('pool dipanen            :', mined.items.length);
console.log('ditolak kurasi          :', JSON.stringify(rejected));
console.log('sel keputusan baru      :', added);
console.log('TOTAL keywords.json     :', kw.items.length, '(min 25:', kw.items.length >= 25 ? 'OK)' : 'KURANG)');
console.log('gate approved_at        :', kw._meta.approved_at, '(null = tertutup)');
console.log('validasi                :', errs.length ? errs.slice(0, 10).join('; ') : '0 error');
const byCat = {}; for (const i of kw.items) byCat[i.category] = (byCat[i.category] || 0) + 1;
console.log('category                :', JSON.stringify(byCat));
console.log('geo items               :', kw.items.filter((i) => i.geo).length);