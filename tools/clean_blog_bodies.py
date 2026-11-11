#!/usr/bin/env python3
"""Clean the imported blog bodies.

Three things were removed or replaced, because they were the clearest signs
that the posts were machine-written and machine-exported:

1. The banner image ("responsive-ads") that sat at the top of 38 posts — the
   same advert, over and over.
2. Emoji from list items (897 of them across 70 posts). The site reads as a
   development brand; a bullet list of 🏞️ 🚆 💰 does not.
3. The "silakan cek Google Search" link, which was a placeholder for a
   reference link and pointed at a search engine, not a source.

Run from the workspace root:

    python3 tools/clean_blog_bodies.py
"""

from __future__ import annotations

import pathlib
import re

COLLECTION = pathlib.Path("site/src/collections/blog")

EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U00002B00-\U00002BFF\uFE0F\u20E3]"
)

# <img …responsive-ads…> — the repeated advert banner.
BANNER_IMG = re.compile(r'<img[^>]*responsive-ads[^>]*>\s*')

# A whole paragraph that only points at a search engine is replaced by a
# sentence that says something useful.
GOOGLE_PARA = re.compile(
    r"<p>(?:(?!</p>).)*?google\.com/search(?:(?!</p>).)*?</p>", re.S
)

# Any remaining bare "Google Search" anchor.
GOOGLE_LINK = re.compile(
    r'<a href="https://www\.google\.com/search\?q=[^"]*"[^>]*>Google Search</a>'
)

# The whole "cek Google Search" sentence, replaced with a sentence that says
# something useful instead of pointing at a search box.
REPLACE_SENTENCE = (
    "Harga sewaktu-waktu dapat berubah. Untuk angka yang berlaku hari ini dan "
    "unit yang tersedia, hubungi tim kami."
)

SPACE_AFTER_STRIP = re.compile(r"[ \t]{2,}")

# --- The template block every post ends with -------------------------------
#
# All 71 posts carried the same tail: a pitch for a third-party advertising
# agency, a survey link, a list of the access times, a quote written in "Kamu",
# a gallery of seven images with the alt text "1".."7", and a bare YouTube
# link. It is the clearest sign that the posts were generated rather than
# written, and none of it belongs on a developer's own site.

BERIKLAN_BLOCK = re.compile(
    r"<h2>Ingin Pasarkan Properti Anda\?</h2>.*?</ul>\n", re.S
)

SURVEY_BLOCK = re.compile(
    r"<h2>Tertarik Survey Rumah di Valley Cityview\?</h2>.*?</ul>\n", re.S
)

SURVEY_REPLACEMENT = (
    "<p>Ingin melihat unitnya langsung? Tim kami menyiapkan jadwal kunjungan ke "
    "Laksanamekar, Padalarang, dan membantu menghitung cicilannya. "
    '<a href="https://wa.me/6281188010326" target="_blank" rel="noopener">'
    "Chat WhatsApp 0811-8801-0326</a>.</p>\n"
)

BOOKING_BLOCK = re.compile(
    r"<h2>Booking Hanya 5 Juta\s*</h2>\s*"
    r'<a href="https://wa\.link/[^"]*">Booking Sekarang</a>\s*'
    r"https://www\.youtube\.com/shorts/[A-Za-z0-9_-]+",
    re.S,
)

BOOKING_REPLACEMENT = (
    "<h2>Booking hanya Rp 5 juta</h2>\n"
    "<p>Booking fee bisa dicicil. Unit yang tersedia kami kabari setelah Anda "
    "menghubungi kami.</p>\n"
)

BARE_YOUTUBE = re.compile(r"https://www\.youtube\.com/shorts/[A-Za-z0-9_-]+")

# The price-list graphic was alt-texted with the competitor's name.
PRICELIST_ALT = re.compile(
    r'<img src="/media/curated/pricelist\.webp" alt="[^"]*"',
)

# Seven pictures with the alt text "1".."7".
IMAGE_ALTS = {
    "detail-1.webp": "Tampak depan unit Valley Cityview tipe 45/72",
    "detail-2.webp": "Halaman depan unit dengan carport",
    "detail-3.webp": "Ruang keluarga unit dengan pintu lebar ke taman",
    "unit-4.webp": "Poster unit Valley Cityview tipe 45/72",
    "unit-5.webp": "Poster unit Valley Cityview tipe 45/72",
    "unit-6.webp": "Poster unit Valley Cityview tipe 45/72",
    "unit-7.webp": "Poster unit Valley Cityview tipe 45/72",
}


def fix_image_alts(text: str) -> str:
    for name, alt in IMAGE_ALTS.items():
        text = re.sub(
            rf'(<img src="/media/curated/{re.escape(name)}" alt=)"[^"]*"',
            rf'\1"{alt}"',
            text,
        )
    return text


def clean(text: str) -> tuple[str, int, int, int]:
    removed_banners = len(BANNER_IMG.findall(text))
    text = BANNER_IMG.sub("", text)

    google_links = len(GOOGLE_LINK.findall(text))
    text = GOOGLE_PARA.sub(f"<p>{REPLACE_SENTENCE}</p>", text)
    text = GOOGLE_LINK.sub("tim kami", text)

    emoji_count = len(EMOJI.findall(text))
    text = EMOJI.sub("", text)

    text = BERIKLAN_BLOCK.sub("", text)
    text = SURVEY_BLOCK.sub(SURVEY_REPLACEMENT, text)
    text = BOOKING_BLOCK.sub(BOOKING_REPLACEMENT, text)
    text = BARE_YOUTUBE.sub("", text)
    text = PRICELIST_ALT.sub(
        '<img src="/media/curated/pricelist.webp" alt="Daftar harga unit Valley Cityview"',
        text,
    )
    text = fix_image_alts(text)

    # The quote was written in "Kamu"; the site speaks to the reader as "Anda".
    text = text.replace("Kamu baru pulang kerja", "Anda baru pulang kerja")
    text = text.replace("Bayangkan… Kamu", "Bayangkan… Anda")

    # A list item that was only an emoji becomes an empty bullet.
    text = re.sub(r"<li>\s*</li>", "", text)
    text = re.sub(r"<li>\s*</li>", "", text)

    # Tidy the leftovers: doubled spaces and empty lines.
    text = SPACE_AFTER_STRIP.sub(" ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)

    return text, removed_banners, google_links, emoji_count


def main() -> None:
    files = sorted(COLLECTION.glob("*.md"))
    banners = links = emoji = 0

    for path in files:
        text = path.read_text(encoding="utf-8")
        head, sep, body = text.partition("\n---\n")
        if not sep:
            continue
        new_body, b, g, e = clean(body)
        if new_body != body:
            path.write_text(head + sep + new_body, encoding="utf-8")
        banners += b
        links += g
        emoji += e

    print(f"posts scanned       : {len(files)}")
    print(f"banner images removed: {banners}")
    print(f"google-search links  : {links}")
    print(f"emoji removed       : {emoji}")


if __name__ == "__main__":
    main()
