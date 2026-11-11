#!/usr/bin/env python3
"""Copy QA for the Indonesian site copy.

Scans .astro / .svelte sources for the kinds of defects that creep into
Indonesian marketing copy:

  * stray CJK / Cyrillic / Arabic characters
  * English words left over from a translation
  * two Indonesian words glued together ("danunitlangsung")
  * underscore leftovers from a template
  * doubled spaces, space before punctuation, missing space after a comma

Run:  python3 tools/check_copy.py
Exit code 1 when something is found.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
SRC = os.path.join(SITE, 'src')

# English words that must not survive in Indonesian user-facing copy.
ENGLISH = [
    'available', 'contacted', 'regarding', 'illustration', 'hesitation',
    'compared', 'surroundings', 'stubbornly', 'actually', 'the', 'and',
    'with', 'from', 'this', 'that', 'your', 'our', 'you', 'home', 'unit',
    'booking', 'price', 'check', 'view', 'details', 'read', 'more', 'about',
    'contact', 'explore', 'scroll', 'down', 'homepage', 'click', 'here',
    'learn', 'start', 'now', 'get', 'quote', 'agent', 'terms', 'privacy',
    'policy', 'blog', 'location', 'tour', 'schedule', 'call', 'email',
    # loanwords that must not survive in Indonesian sales copy
    'hustle', 'loads', 'brings', 'join', 'signup', 'submit', 'online',
    'offline', 'upgrade', 'customer', 'business', 'quality', 'discount',
    'free', 'cheap', 'budget', 'priority', 'premium', 'luxury', 'staff',
    'partner', 'leader', 'team', 'workflow', 'milestone', 'onboarding',
]

# Technical / brand terms that are legitimate in the copy.
ALLOWED = {
    'kpr', 'dp', 'km', 'm2', 'lt', 'pt', 'cv', 'tba', 'wa', 'wa',
    'unit', 'units', 'booking', 'agent', 'agents', 'blog', 'privacy',
    'policy', 'check', 'view', 'price', 'location', 'explore', 'contact',
    'home', 'details', 'scroll', 'email', 'whatsapp', 'instagram',
    'facebook', 'tiktok', 'valley', 'cityview', 'padalarang', 'cimahi',
    'bandung', 'laksanamekar', 'kcic', 'rs', 'dustira', 'unjani',
    'baros', 'annuity', 'meter', 'lt', 'dp', 'kpr', 'pdf', 'webp', 'svg',
}

GLUED = re.compile(
    r'\b(?:dan|pada|yang|untuk|dengan|dari|ini|itu|sudah|kami|'
    r'anda|adalah|harga|rumah|tanpa|bisa|tidak|hanya|semua|lebih|'
    r'harus|agar|supaya|karena|tetapi|akan|telah|banyak|masih|'
    r'sangat|cukup|segera|sekarang|langsung|memiliki|membuat)'
    r'[a-z]{3,}\b')

# Legitimate Indonesian words that happen to start with one of the prefixes.
GLUED_OK = {
    'banyaknya',
    'biasanya',
    'cukupnya',
    'dananya',
    'dinilai',
    'harganya',
    'inilah',
    'itulah',
    'kampusnya',
    'keduanya',
    'langsungnya',
    'masihnya',
    'padahal',
    'padalarang',
    'padatnya',
    'rumahnya',
    'sebagainya',
    'sekarangnya',
    'seluruhnya',
    'semuanya',
    'seorang',
    'tidaknya',
    'untuknya',
    'untungnya',
    'yangnya',
}

FOREIGN_CHARS = re.compile(r'[\u0400-\u04FF\u0600-\u06FF\u3000-\u9FFF\uFF00-\uFFEF]')
UNDERSCORE = re.compile(r'\b[a-z]+_[a-z_]+\b')
DOUBLE_SPACE = re.compile(r'[^\s<>"] {2,}[^\s<>"]')
SPACE_BEFORE_PUNCT = re.compile(r'\s+[,.;:!?]')
NO_SPACE_COMMA = re.compile(r'[a-z],[A-Za-z]')
# A lowercase run glued to a capital ("perluRp", "diNbagi") — always a typo.
CAMEL_GLUE = re.compile(r'\b[a-z]{3,}[A-Z][a-z]+')


def strip_code(source: str) -> str:
    """Remove code so we only lint human-facing copy."""
    # Frontmatter
    source = re.sub(r'^---\n.*?\n---', '', source, flags=re.S)
    # <style> blocks
    source = re.sub(r'<style>.*?</style>', '', source, flags=re.S)
    # <script> blocks
    source = re.sub(r'<script.*?</script>', '', source, flags=re.S)
    # HTML tags but keep the text between them
    source = re.sub(r'<[^>]+>', '\n', source)
    # Interpolations become a placeholder word so spacing stays meaningful
    source = re.sub(r'\{[^}]*\}', 'x', source)
    # Collapse the blank lines the tag stripping leaves behind
    source = re.sub(r'[ \t]{2,}', ' ', source)
    return source


def lint_file(path: str, strict_english: bool = True) -> list[str]:
    raw = open(path, encoding='utf-8').read()
    text = strip_code(raw)
    lines = text.split('\n')
    issues = []

    for number, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('//') or stripped.startswith('*'):
            continue

        for match in FOREIGN_CHARS.finditer(line):
            issues.append((number, 'foreign-script', match.group(0),
                           stripped[:90]))

        for match in UNDERSCORE.finditer(line):
            if match.group(0) in ALLOWED:
                continue
            issues.append((number, 'underscore', match.group(0),
                           stripped[:90]))

        for match in GLUED.finditer(line):
            word = match.group(0)
            if word.lower() in ALLOWED or word.lower() in GLUED_OK:
                continue
            issues.append((number, 'glued-words', word, stripped[:90]))

        for word in ENGLISH:
            if not strict_english:
                break
            for match in re.finditer(r'\b' + re.escape(word) + r'\b', line):
                if match.group(0).lower() in ALLOWED:
                    continue
                if match.group(0)[0].isupper():
                    continue  # proper nouns / brand names
                issues.append((number, 'english-word', match.group(0),
                               stripped[:90]))
                break

        if DOUBLE_SPACE.search(line):
            issues.append((number, 'double-space', '  ', stripped[:90]))
        if SPACE_BEFORE_PUNCT.search(line):
            issues.append((number, 'space-before-punct', ' ', stripped[:90]))
        if NO_SPACE_COMMA.search(line):
            issues.append((number, 'no-space-after-comma', ',', stripped[:90]))
        for match in CAMEL_GLUE.finditer(line):
            issues.append((number, 'camel-glue', match.group(0), stripped[:90]))

    return issues


def main() -> int:
    targets = []
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith(('.astro', '.svelte')):
                targets.append((os.path.join(base, name), True))

    # The imported WordPress copy is checked for structural defects only —
    # it legitimately contains English brand terms, so the English-word rule
    # does not apply there.
    collections = os.path.join(SRC, 'collections')
    for base, _dirs, files in os.walk(collections):
        for name in files:
            if name.endswith('.md'):
                targets.append((os.path.join(base, name), False))

    total = 0
    for path, strict in sorted(targets):
        issues = lint_file(path, strict_english=strict)
        if not issues:
            continue
        rel = os.path.relpath(path, ROOT)
        print('\n%s' % rel)
        seen = set()
        for number, kind, token, context in issues:
            key = (kind, token, context)
            if key in seen:
                continue
            seen.add(key)
            print('  L%-5d %-22s %-18s | %s' % (number, kind, token[:18],
                                               context))
            total += 1

    print('\n%d issue(s) across %d file(s)' % (total, len(targets)))
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main())
