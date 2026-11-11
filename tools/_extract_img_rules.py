import os
import re
import sys

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'site', 'src')

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


def rules(css):
    """Yield (selector, body) for every simple rule, keeping at-rule context."""
    depth = 0
    buf = ''
    for ch in css:
        buf += ch
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                head, _, body = buf.partition('{')
                yield head.strip(), ' '.join(body[:-1].split())
                buf = ''
            elif depth == 1 and buf.strip().startswith('@'):
                head, _, body = buf.partition('{')
                for sel, b in rules(body):
                    yield head.strip() + ' { ' + sel, b
                buf = ''
                depth = 0
                # the outer '}' was consumed above; keep scanning
                buf = ''


for path in FILES:
    src = open(os.path.join(BASE, path), encoding='utf-8').read()
    m = re.search(r'<style>(.*?)</style>', src, re.S)
    if not m:
        continue
    print('###', path)
    for sel, body in rules(m.group(1)):
        for t in TARGETS:
            if re.search(r'\.' + re.escape(t) + r'\b', sel):
                print('  %-44s { %s }' % (sel, body))
                break