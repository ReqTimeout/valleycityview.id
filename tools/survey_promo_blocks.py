#!/usr/bin/env python3
"""Survey every block that carries the third-party advertising pitch.

The pitch survives in more than one shape, so before changing anything we
need to know how many shapes exist. This prints each distinct shape, how many
posts it appears in, and one example.

    python3 tools/survey_promo_blocks.py
"""

from __future__ import annotations

import collections
import pathlib
import re

COLLECTION = pathlib.Path("site/src/collections/blog")

MARKERS = re.compile(
    r"beriklan|jasa\s+iklan|jasa\s+digital\s+marketing|iklan\s+google|iklan\s+facebook"
    r"|iklan\s+instagram|iklan\s+tiktok|iklan\s+tiktok",
    re.I,
)

# Split the body into top-level blocks: a heading, a paragraph, a list, a
# figure, a table, or a div.
BLOCK = re.compile(
    r"<h[1-6][^>]*>.*?</h[1-6]>"
    r"|<p\b[^>]*>.*?</p>"
    r"|<ul\b[^>]*>.*?</ul>"
    r"|<ol\b[^>]*>.*?</ol>"
    r"|<figure\b[^>]*>.*?</figure>"
    r"|<table\b[^>]*>.*?</table>"
    r"|<div\b[^>]*>.*?</div>",
    re.S,
)


def signature(block: str) -> str:
    """A shape fingerprint: the tag sequence, with the text collapsed."""
    tags = re.findall(r"<(h[1-6]|p|ul|ol|figure|table|div|li|a|strong|em)\b", block)
    return "+".join(tags)


def main() -> None:
    shapes: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)

    for path in sorted(COLLECTION.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        _, _, body = text.partition("\n---\n")
        for block in BLOCK.findall(body):
            if MARKERS.search(block):
                shapes[signature(block)].append((path.stem, block))

    print(f"posts scanned : {len(list(COLLECTION.glob('*.md')))}")
    print(f"distinct shapes: {len(shapes)}\n")

    for sig, entries in sorted(shapes.items(), key=lambda kv: -len(kv[1])):
        posts = {slug for slug, _ in entries}
        print(f"── {len(entries)} block(s) in {len(posts)} post(s)")
        print(f"   shape: {sig}")
        slug, example = entries[0]
        flat = re.sub(r"\s+", " ", example).strip()
        print(f"   e.g. {slug}: {flat[:220]}")
        print()


if __name__ == "__main__":
    main()
