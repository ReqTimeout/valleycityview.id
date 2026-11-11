#!/usr/bin/env python3
"""Check every local reference in the built site against the build output.

Walks site/dist/**/*.html, extracts src / href / srcset references and
verifies that each one resolves to a real file or directory index.

External URLs (http/https/protocol-relative), mailto:, tel:, data: URIs and
pure fragments are ignored — they are not our problem.

Usage:
    python3 tools/check_refs.py [--site site] [--limit 40]
"""

import os
import re
import sys
from collections import Counter, defaultdict
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RE_ATTR = re.compile(
    r'\b(?:src|href|poster|data-src)\s*=\s*"([^"]*)"', re.I)
RE_SRCSET = re.compile(r'\bsrcset\s*=\s*"([^"]*)"', re.I)

SKIP_PREFIX = ('http://', 'https://', '//', 'mailto:', 'tel:', 'sms:',
                'data:', 'javascript:', '#', 'about:')


def iter_html(dist):
    for base, _dirs, files in os.walk(dist):
        for name in files:
            if name.endswith('.html'):
                yield os.path.join(base, name)


def resolves(dist, url_path):
    """Does url_path exist in the build output?"""
    clean = unquote(url_path.split('#')[0].split('?')[0])
    if not clean:
        return True
    if clean.endswith('/'):
        return os.path.isfile(os.path.join(dist, clean.lstrip('/'), 'index.html'))
    target = os.path.join(dist, clean.lstrip('/'))
    if os.path.isfile(target):
        return True
    # Cloudflare Pages serves /foo as /foo/index.html
    return os.path.isfile(os.path.join(target, 'index.html'))


def main():
    site = 'site'
    limit = 40
    args = sys.argv[1:]
    if '--site' in args:
        site = args[args.index('--site') + 1]
    if '--limit' in args:
        limit = int(args[args.index('--limit') + 1])

    dist = os.path.join(ROOT, site, 'dist')
    if not os.path.isdir(dist):
        print('no build output at', dist)
        return 1

    missing = defaultdict(list)
    counts = Counter()
    pages = 0

    for html_path in iter_html(dist):
        pages += 1
        with open(html_path, encoding='utf-8', errors='replace') as fh:
            raw = fh.read()
        rel = os.path.relpath(html_path, dist)

        refs = list(RE_ATTR.findall(raw))
        for group in RE_SRCSET.findall(raw):
            refs += [part.strip().split(' ')[0]
                     for part in group.split(',') if part.strip()]

        for url in refs:
            url = url.strip()
            if not url or url.startswith(SKIP_PREFIX):
                continue
            counts['refs'] += 1
            path = urlsplit(url).path
            if not path.startswith('/'):
                continue  # relative — resolved by the browser
            if not resolves(dist, path):
                kind = 'img' if '/media/' in path else 'link'
                missing[(kind, path)].append(rel)

    print('pages checked      : %d' % pages)
    print('references checked : %d' % counts['refs'])

    if not missing:
        print('\nOK — every local reference resolves.')
        return 0

    total = sum(len(v) for v in missing.values())
    print('\nMISSING: %d broken references (%d unique paths)'
          % (total, len(missing)))
    for (kind, path), pages_seen in sorted(missing.items(),
                                          key=lambda kv: -len(kv[1])):
        sample = pages_seen[0] if len(pages_seen) == 1 else (
            '%s (+%d more)' % (pages_seen[0], len(pages_seen) - 1))
        print('  [%s] %-70s %s' % (kind, path[:70], sample))
    return 1


if __name__ == '__main__':
    sys.exit(main())
