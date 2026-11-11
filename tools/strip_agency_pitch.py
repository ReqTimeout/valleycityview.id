#!/usr/bin/env python3
"""Strip the third-party advertising pitch out of the imported blog bodies.

Every one of the 71 posts carried an inserted section that promotes
Beriklan.co.id — an advertising agency that has nothing to do with Valley
Cityview. It appears in 22 different shapes (a heading, an intro paragraph, a
list of the agency's services, a closing paragraph), and the earlier cleanup
only removed one of them.

On a developer's own site this is wrong three times over: it is someone
else's advertisement, it hands a competitor's link juice away on every page,
and it is the clearest evidence that the articles were generated rather than
written.

The script removes the pitch as a *section*, not as a keyword. It walks the
top-level blocks of each body, marks the blocks that belong to the pitch, and
takes out each contiguous run of them — including the heading that introduces
it and the orphan advert graphic that trails the last one. A legitimate image
that happens to sit inside a pitch block is kept, so the price-list graphic
survives.

    python3 tools/strip_agency_pitch.py --report   # show what would go
    python3 tools/strip_agency_pitch.py             # apply
"""

from __future__ import annotations

import argparse
import pathlib
import re

COLLECTION = pathlib.Path("site/src/collections/blog")

# --- What identifies the pitch ---------------------------------------------

# The agency's own name, or the name of one of its services.
AGENCY = re.compile(
    r"beriklan\.co\.id|beriklan|jasa\s+iklan|jasa\s+digital\s+marketing",
    re.I,
)

# A list item that names one of the agency's services.
SERVICE = re.compile(r"^\s*(jasa\s+iklan|beriklan\s+di)\b", re.I)

# A heading that introduces the pitch. "Promo" is deliberately not in this
# list — a heading about Valley Cityview's own promo is legitimate.
PROMO_INTENT = re.compile(
    r"promosi|promosikan|pasarkan|pemasaran\s+properti|jual\s+properti"
    r"|layanan\s+iklan|iklan\s+properti|iklankan\s+properti",
    re.I,
)

# The advert graphic that trails the last post in some bodies.
AD_IMAGE = re.compile(r"jasa-digital-marketing", re.I)

# The anchor that wraps the advert graphic.
AD_ANCHOR = re.compile(
    r"<a\b[^>]*>(?:(?!</a>).)*?jasa-digital-marketing(?:(?!</a>).)*?</a>",
    re.S | re.I,
)

# Any other link to the agency. These are unwrapped rather than deleted: the
# old sweep removed the opening <a> and left its </a> behind, which produced
# `<li></a>` and orphan `</strong>` all over the corpus. Unwrapping keeps the
# tag pairs intact and still takes the outbound link out.
AGENCY_ANCHOR = re.compile(
    r'(<a\b[^>]*beriklan\.co\.id[^>]*>)((?:(?!</a>).)*?)(</a>)',
    re.S | re.I,
)

# --- The imported junk that is not the agency's fault -----------------------

# The old marketing poster — a stock photo of a family plus sales copy — that
# opens 30 of the 71 bodies. The vision bans it outright, and the article
# already gets a cover image from its frontmatter, so this is a duplicate.
POSTER_IMG = re.compile(
    r"<img\b[^>]*wp-content-uploads-2025-05-pricelist-pdf[^>]*/?>",
    re.I,
)

# Every body also carries the identical seven-figure gallery, so each article
# shows the same strip of pictures in the same order. That is a duplicate-
# content signal as much as a design problem. The strip is removed and a
# smaller, deterministic selection is inserted instead.
FIGURE_RUN = re.compile(
    r"(?:<a\b[^>]*>\s*<figure\b[^>]*>\s*<img\b[^>]*/?>\s*</figure>\s*</a>\s*)+",
    re.S,
)

CURATED_POOL = [
    "unit-3", "unit-4", "unit-5", "unit-6", "unit-7",
    "detail-3", "detail-5", "detail-7", "knowledge-1", "design-24",
]

CAPTIONS = {
    "unit-3": "Dapur dengan pintu langsung ke halaman belakang",
    "unit-4": "Carport beratap kisi dari dalam rumah",
    "unit-5": "Kamar kosong dengan jendela sudut",
    "unit-6": "Kamar dengan deret jendela tinggi",
    "unit-7": "Ruang dengan jendela clerestory menghadap luar",
    "detail-3": "Area cuci dengan pintu ke taman",
    "detail-5": "Lereng dan jalur tol di sekitar Padalarang",
    "detail-7": "Ruang terang dengan jendela tinggi",
    "knowledge-1": "Jalan masuk menuju kawasan Padalarang",
    # F6: a render is allowed but must say so, so the alt text carries the
    # label instead of relying on a chip that raw HTML cannot render.
    "design-24": "Ilustrasi tampak depan unit tipe 45/72 (render, bukan foto)",
}

# The tail 17 posts end with: a heading, a WhatsApp link, and the agency's
# advert graphic. The call to action belongs on the page; the advert does
# not. The whole tail is rewritten rather than deleted.
BOOKING_TAIL = re.compile(
    r"<h2>Booking\s+Hanya\s+5\s+Juta\s*</h2>\s*"
    r'<a href="https://wa\.link/[^"]*">Booking Sekarang</a>\s*'
    r'<a href="https://www\.beriklan\.co\.id/">.*?</a>',
    re.S,
)

BOOKING_TAIL_REPLACEMENT = (
    "<h2>Booking hanya Rp 5 juta</h2>\n"
    "<p>Booking fee Rp 5 juta bisa dicicil. "
    '<a href="https://wa.me/6281188010326" target="_blank" rel="noopener">'
    "Hubungi tim kami di WhatsApp 0811-8801-0326</a> — unit yang tersedia "
    "kami kabari setelah Anda menghubungi kami.</p>\n"
)

# --- Block splitting -------------------------------------------------------

# Containers whose closing tag ends a block.
BLOCK_TAGS = {
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "figure",
    "figcaption", "table", "div", "blockquote", "pre", "section", "article",
    "dl", "dt", "dd", "main", "header", "footer", "nav", "aside", "body",
}

# Elements that never hold a block boundary.
INLINE_TAGS = {
    "a", "strong", "em", "span", "b", "i", "br", "small", "u", "mark",
    "code", "sup", "sub", "abbr", "cite", "q", "time", "label", "picture",
    "source", "col",
}

VOID = {"img", "hr", "input", "meta", "link", "area", "base", "wbr", "colgroup"}

# Tags the corpus never closes, whether or not they are written self-closing.
# They are excluded from the balance assertion for that reason.
VOIDISH = VOID | {"br", "source", "col"}

TAG = re.compile(r"<(/?)([a-zA-Z0-9]+)([^>]*?)(/?)>")
IMG = re.compile(r"<img\b[^>]*>", re.I)


def split_blocks(text: str) -> list[str]:
    """Split an HTML body into its top-level blocks, keeping the text intact.

    Every block is returned verbatim, including its whitespace, so the body
    can be rebuilt by joining the survivors.
    """
    blocks: list[str] = []
    start = 0
    depth = 0
    i = 0
    n = len(text)

    while i < n:
        m = TAG.search(text, i)
        if not m:
            break
        closing, name, _attrs, selfclose = (
            m.group(1),
            m.group(2).lower(),
            m.group(3),
            m.group(4),
        )
        i = m.end()

        if name in VOID or selfclose:
            if depth == 0:
                # A standalone image at the top level is its own block.
                blocks.append(text[start:m.end()])
                start = m.end()
            continue

        if closing:
            if depth == 0:
                # A stray closing tag — the imported HTML has a few. Keep it
                # as its own block so nothing is lost.
                blocks.append(text[start:m.end()])
                start = m.end()
                continue
            depth -= 1
            if depth == 0 and name in BLOCK_TAGS:
                blocks.append(text[start:m.end()])
                start = m.end()
        else:
            depth += 1

    if text[start:].strip():
        blocks.append(text[start:])

    return blocks


def block_tag(block: str) -> str:
    m = TAG.search(block)
    if not m or m.group(1):
        return ""
    return m.group(2).lower()


def text_of(block: str) -> str:
    stripped = re.sub(r"<[^>]+>", " ", block)
    return re.sub(r"\s+", " ", stripped).strip()


def list_items(block: str) -> list[str]:
    return [text_of(li) for li in re.findall(r"<li\b[^>]*>(.*?)</li>", block, re.S)]


def classify(block: str) -> str:
    """Return the block's role: 'pitch', 'pitch-heading', 'pitch-list' or ''."""
    tag = block_tag(block)

    if AD_IMAGE.search(block):
        return "pitch"
    if AGENCY.search(block):
        return "pitch"

    if tag in ("ul", "ol"):
        items = list_items(block)
        if items and all(SERVICE.match(item) for item in items):
            return "pitch-list"
        return ""

    if tag in ("h2", "h3") and PROMO_INTENT.search(text_of(block)):
        return "pitch-heading"

    return ""


PITCH_KINDS = {"pitch", "pitch-heading", "pitch-list"}


def salvage_images(block: str) -> list[str]:
    """The real images inside a pitch block — the advert graphic is not one."""
    return [img for img in IMG.findall(block) if not AD_IMAGE.search(img)]


def pick_images(slug: str, count: int = 2) -> list[str]:
    """A stable pair of photos per post, so the corpus is not one repeated strip.

    The choice is a hash of the slug, which keeps the selection deterministic
    across runs without needing a hand-written map for 71 files.
    """
    h = sum(ord(c) for c in slug)
    picks = []
    i = 0
    while len(picks) < count:
        name = CURATED_POOL[(h + i * 7) % len(CURATED_POOL)]
        if name not in picks:
            picks.append(name)
        i += 1
    return picks


def figure_for(name: str) -> str:
    return (
        f'<figure><img src="/media/curated/{name}.webp" '
        f'alt="{CAPTIONS[name]}" loading="lazy" /></figure>'
    )


CURATED_NAME = re.compile(r'src="/media/curated/([a-z0-9-]+)\.webp"', re.I)


def clean_body(body: str, slug: str) -> tuple[str, list[str]]:
    """Remove the pitch sections. Returns the new body and what was removed."""
    removed: list[str] = []

    # The booking tail is rewritten, so it is lifted out before the split.
    tail = BOOKING_TAIL.search(body)
    if tail:
        removed.append("Booking Hanya 5 Juta → Booking hanya Rp 5 juta (rewritten)")
        body = body[: tail.start()] + BOOKING_TAIL_REPLACEMENT + body[tail.end():]

    # Any advert graphic that is still wrapped in its own anchor goes.
    body = AD_ANCHOR.sub("", body)

    # Links to the agency are unwrapped, not deleted, so no tag pair is lost.
    body, unwrapped = AGENCY_ANCHOR.subn(r"\2", body)
    if unwrapped:
        removed.append(f"{unwrapped} agency link(s) unwrapped to plain text")

    # The old family-photo poster that opens 30 bodies.
    body, posters = POSTER_IMG.subn("", body)
    if posters:
        removed.append(f"{posters} marketing poster image(s) removed")

    # The identical seven-figure strip in every body, replaced by two photos
    # chosen from the slug so the corpus stops repeating itself.
    def replace_run(match: re.Match) -> str:
        names = CURATED_NAME.findall(match.group(0))
        removed.append(
            f"{len(names)}-image repeated gallery strip replaced "
            f"({', '.join(names)}) → {', '.join(pick_images(slug))}"
        )
        return "\n".join(figure_for(n) for n in pick_images(slug)) + "\n"

    body = FIGURE_RUN.sub(replace_run, body)

    blocks = split_blocks(body)
    kinds = [classify(b) for b in blocks]

    # A maximal run of pitch blocks is one section: the heading, the intro
    # paragraph, the list of services and the closing paragraph.
    runs: list[tuple[int, int]] = []
    i = 0
    while i < len(blocks):
        if kinds[i] in PITCH_KINDS:
            j = i
            while j + 1 < len(blocks) and kinds[j + 1] in PITCH_KINDS:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1

    # Every block of a run is dropped, not just the first one — the earlier
    # version of this loop advanced by one block per run and so re-emitted the
    # rest of the section straight after it.
    dropped: set[int] = set()
    salvaged: dict[int, list[str]] = {}
    for start_block, end_block in runs:
        dropped.update(range(start_block, end_block + 1))
        gone_blocks = blocks[start_block:end_block + 1]
        for gone in gone_blocks:
            if text_of(gone):
                removed.append(text_of(gone))
            elif "<img" in gone:
                removed.append("[advert graphic]")
        # A legitimate image that happened to sit inside the pitch is kept,
        # and stays at the position the section occupied.
        salvaged[start_block] = [
            img for gone in gone_blocks for img in salvage_images(gone)
        ]

    keep: list[str] = []
    for idx, block in enumerate(blocks):
        if idx in dropped:
            keep.extend(salvaged.get(idx, []))
            continue
        keep.append(block)

    out = "".join(keep)

    # Tidy the gaps the removals leave behind.
    out = re.sub(r"\n{3,}", "\n\n", out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    # split_blocks drops a trailing whitespace-only tail; markdown files end
    # with a newline and dropping it is an unrelated change in the diff.
    if not out.endswith("\n"):
        out += "\n"
    return out, removed


def tag_pairs_balanced(text: str) -> list[str]:
    """Names of real container tags whose open/close counts disagree.

    The previous version of this tool corrupted the corpus by deleting an
    opening <a> and leaving its </a>. That is the one failure mode worth
    failing the run on, so it is checked instead of trusted.

    Tags with no closing form are left out of the count. The imported HTML
    writes them as `<br />`; counting them would flag every post as corrupt
    when nothing is.
    """
    bad = []
    for tag in sorted((BLOCK_TAGS | INLINE_TAGS) - VOIDISH):
        opens = len(re.findall(rf"<{tag}\b(?![^>]*/>)", text, re.I))
        closes = len(re.findall(rf"</{tag}>", text, re.I))
        if opens != closes:
            bad.append(f"<{tag}> {opens} open / {closes} close")
    return bad


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="show what would be removed")
    args = ap.parse_args()

    files = sorted(COLLECTION.glob("*.md"))
    total_removed = 0
    touched = 0
    failures: list[str] = []

    for path in files:
        text = path.read_text(encoding="utf-8")
        head, sep, body = text.partition("\n---\n")
        if not sep:
            continue

        new_body, removed = clean_body(body, path.stem)

        # Assertions, not guesses. The previous version of this tool "fixed"
        # leftovers by cutting sentences out of the markup and corrupted the
        # corpus. If a marker or an unbalanced tag survives, the run stops and
        # says which file — a human decides, the script does not improvise.
        leftover = AGENCY.search(new_body)
        if leftover:
            around = re.sub(r"\s+", " ", new_body[max(0, leftover.start() - 60):leftover.end() + 60])
            failures.append(f"{path.stem}: agency still named — …{around}…")
        unbalanced = tag_pairs_balanced(new_body)
        if unbalanced:
            failures.append(f"{path.stem}: {', '.join(unbalanced)}")

        if not removed:
            continue

        touched += 1
        total_removed += len(removed)

        if args.report:
            print(f"── {path.stem}  ({len(removed)} change(s))")
            for item in removed:
                print(f"     - {item[:150]}")
        else:
            path.write_text(head + sep + new_body, encoding="utf-8")

    verb = "would make" if args.report else "made"
    print(f"\nposts scanned  : {len(files)}")
    print(f"posts affected : {touched}")
    print(f"changes {verb}: {total_removed}")

    if failures:
        print(f"\nFAILED — {len(failures)} post(s) need a human decision:")
        for f in failures:
            print("  - " + f)
        raise SystemExit(1)
    print("\nno agency markers left, every tag pair balanced")


if __name__ == "__main__":
    main()
