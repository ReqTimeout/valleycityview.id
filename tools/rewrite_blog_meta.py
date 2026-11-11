#!/usr/bin/env python3
"""Rewrite the blog front matter: titles, descriptions and covers.

Why this exists
---------------
The 71 posts were imported from WordPress, where the titles were written as
clickbait ("Bikin Kaget!", "Bikin Shock!", "Terkejut dengan ...") and the
featured image was the same banner on every card. On the blog index that
read as a scraped content farm rather than a developer's own journal, and a
competitor's brand appeared in the first headline on the site.

This script keeps every post and every search keyword — the titles still
target the phrase people actually type — but states them plainly, gives each
post a real description, and spreads the covers over the project's own
photographs instead of one repeated banner.

Run from the workspace root:

    python3 tools/rewrite_blog_meta.py
"""

from __future__ import annotations

import pathlib
import re

COLLECTION = pathlib.Path("site/src/collections/blog")

# slug -> (title, description)
META: dict[str, tuple[str, str]] = {
    "bukit-indah-residence-cimahi": (
        "Bukit Indah Residence Cimahi: Lokasi, Harga, dan Kekurangannya",
        "Lokasi, unit yang tersedia, dan sisi yang jarang dibahas soal Bukit Indah "
        "Residence Cimahi, dibandingkan dengan kawasan Padalarang di Cimahi Barat.",
    ),
    "cicilan-rumah-bandung-miliki-hunian-impian-dengan-skema-ringan": (
        "Cicilan Rumah Bandung: Skema Ringan yang Perlu Anda Tahu",
        "Berapa cicilan yang realistis untuk penghasilan Anda, dan skema mana yang "
        "sebenarnya lebih ringan dari yang biasa diiklankan.",
    ),
    "cicilan-rumah-bandung": (
        "Cicilan Rumah Bandung: Berapa yang Realistis untuk Penghasilan Anda",
        "Cara menghitung cicilan KPR dari harga rumah, agar angka yang Anda "
        "periksa tidak hanya terasa menarik di brosur.",
    ),
    "cicilan-rumah-tanpa-dp-di-bandung": (
        "Cicilan Rumah Tanpa DP di Bandung: Syarat dan Risikonya",
        "Bagaimana skema tanpa uang muka bekerja, syarat pengajuannya, dan bagian "
        "yang biasanya tidak disebut di materi promosi.",
    ),
    "cimahi-perumahan": (
        "Perumahan di Cimahi: Pilihan Hunian di Bandung Barat",
        "Kawasan perumahan di Cimahi dan Padalarang, dikelompokkan menurut akses, "
        "ketinggian lahan, dan harga yang tercatat.",
    ),
    "cluster-amanda-summarecon-bandung": (
        "Cluster Amanda Summarecon Bandung: Harga dan Alternatif di Cimahi Barat",
        "Rincian harga Cluster Amanda Summarecon Bandung dan pilihan di Padalarang "
        "dengan luas lahan dan harga yang lebih ringan.",
    ),
    "cluster-emily-summarecon-bandung": (
        "Cluster Emily Summarecon Bandung: Harga dan Alternatif di Padalarang",
        "Rincian harga rumah di Cluster Emily Summarecon Bandung, lalu perbandingan "
        "dengan Hunian view lembah di Padalarang.",
    ),
    "daftar-harga-rumah-di-summarecon-bandung": (
        "Daftar Harga Rumah di Summarecon Bandung dan Bandingkan dengan Padalarang",
        "Kelas harga di Summarecon Bandung, lalu apa yang Anda dapat dengan budget "
        "yang sama di Cimahi Barat.",
    ),
    "daftar-perumahan-di-kota-bandung": (
        "Daftar Perumahan di Kota Bandung: Lokasi, Harga, dan Aksesnya",
        "Kawasan perumahan utama di Kota Bandung, dikelompokkan menurut akses ke "
        "kota dan harga jual rata-ratanya.",
    ),
    "daftar-perumahan-elit-di-bandung": (
        "Daftar Perumahan Elit di Bandung: Apa yang Membuatnya Mahal",
        "Apa yang membuat satu kawasan lebih mahal dari kawasan lain: lokasi, "
        "fasilitas, atau nama pengembangnya.",
    ),
    "daftar-perumahan-murah-di-bandung": (
        "Daftar Perumahan Murah di Bandung: Batas Harga yang Wajar",
        "Rentang harga rumah terjangkau di Bandung dan environs, plus hal-hal yang "
        "perlu dicek sebelum menilai sebuah unit.",
    ),
    "denah-rumah-summarecon-bandung": (
        "Denah Rumah Summarecon Bandung dan Denah Rumah Tipe 45/72",
        "Perbandingan denah: Layout rumah di Summarecon dengan denah tipe 45/72 yang "
        "memakai halaman depan dan belakang.",
    ),
    "harga-cicilan-rumah-di-bandung": (
        "Harga Cicilan Rumah di Bandung: Angka yang Perlu Disiapkan",
        "Berapa cicilan KPR di tiap kelas harga, dan berapa total yang harus "
        "dibayar sampai rumah selesai.",
    ),
    "harga-cluster-amanda-summarecon-bandung": (
        "Harga Cluster Amanda Summarecon Bandung: Rincian dan Bandingkan",
        "Rincian harga Cluster Amanda Summarecon Bandung beserta simulasi "
        "cicilannya, lalu perbandingan dengan pilihan di Padalarang.",
    ),
    "harga-cluster-cynthia-summarecon-bandung": (
        "Harga Cluster Cynthia Summarecon Bandung: Rincian dan Bandingkan",
        "Rincian harga Cluster Cynthia Summarecon Bandung dan simulasinya, "
        "dibandingkan dengan unit tipe 45/72 di Cimahi Barat.",
    ),
    "harga-perumahan-podomoro-park-bandung": (
        "Harga Perumahan Podomoro Park Bandung: Rincian dan Alternatif",
        "Rincian harga Podomoro Park Bandung, plus pilihan di Padalarang dengan "
        "luas lahan serupa dan cicilan yang lebih ringan.",
    ),
    "harga-perumahan-summarecon-bandung": (
        "Harga Perumahan Summarecon Bandung: Rincian dan Alternatif",
        "Kelas harga clustered Summarecon Bandung dan apa yang bisa Anda dapat "
        "dengan budget yang sama di Laksanamekar, Padalarang.",
    ),
    "harga-rumah-cimahi": (
        "Harga Rumah di Cimahi: Rincian Harga dan Cicilannya",
        "Rincian harga rumah di Cimahi dan Padalarang beserta simulasi cicilan KPR "
        "untuk tiap kelas harga, supaya angkanya bisa Anda periksa sendiri.",
    ),
    "harga-rumah-cluster-emily-summarecon-bandung": (
        "Harga Rumah Cluster Emily Summarecon Bandung: Rincian dan Bandingkan",
        "Rincian harga rumah di Cluster Emily Summarecon Bandung, dan bagaimana "
        "perbandingannya dengan Hunian view lembah di Padalarang.",
    ),
    "harga-rumah-di-podomoro-park-bandung-2": (
        "Harga Rumah di Podomoro Park Bandung: Rincian Biaya dan Cicilan",
        "Rincian harga, cicilan, dan biaya tambahan di Podomoro Park Bandung, "
        "lalu bagaimana dibandingkan dengan Hunian di Padalarang.",
    ),
    "harga-rumah-di-podomoro-park-bandung": (
        "Harga Rumah di Podomoro Park Bandung: Rincian dan Bandingkan",
        "Rincian harga rumah di Podomoro Park Bandung beserta cicilannya, dan "
        "alternatif di Padalarang yang punya akses KCIC serupa.",
    ),
    "harga-rumah-minimalis-di-bandung": (
        "Harga Rumah Minimalis di Bandung: Kelas Harga dan Contohnya",
        "Berapa harga rumah minimalis di Bandung pada tiap kelas, dan apa yang "
        "membedakan rumah 45 m² dengan yang 72 m².",
    ),
    "harga-rumah-podomoro-bandung": (
        "Harga Rumah Podomoro Bandung: Rincian dan Bandingkan",
        "Rincian harga rumah Podomoro Bandung di tiap klaster, lalu perbandingan "
        "dengan cicilan di Padalarang.",
    ),
    "harga-rumah-podomoro-park-bandung": (
        "Harga Rumah Podomoro Park Bandung: Rincian Biaya",
        "Rincian harga rumah di Podomoro Park Bandung beserta simulasi cicilannya, "
        "tanpa angka yang dilebih-lebihkan.",
    ),
    "harga-rumah-podomoro-park-buah-batu": (
        "Harga Rumah Podomoro Park Buah Batu dan Hunian di Padalarang",
        "Perbandingan harga rumah di Podomoro Park Buah Batu dengan Hunian di "
        "Padalarang, dari sisi harga, akses, dan luas lahan.",
    ),
    "harga-rumah-summarecon-bandung-2025": (
        "Harga Rumah Summarecon Bandung: Rincian dan Tren Harga",
        "Rincian harga rumah di Summarecon Bandung dari tahun ke tahun, dan apa "
        "yang menyebabkan harganya bergerak naik.",
    ),
    "harga-rumah-summarecon-gedebage-bandung": (
        "Harga Rumah Summarecon Gedebage Bandung: Rincian dan Bandingkan",
        "Rincian harga rumah Summarecon Gedebage Bandung, lalu perbandingannya "
        "dengan Hunian di Padalarang untuk budget yang sama.",
    ),
    "info-perumahan-di-bandung": (
        "Info Perumahan di Bandung: Yang Perlu Dicek Sebelum Membeli",
        "Daftar periksa sebelum membeli rumah di Bandung: status lahan, akses, "
        "legalitas, cicilan, dan biaya tersembunyi.",
    ),
    "jual-perumahan-bandung": (
        "Rumah Dijual di Bandung: Cara Membandingkan Opsi yang Layak",
        "Metode membandingkan rumah yang dijual di Bandung: harga per meter, "
        "kondisi bangunan, dan biaya perbaikan yang akan muncul menyusul.",
    ),
    "kpr-di-bandung": (
        "KPR di Bandung: Cara Menghitung Cicilan dan Memilih Tenor",
        "Langkah menghitung cicilan KPR sendiri, memilih tenor, dan menentukan "
        "uang muka yang tidak memberatkan bulanan Anda.",
    ),
    "kpr-rumah-bandung-kota": (
        "KPR Rumah di Bandung Kota: Syarat, Cicilan, dan Tips Memilih Bank",
        "Syarat pengajuan KPR, perbandingan simulate dari beberapa bank, dan tips "
        "memilih tenure yang aman untuk penghasilan Anda.",
    ),
    "kpr-rumah-bandung": (
        "KPR Rumah di Bandung: Langkah dari Simulasi sampai Ajukan",
        "Langkah praktis: dari simulasi angka, cek berkas, sampai pengajuan KPR "
        "Anda.",
    ),
    "perum-nusa-hijau-cimahi": (
        "Perum Nusa Hijau Cimahi: Lokasi, Unit, dan Harga",
        "Lokasi, tipe unit, dan harga Perum Nusa Hijau Cimahi, plus perbandingan "
        "dengan Hunian di Padalarang.",
    ),
    "perumahan-bandung": (
        "Perumahan di Bandung: Menilai Lokasi, Harga, dan Fasilitas",
        "Cara menilai satu kawasan perumahan di Bandung: jarak ke kerja, harga per "
        "meter, dan fasilitas yang benar-benar dipakai sehari-hari.",
    ),
    "perumahan-baru-di-bandung": (
        "Perumahan Baru di Bandung: Apa yang Perlu Diperhatikan",
        "Keunggulan dan risiko membeli unit baru di Bandung, dari status "
        "pembangunan sampai rencana akses jalan.",
    ),
    "perumahan-baru-di-cimahi-solusi-hunian-nyaman-dekat-kota": (
        "Perumahan Baru di Cimahi: Hunian Nyaman yang Tetap Dekat Kota",
        "Pilihan perumahan baru di Cimahi dan Padalarang yang tetap mudah dijangkau "
        "kota, lengkap dengan harga dan aksesnya.",
    ),
    "perumahan-baru-di-cimahi": (
        "Perumahan Baru di Cimahi: Unit Siap Huni dan Unit yang Masih Dikerjakan",
        "Perbedaan_unit yang sudah dihuni dengan unit yang masih dalam tahap "
        "finishing, dan apa akibatnya untuk waktu tunggu Anda.",
    ),
    "perumahan-bukit-permata-cimahi": (
        "Perumahan Bukit Permata Cimahi: Lokasi dan Hunian di Bandung Barat",
        "Lokasi, unit, dan harga Bukit Permata Cimahi, serta perbandingannya dengan "
        "kawasan Padalarang lain.",
    ),
    "perumahan-cimahi-bandung": (
        "Perumahan di Cimahi dan Bandung: Dua Pasar Hunian yang Berbeda",
        "Kunci perbedaan pasar hunian Cimahi dan Bandung: harga, luas lahan, dan "
        "fasilitas yang dijual.",
    ),
    "perumahan-cimahi-city-view": (
        "Perumahan Cimahi City View: Hunian di Cimahi Tengah",
        "Unit, harga, dan akses Clustering Cimahi City View di Cimahi Tengah, "
        "termasuk jarak ke pusat kota.",
    ),
    "perumahan-cimahi": (
        "Perumahan di Cimahi: Kriteria Dasar sebelum Menentukan Lokasi",
        "Lima pertanyaan yang menentukan Anda mencari hunian di Cimahi atau "
        "Padalarang, sebelum melihat harga.",
    ),
    "perumahan-citra-pesona-cimahi": (
        "Perumahan Citra Pesona Cimahi: Lokasi, Harga, dan Akses",
        "Lokasi, unit, dan harga Citra Pesona Cimahi, beserta jarak ke KCIC, "
        "Unjani, dan Tol Baros.",
    ),
    "perumahan-ciuyah-cimahi": (
        "Perumahan Ciuyah Cimahi: Hunian di Area Ciuyah",
        "Kawasan Ciuyah sebagai area hunian di Cimahi: akses, harga, dan yang "
        "cocok untuk keluarga muda.",
    ),
    "perumahan-dekat-unjani-cimahi": (
        "Perumahan Dekat Unjani Cimahi: Opsi Hunian untuk Pegawai dan Mahasiswa",
        "Pilihan hunian di dekat Kampus Unjani Cimahi, termasuk Valley Cityview di "
        "Laksanamekar yang sekitar 10 menit ke kampus.",
    ),
    "perumahan-di-bandung-cicilan-3-juta": (
        "Perumahan di Bandung dengan Cicilan 3 Juta: Apakah Realistis?",
        "Hitungan sederhana: berapa harga rumah yang bisa dibeli dengan cicilan "
        "Rp 3 juta per bulan, dan berapa harga yang benar-benar tersisa.",
    ),
    "perumahan-di-bandung": (
        "Perumahan di Bandung: Rekomendasi Lokasi untuk Keluarga Baru",
        "Pemilihan kawasan untuk keluarga baru: terdekat ke kerja, paling murah, "
        "dan paling mudah dihuni.",
    ),
    "perumahan-di-cimahi-bandung": (
        "Perumahan di Cimahi dan Sekitar Bandung: Perbandingan Lokasi",
        "Perbandingan harga dan akses kawasan Cimahi, Padalarang, dan Bandung "
        "Barat untuk pembeli rumah pertama.",
    ),
    "perumahan-di-cimahi-tengah": (
        "Perumahan di Cimahi Tengah: Akses Transportasi dan Huniannya",
        "Akses transportasi dan karakter kawasan Cimahi Tengah, serta harga "
        "hunian di sana.",
    ),
    "perumahan-di-cimahi": (
        "Perumahan di Cimahi: Rekomendasi Hunian untuk Keluarga Awal",
        "Pilihan hunian di Cimahi dan Padalarang untuk keluarga yang baru memulai, "
        "dari Rp 599 juta.",
    ),
    "perumahan-di-kota-cimahi": (
        "Perumahan di Kota Cimahi: Apa yang Bisa Anda Dapatkan di Sana",
        "Kawasan Cimahi Tengah, apartemen dan rumah, serta rentang harga yang "
        "bisa diharapkan di area kota.",
    ),
    "perumahan-elit-cimahi-hunian-mewah-dengan-view-alam": (
        "Perumahan Elit di Cimahi: Hunian Premium dengan View Alam",
        "Apa yang membuat sebuah-unit disebut elit di Cimahi, dan berapa harga yang "
        "perlu disiapkan untuk masuk ke kelas itu.",
    ),
    "perumahan-elit-di-cimahi": (
        "Perumahan Elit di Cimahi: Klasifikasi Harga dan Fasilitas",
        "Kelas harga dan fasilitas di perumahan elit Cimahi, serta opsi yang "
        "memiliki view sama tetapi bisa diakses lebih murah.",
    ),
    "perumahan-grand-cimahi-city": (
        "Perumahan Grand Cimahi City: Hunian di Cimahi dengan Konsep Terpadu",
        "Konsep kawasan terpadu Grand Cimahi City: klaster, fasilitas, dan harga "
        "unitnya.",
    ),
    "perumahan-murah-di-bandung": (
        "Perumahan Murah di Bandung: Batas Harga yang Wajar di 2026",
        "Rentang harga rumah terjangkau di Bandung dan environs, serta apa yang "
        "membedakan unit yang layak dengan yang sekadar murah.",
    ),
    "perumahan-murah-di-cihanjuang-cimahi": (
        "Perumahan Murah di Cihanjuang Cimahi: Opsi dengan Akses ke Kota",
        "Opsi hunian terjangkau di Cihanjuang Cimahi dan sekitarannya, dibanding "
        "Ciawi dan Padalarang yang aksesnya lebih dekat ke kota.",
    ),
    "perumahan-pancanaka-royal-garden-cimahi": (
        "Perumahan Pancanaka Royal Garden Cimahi: Unit dan Lokasi",
        "Unit, harga, dan akses Pancanaka Royal Garden Cimahi di Cibeureum.",
    ),
    "perumahan-permana-cimahi": (
        "Perumahan Permana Cimahi: Hunian di Cimahi Utara",
        "Lokasi, unit, dan harga Permana Cimahi di Cimahi Utara, serta jaraknya ke "
        "jalur tol dan pusat kota.",
    ),
    "perumahan-permata-cimahi-bandung": (
        "Perumahan Permata Cimahi Bandung: Lokasi dan Huniannya",
        "Tinjauan Hunian di kawasan Permata Cimahi — lokasi, unit yang tersedia, "
        "dan harga di kelasnya.",
    ),
    "perumahan-podomoro-bandung": (
        "Perumahan Podomoro Bandung: Mana yang Lebih Cocok untuk Anda?",
        "Perbandingan antar klaster Podomoro di Bandung berdasarkan harga, akses, "
        "dan tipe unit.",
    ),
    "perumahan-summarecon-bandung": (
        "Perumahan Summarecon Bandung: Hunian Premium di Kota Mandiri",
        "Apa yang dimaksud kawasan Summarecon Bandung, berapa harga hunian di sana, "
        "dan apa alternatifnya di Padalarang.",
    ),
    "pesona-alam-residence-cimahi": (
        "Pesona Alam Residence Cimahi: Hunian Asri dengan Udara Segar",
        "Kawasan Hunian di kaki perbukitan Cimahi: udara, ketinggian lahan, dan "
        "harga unit di dalamnya.",
    ),
    "podomoro-park-buah-batu": (
        "Podomoro Park Buah Batu: Harga, Akses, dan Alternatifnya",
        "Rincian harga dan akses Podomoro Park Buah Batu, lalu opsi di Padalarang "
        "dengan harga dan jarak yang berbeda.",
    ),
    "rumah-cicilan-developer-bandung": (
        "Rumah Cicilan Developer di Bandung: Cara Membaca Penawarannya",
        "Membaca offer developer yang memakai skema cicilan: cicilan, masa "
        "bunga, dan biaya yang belum termasuk di bulan pertama.",
    ),
    "rumah-cimahi": (
        "Rumah di Cimahi: Kriteria Harga, Lokasi, dan Akses",
        "Cara menilai rumah di Cimahi dan Padalarang: harga per meter, jarak ke "
        "kerja, dan status lahan.",
    ),
    "rumah-daerah-cimahi": (
        "Rumah di Cimahi: Menilai Kelayakan Harga dan Lokasinya",
        "Kapan harga rumah di Cimahi bisa disebut masuk akal, dan peta akses yang "
        "perlu dicek lebih dulu.",
    ),
    "rumah-dekat-kcic-bandung": (
        "Rumah Dekat KCIC Bandung: Hunian untuk yang Bekerja di Sekitar Padalarang",
        "Hunian dekat kereta cepat Padalarang: jarak tempuh, harga, dan pilihan "
        "yang tersedia di Laksanamekar.",
    ),
    "rumah-di-summarecon-bandung": (
        "Rumah di Summarecon Bandung: Harga dan Apa yang Anda Dapatkan",
        "Rincian harga rumah di Summarecon Bandung dan fasilitas yang dibayar, "
        "dibandingkan dengan Hunian di Padalarang.",
    ),
    "rumah-dijual-di-baros-cimahi": (
        "Rumah Dijual di Baros Cimahi: Strategi Membeli di Area Padalarang",
        "Harga rumah di Baros Cimahi dan Padalarang, plus tips memeriksa kondisi "
        "bangunan dan status lahan sebelum membayar.",
    ),
    "rumah-dijual-di-cimahi": (
        "Rumah Dijual di Cimahi: Cara Menemukan Unit yang Sesuai",
        "Cara mencari rumah dijual di Cimahi dan Padalarang yang sesuai budget, "
        "termasuk hal-hal nonnegotiable yang perlu dicek.",
    ),
    "rumah-murah-di-cimahi": (
        "Rumah Murah di Cimahi: Opsi di Bawah Rp 600 Juta",
        "Rumah di bawah Rp 600 juta di Cimahi dan Padalarang — apa yang Anda dapat "
        "dan apa yang perlu diterima.",
    ),
    "rumah-podomoro-park-bandung": (
        "Rumah Podomoro Park Bandung: Harga, Unit, dan Aksesnya",
        "Rincian harga dan unit di Podomoro Park Bandung, serta perbandingannya "
        "dengan hunian tipe 45/72 di Padalarang.",
    ),
}

# The project's own photographs, used as card covers. No stock imagery.
COVERS = [
    "/media/curated/design-45.webp",
    "/media/curated/hero.webp",
    "/media/curated/design-24.webp",
    "/media/curated/unit-3.webp",
    "/media/curated/knowledge-1.webp",
    "/media/curated/hero-2.webp",
    "/media/curated/design-25.webp",
    "/media/curated/hero-3.webp",
    "/media/curated/detail-5.webp",
]


def replace_field(text: str, key: str, value: str) -> str:
    """Replace a front-matter line, keeping the quoting style."""
    pattern = re.compile(rf'^{key}:\s*".*?"\s*$', re.M | re.S)
    replacement = f'{key}: "{value}"'
    new_text, count = pattern.subn(lambda _m: replacement, text, count=1)
    if count == 0:
        raise SystemExit(f"could not find '{key}' in front matter")
    return new_text


def main() -> None:
    missing = [s for s in META if not (COLLECTION / f"{s}.md").exists()]
    if missing:
        raise SystemExit("no such post(s): " + ", ".join(missing))

    changed = 0
    for index, (slug, (title, description)) in enumerate(sorted(META.items())):
        path = COLLECTION / f"{slug}.md"
        text = path.read_text(encoding="utf-8")
        text = replace_field(text, "title", title)
        text = replace_field(text, "description", description)
        text = replace_field(text, "cover", COVERS[index % len(COVERS)])
        path.write_text(text, encoding="utf-8")
        changed += 1

    print(f"rewritten posts : {changed}")
    print(f"covers available : {len(COVERS)}")


if __name__ == "__main__":
    main()
