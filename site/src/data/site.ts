/**
 * Single source of truth for site-wide content, contact details, pricing and
 * tracking IDs. Everything here is either verified from the WordPress backup
 * or was confirmed by the site owner.
 */

export const site = {
  name: 'Valley Cityview',
  legalName: 'Valley Cityview',
  tagline: 'Rumah yang menyatu dengan alam',
  origin: 'https://valleycityview.id',
  locale: 'id_ID',
  lang: 'id',

  description:
    'Valley Cityview — perumahan tipe 45/72 m² di Laksanamekar, Padalarang, Cimahi. ' +
    'Harga KPR Rp 599 juta, cicilan Rp 3.871.000 per bulan, booking fee Rp 5 juta.',

  address: {
    street: 'Desa Laksanamekar, Padalarang',
    city: 'Cimahi',
    region: 'Bandung Barat',
    postalCode: '40553',
    country: 'ID',
    countryName: 'Indonesia',
    maps: 'https://maps.google.com/?q=Laksanamekar,+Padalarang,+Cimahi',
  },

  contact: {
    /**
     * Single canonical WhatsApp number. The WordPress build had three
     * different numbers live at once (0811-8801-0326 on the footer,
     * +6285294475040 in the joinchat plugin, and an unresolved wa.link).
     * This is the one used by the static landing pages.
     */
    whatsapp: '6281188010326',
    whatsappDisplay: '0811-8801-0326',
    phone: '+62 811-8801-0326',
    email: 'halo@valleycity.id',
    hours: 'Senin – Sabtu, 09.00 – 18.00 WIB',
  },

  social: {
    facebook: 'https://facebook.com/valleycityview',
    instagram: 'https://instagram.com/valleycityview',
    tiktok: 'https://tiktok.com/@valleycityview',
  },

  /** Price of record. Verified against the annuity formula — see memory/01-decisions.md D-05. */
  pricing: {
    kprPrice: 599_000_000,
    monthly: 3_871_000,
    bookingFee: 5_000_000,
    tenureYears: 20,
    buildingArea: 45,
    landArea: 72,
  },

  /** Hard facts used across the site — the "proof" layer. */
  facts: [
    { value: '15 menit', label: 'ke Stasiun KCIC Padalarang' },
    { value: '10 menit', label: 'ke kampus Unjani Cimahi' },
    { value: '± Rp 5 juta', label: 'booking fee, bisa dicicil' },
    { value: '45 / 72 m²', label: 'luas bangunan / lahan' },
  ],

  /**
   * Tracking IDs — all of them read out of the WordPress backup, nothing
   * invented. `gtm` is the container the gtm4wp plugin injected
   * (GTM-NWMFR7ZN); GA4, Meta Pixel and Stape are the IDs that were live on
   * the old site.
   */
  tracking: {
    gtm: 'GTM-NWMFR7ZN',
    ga4: 'G-032P9CXFSM',
    metaPixel: '1187304636741697',
    stape: '7346906174684316448',
    googleAds: 'AW-17659084675',
    /** Lead-form conversion, fired on the thank-you page. */
    leadConversion: {
      id: 'AW-17449982747',
      label: 'ItCtCO_YiYIbEJu25oBB',
      value: 250,
      currency: 'IDR',
    },
  },
} as const;

/** Build a WhatsApp deep link with a pre-filled, human-sounding message. */
export function waLink(message: string): string {
  const text = encodeURIComponent(message);
  return `https://wa.me/${site.contact.whatsapp}?text=${text}`;
}

export const waMessages = {
  booking:
    'Halo Valley Cityview! Saya tertarik booking unit tipe 45/72. ' +
    'Boleh info ketersediaan unit dan jadwal kunjungan ke lokasi?',
  kpr:
    'Halo Valley Cityview! Saya mau tanya simulasi KPR untuk tipe 45/72. ' +
    'Boleh dibantu hitung cicilannya?',
  agent:
    'Halo Valley Cityview! Saya mau mendaftar jadi agen properti. ' +
    'Boleh informasi syaratnya?',
  general:
    'Halo Valley Cityview! Saya mau tanya unit tipe 45/72 di Laksanamekar, Padalarang.',
} as const;

export const nav = [
  { label: 'Tentang', href: '/#tentang' },
  { label: 'Unit & Denah', href: '/#unit' },
  { label: 'Lokasi', href: '/#lokasi' },
  { label: 'Simulasi KPR', href: '/simulasi-kpr/' },
  { label: 'Blog', href: '/blog/' },
] as const;
