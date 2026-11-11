"""Move the <Picture> image rules out of scoped styles into global CSS.

Astro scopes a component's styles with a `data-astro-cid-*` attribute on the
elements that component renders. A child component's root element does NOT
inherit the parent's scope, so a rule like

    .brand__logo { height: 34px }

inside Header.astro never matches the <img> that Picture.astro renders —
the logo falls back to its intrinsic 425x213 px.

This script strips those rules from the parent files; the canonical copy
lives in site/src/styles/media.css, which is a global stylesheet.
"""

import os
import re

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'site', 'src')

# Selectors that target an element rendered by <Picture>.
TARGETS = [
    'site-footer__logo', 'brand__logo', 'landing__logo-img', 'hero__img',
    'about__img', 'unit__plan-img', 'agent-hero__img', 'alt-hero__img',
    'featured__img', 'post-card__img', 'article__cover-img', 'kpr-hero__img',
    'nup__img', 'sale__img',
]

FILES = [
    'components/Footer.astro', 'components/Header.astro', 'layouts/Landing.astro',
    'pages/index.astro', 'pages/agent/index.astro', 'pages/agent/alt.astro',
    'pages/blog/index.astro', 'pages/blog/[slug].astro',
    'pages/simulasi-kpr.astro', 'pages/nup.astro', 'pages/sale.astro',
]


def split_top_level(css):
    """Yield (head, body) for each top-level rule and each at-rule block."""
    out = []
    depth = 0
    start = 0
    for i, ch in enumerate(css):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                out.append(css[start:i + 1])
                start = i + 1
    if css[start:].strip():
        out.append(css[start:])
    return out


def targets_selector(sel):
    for t in TARGETS:
        if re.search(r'\.' + re.escape(t) + r'\b', sel):
            return True
    return False


total = 0
for path in FILES:
    full = os.path.join(BASE, path)
    src = open(full, encoding='utf-8').read()
    m = re.search(r'(<style>)(.*?)(</style>)', src, re.S)
    if not m:
        continue

    css = m.group(2)
    keep = []
    removed = []
    for block in split_top_level(css):
        head = block.split('{', 1)[0].strip()
        if head.startswith('@'):
            # media query — recurse into it
            inner = block[block.index('{') + 1:block.rindex('}')]
            kept_inner = []
            for sub in split_top_level(inner):
                sub_head = sub.split('{', 1)[0].strip()
                if targets_selector(sub_head):
                    removed.append(head + ' { ' + ' '.join(sub.split()) + ' }')
                else:
                    kept_inner.append(sub)
            if kept_inner:
                keep.append(head + ' {\n' + '\n'.join(kept_inner) + '\n}')
            continue
        if targets_selector(head):
            removed.append(' '.join(block.split()))
        else:
            keep.append(block)

    if not removed:
        continue

    new_css = '\n' + '\n'.join(keep) + '\n'
    src = src[:m.start(2)] + new_css + src[m.end(2):]
    open(full, 'w', encoding='utf-8').write(src)
    total += len(removed)
    print('%-42s removed %d rule(s)' % (path, len(removed)))
    for r in removed:
        print('    -', r[:110])

print('\ntotal rules moved:', total)