#!/usr/bin/env python3
"""Export the WordPress backup into Astro content collections.

Reads the mysqldump + uploads tree and writes:
  site/src/collections/blog/*.md      71 published posts
  site/src/collections/pages/*.md     privacy, thank-you
  memory/legacy-landings/*.html      6 legacy landing pages (reference)
  site/src/data/media-needed.json   list of source images to optimise
  site/src/data/redirects.json      old WP URL -> new URL
  memory/02-content-map.md          human-readable migration map
"""

import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wp_html
from wp_sql import index_meta, load_all

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
CONTENT = os.path.join(SITE, 'src', 'collections')
DATA = os.path.join(SITE, 'src', 'data')
MEMORY = os.path.join(ROOT, 'memory')

DUMP = os.path.join(ROOT, 'u303432922_VOIEj.20261109135002.sql.gz')
UPLOADS = os.path.join(ROOT, 'domains', 'valleycity.id', 'public_html',
                       'wp-content', 'uploads')

FORM_MARKER = '<!--FORM:BOOKING-->'

# Real project assets that the WordPress build never linked from a post
# (the homepage was Elementor, and the floor plans / price list were orphans).
# Source path is relative to the uploads directory; dest is a stable, semantic
# path the new components reference.
CURATED_MEDIA = {
    '2025/09/6.png': 'hero',
    '2025/09/10.png': 'hero-2',
    '2025/09/11.png': 'hero-3',
    '2025/09/Gemini_Generated_Image_br0ilubr0ilubr0i.png': 'render',
    '2025/09/Gemini_Generated_Image_31hzb231hzb231hz.png': 'render-2',
    '2025/09/Product-Knowledge-Valley-CItyview-4.png': 'knowledge-1',
    '2025/09/Product-Knowledge-Valley-CItyview-5.png': 'knowledge-2',
    '2025/09/Product-Knowledge-Valley-CItyview-6.png': 'knowledge-3',
    '2025/09/Product-Knowledge-Valley-CItyview-7.png': 'knowledge-4',
    '2025/09/Whisk_eb7ec0ae95-Copy.png': 'whisk-1',
    '2025/09/Whisk_eb7ec0ae95-Copy-1.png': 'whisk-2',
    '2025/05/Denah-Tipe-45-72.png': 'denah-1',
    '2025/05/Denah-Tipe-45-72-1.png': 'denah-2',
    '2025/05/1.png': 'unit-1',
    '2025/05/2.png': 'unit-2',
    '2025/05/3.png': 'unit-3',
    '2025/05/4.png': 'unit-4',
    '2025/05/5.png': 'unit-5',
    '2025/05/6.png': 'unit-6',
    '2025/05/7.png': 'unit-7',
    '2025/05/1-1.png': 'detail-5',
    '2025/05/2-2.png': 'detail-6',
    '2025/05/2-3.png': 'detail-7',
    '2025/05/1-3.png': 'detail-1',
    '2025/05/2-5.png': 'detail-2',
    '2025/05/3-2.png': 'detail-3',
    '2025/05/2-1.png': 'detail-4',
    '2025/05/1-2.png': 'icon-booking',
    '2025/05/2-4.png': 'icon-view',
    '2025/05/3-1.png': 'icon-flood',
    '2025/05/rategist-location.png': 'icon-kcic',
    '2025/05/rategist-location-2.png': 'icon-location',
    '2025/05/Pricelist-PDF.jpg': 'pricelist',
    '2025/04/Untitled-design-16.png': 'logo',
    '2025/05/Untitled-design-26.png': 'logo-footer',
    '2025/04/Hero-1.png': 'hero-alt',
    '2025/04/Home-Green.png': 'home-green',
    '2025/04/6-Home-Inspection-1.png': 'inspection',
    '2025/04/Logo-1.png': 'logo-alt',
    '2025/05/Untitled-design-24.png': 'design-24',
    '2025/05/Untitled-design-25.png': 'design-25',
    '2025/08/Untitled-design-45.png': 'design-45',
}

# Old WP URL prefix -> new path
WP_HOME = 'http://valleycity.id'

# Blog card covers.
#
# Every one of the 71 WordPress posts used the same featured image (the
# "Responsive Ads" banner or the price-list graphic), so the old blog index
# looked like a wall of adverts. Instead we rotate a curated set of real
# project photography — the actual unit, the actual site from the air, the
# internal road — plus a few renders, picked deterministically from the slug
# so a post always keeps the same cover.
COVER_POOL = [
    '/media/curated/detail-1.webp',    # real unit exterior at dusk
    '/media/curated/detail-5.webp',    # real aerial of the site + toll road
    '/media/curated/knowledge-1.webp',  # real internal road with the flags
    '/media/curated/render.webp',      # panorama lembah from the balcony
    '/media/curated/hero.webp',        # living room with the valley
    '/media/curated/hero-2.webp',      # bedroom facing the garden
    '/media/curated/unit-3.webp',      # real kitchen & dining
    '/media/curated/unit-4.webp',      # real bathroom
]

PAGE_SLUGS = {
    '81': 'privacy',
    '1104': 'thank-you',
}

# Landing page source file -> new path + front matter
LANDINGS = [
    ('promo.html', 'simulasi-kpr', 'Simulasi KPR Valley Cityview',
     'Hitung cicilan KPR Valley Cityview tipe 45/72 di Padalarang, Cimahi.'),
    ('nup.html', 'nup', 'Booking Unit Valley Cityview',
     'Amankan unit Valley Cityview hanya dengan booking fee Rp 5 juta.'),
    ('sale.html', 'sale', 'Unit Valley Cityview Harga Terjangkau',
     'Unit Valley Cityview tipe 45/72 m2 di Laksanamekar, Padalarang.'),
    ('agent.html', 'agent', 'Jadi Agen Properti Valley Cityview',
     'Bergabung sebagai agen properti Valley Cityview. Gratis, tanpa modal, komisi Attraktif.'),
    ('skagent.html', 'agent/terms', 'Syarat & Ketentuan Agen Valley Cityview',
     'Syarat, ketentuan, dan alur kerja sama dengan Agen Properti Valley Cityview.'),
    ('agentvalley.html', 'agent/alt', 'Program Agen Properti Valley Cityview',
     'Program kemitraan agen properti Valley Cityview di Padalarang, Cimahi.'),
]


def ensure_dirs():
    for path in (CONTENT, DATA, MEMORY,
                 os.path.join(CONTENT, 'blog'),
                 os.path.join(MEMORY, 'legacy-pages')):
        os.makedirs(path, exist_ok=True)


def slugify(text):
    text = (text or '').lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return re.sub(r'-{2,}', '-', text).strip('-')


def collect_upload_urls(posts, meta):
    """Every /wp-content/uploads/... path referenced anywhere in content."""
    urls = set()
    pattern = re.compile(
        r'(?:https?://valleycity\.id)?(/wp-content/uploads/[^"\'\s\)\\]+)')
    for post in posts:
        for field in ('post_content', 'post_excerpt'):
            for match in pattern.finditer(post.get(field) or ''):
                urls.add(match.group(1))
    for row in meta:
        value = row.get('meta_value') or ''
        if 'uploads' not in value:
            continue
        for match in pattern.finditer(value):
            urls.add(match.group(1))
    return sorted(urls)


def attachment_map(posts, meta):
    """attachment id -> {file, title, alt, url}"""
    by_id = {p['ID']: p for p in posts if p['post_type'] == 'attachment'}
    out = {}
    for aid, post in by_id.items():
        attached = meta.get(aid, {}).get('_wp_attached_file')
        if not attached:
            continue
        out[aid] = {
            'file': '/wp-content/uploads/' + attached.lstrip('/'),
            'title': post.get('post_title') or '',
            'alt': meta.get(aid, {}).get('_wp_attachment_image_alt', ''),
            'url': WP_HOME + '/wp-content/uploads/' + attached.lstrip('/'),
        }
    return out


def resolve_media(upload_path, media_map):
    """Map an old upload path to its new /media/... path (if optimised)."""
    if not media_map:
        return None
    return media_map.get(upload_path)


def build_media_map(upload_paths):
    """upload path -> stable local name (hash-free, readable)."""
    mapping = {}
    for path in upload_paths:
        name = os.path.basename(path)
        stem, _ext = os.path.splitext(name)
        folder = re.sub(r'[^a-z0-9]+', '-', path.lower()).strip('-')[:60]
        mapping[path] = '/media/%s/%s.webp' % (folder, slugify(stem))
    return mapping


def load_source_map():
    """Destination path -> optimised entry {src, srcset, width, height, oldPath}.

    Produced by site/scripts/optimize-media.mjs. When it is missing (first
    run, before media has been optimised) we fall back to the bare path.
    """
    path = os.path.join(DATA, 'media-source-map.json')
    if not os.path.isfile(path):
        return {}
    with open(path) as fh:
        return json.load(fh)


def load_manifest():
    """Destination path -> optimised entry (the runtime lookup table)."""
    path = os.path.join(DATA, 'media-manifest.json')
    if not os.path.isfile(path):
        return {}
    with open(path) as fh:
        return json.load(fh)


# Old WordPress URLs that had no post but still live inside post bodies.
STATIC_LINK_MAP = {
    '/': '/',
    '/index.php': '/',
    '/blog': '/blog/',
    '/blog/': '/blog/',
    '/blog.html': '/blog/',
    '/valley-city.html': '/',
    '/valley-city/': '/',
    '/kebijakan-privasi.html': '/privacy/',
    '/kebijakan-privasi/': '/privacy/',
    '/privacy-policy.html': '/privacy/',
    '/terimakasih.html': '/thank-you/',
    '/thank-you.html': '/thank-you/',
    '/promo.html': '/simulasi-kpr/',
    '/promo/': '/simulasi-kpr/',
    '/nup.html': '/nup/',
    '/nup/': '/nup/',
    '/sale.html': '/sale/',
    '/sale/': '/sale/',
    '/agent.html': '/agent/',
    '/agent/': '/agent/',
    '/skagent.html': '/agent/terms/',
    '/skagent/': '/agent/terms/',
    '/agentvalley.html': '/agent/alt/',
    '/agentvalley/': '/agent/alt/',
    '/simulasi-kpr.html': '/simulasi-kpr/',
    '/simulasi-kpr/': '/simulasi-kpr/',
    # There was never a /contact page — the enquiry form lives on the
    # homepage, so send "Hubungi kami" links there.
    '/contact/': '/#booking',
    '/contact.html': '/#booking',
    # A promotional banner linked to a post that no longer exists in WordPress.
    '/perumahan-podomoro-bandung-mana-yang-lebih-cocok-untuk-anda.html': '/',
}


def main():
    ensure_dirs()
    scan_only = '--scan-only' in sys.argv[1:]
    print('reading dump …')
    data = load_all(DUMP)
    posts = data['posts']
    meta = index_meta(data['postmeta'])
    print('  posts=%d  meta-ids=%d' % (len(posts), len(meta)))

    published = [p for p in posts if p['post_status'] == 'publish']

    # ---- media -------------------------------------------------------------
    upload_paths = collect_upload_urls(posts, list(data['postmeta']))
    auto_map = build_media_map(upload_paths)
    atts = attachment_map(posts, meta)

    needed = []
    seen = set()
    for path in upload_paths:
        src = os.path.join(UPLOADS, path.replace('/wp-content/uploads/', ''))
        if src in seen:
            continue
        if os.path.isfile(src):
            seen.add(src)
            needed.append({
                'src': os.path.relpath(src, ROOT),
                'dest': auto_map[path],
                'bytes': os.path.getsize(src),
            })

    # Curated project assets — stable semantic destinations.
    curated_map = {}
    for rel, name in CURATED_MEDIA.items():
        src = os.path.join(UPLOADS, rel)
        if not os.path.isfile(src):
            print('  ! curated source missing:', rel)
            continue
        dest = '/media/curated/%s.webp' % name
        curated_map['/wp-content/uploads/' + rel] = dest
        # Always emit the curated entry — the same source may already be in
        # `needed` under its auto-generated path, and we want both.
        needed.append({
            'src': os.path.relpath(src, ROOT),
            'dest': dest,
            'bytes': os.path.getsize(src),
        })
    with open(os.path.join(DATA, 'curated-media.json'), 'w') as fh:
        json.dump(curated_map, fh, indent=1)
    with open(os.path.join(DATA, 'media-needed.json'), 'w') as fh:
        json.dump(needed, fh, indent=1)
    print('  media referenced: %d  (files found on disk: %d)'
          % (len(upload_paths), len(needed)))

    if scan_only:
        print('\nscan complete. Next: cd site && npm run media')
        return

    # Resolve every old upload path to a file that really exists. The
    # optimiser writes one file per responsive width, so the destination
    # ("/media/x/y.webp") is the canonical reference and the manifest tells
    # us its width/height for the responsive attributes.
    manifest = load_manifest()
    source_map = load_source_map()
    media_map = {}
    for old_path in upload_paths:
        dest = curated_map.get(old_path) or auto_map.get(old_path)
        if not dest:
            continue
        entry = manifest.get(dest) or source_map.get(dest) or {}
        media_map[old_path] = entry.get('src') or dest
    # Curated assets are referenced by their semantic key in the components.
    for old_path, dest in curated_map.items():
        entry = manifest.get(dest) or source_map.get(dest) or {}
        media_map[old_path] = entry.get('src') or dest

    # ---- blog --------------------------------------------------------------
    blog_posts = [p for p in published
                  if p['post_type'] == 'post' and p['post_status'] == 'publish']
    blog_posts.sort(key=lambda p: p['post_date'])

    # Internal links inside the post bodies still point at the old WordPress
    # permalink shape. Map them onto the new /blog/<slug>/ routes.
    known_slugs = {p['post_name'] for p in blog_posts if p['post_name']}
    link_map = dict(STATIC_LINK_MAP)
    for slug in known_slugs:
        link_map['/%s.html' % slug] = '/blog/%s/' % slug
        link_map['/%s/' % slug] = '/blog/%s/' % slug
        link_map['/%s' % slug] = '/blog/%s/' % slug

    redirects = {}
    blog_index = []

    for post in blog_posts:
        title = post['post_title'] or ''
        slug = post['post_name'] or slugify(title)
        legacy = '/%s.html' % slug
        new = '/blog/%s/' % slug
        redirects[legacy] = new
        body = wp_html.clean_content(
            post['post_content'] or '',
            media_map=media_map, title=title, form_marker=FORM_MARKER,
            self_paths=[legacy, '/%s/' % slug, '/blog/%s/' % slug])
        body = wp_html.rewrite_links(body, link_map)
        excerpt = wp_html.text_only(post['post_excerpt'] or '')
        if not excerpt:
            excerpt = wp_html.first_paragraph(body)
        description = wp_html.first_paragraph(body) if not excerpt else excerpt
        description = description[:160].rstrip(' ,.;:')

        # The WordPress featured image was the same banner on every post, so
        # the cover comes from the curated pool instead.
        cover = COVER_POOL[
            int(hashlib.md5(slug.encode()).hexdigest(), 16) % len(COVER_POOL)
        ]

        legacy = '/%s.html' % slug
        new = '/blog/%s/' % slug
        redirects[legacy] = new

        fm = [
            '---',
            'title: %s' % wp_html.yaml_escape(title),
            'slug: %s' % wp_html.yaml_escape(slug),
            'description: %s' % wp_html.yaml_escape(description),
            'date: %s' % wp_html.yaml_escape(post['post_date'][:10]),
            'updated: %s' % wp_html.yaml_escape(post['post_modified'][:10]),
            'author: %s' % wp_html.yaml_escape('Tim Valley Cityview'),
            'legacyUrl: %s' % wp_html.yaml_escape(legacy),
            'wpId: %s' % post['ID'],
            'status: publish',
        ]
        if cover:
            fm.append('cover: %s' % wp_html.yaml_escape(cover))
        fm.append('---')

        path = os.path.join(CONTENT, 'blog', '%s.md' % slug)
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(fm) + '\n\n' + body + '\n')

        blog_index.append({
            'title': title, 'slug': slug, 'date': post['post_date'][:10],
            'description': description, 'legacyUrl': legacy, 'newUrl': new,
            'wpId': post['ID'], 'cover': cover,
            'words': len(wp_html.text_only(body).split()),
        })

    print('  blog posts written: %d' % len(blog_index))

    # ---- pages -------------------------------------------------------------
    page_meta = {
        'privacy': {
            'title': 'Kebijakan Privasi Valley Cityview',
            'description': 'Kebijakan privasi Valley Cityview — cara kami '
                           'mengumpulkan dan memakai data Anda.',
        },
        'thank-you': {
            'title': 'Terima Kasih Telah Booking',
            'description': 'Booking unit Valley Cityview Anda sudah kami terima. '
                           'Tim kami akan menghubungi Anda dalam 1x24 jam.',
        },
    }
    for pid, slug in PAGE_SLUGS.items():
        post = next((p for p in posts if p['ID'] == pid), None)
        if not post:
            continue
        body = wp_html.clean_content(
            post['post_content'] or '', media_map=media_map,
            title=post['post_title'], form_marker=FORM_MARKER)
        body = wp_html.rewrite_links(body, link_map)
        info = page_meta[slug]
        fm = [
            '---',
            'title: %s' % wp_html.yaml_escape(info['title']),
            'slug: %s' % slug,
            'description: %s' % wp_html.yaml_escape(info['description']),
            'legacyUrl: %s' % wp_html.yaml_escape('/%s/' % (post['post_name'] or slug)),
            'wpId: %s' % pid,
            '---',
        ]
        with open(os.path.join(MEMORY, 'legacy-pages', '%s.md' % slug), 'w',
                  encoding='utf-8') as fh:
            fh.write('\n'.join(fm) + '\n\n' + body + '\n')
        redirects['/%s/' % (post['post_name'] or slug)] = '/%s/' % slug
    print('  pages archived (superseded by hand-written pages): %d'
          % len(PAGE_SLUGS))

    # ---- landings ----------------------------------------------------------
    legacy_dir = os.path.join(ROOT, 'domains', 'valleycity.id', 'public_html')
    legacy_landing_dir = os.path.join(MEMORY, 'legacy-landings')
    os.makedirs(legacy_landing_dir, exist_ok=True)
    for filename, slug, title, description in LANDINGS:
        src = os.path.join(legacy_dir, filename)
        if not os.path.isfile(src):
            print('  ! missing landing source:', filename)
            continue
        with open(src, encoding='utf-8', errors='replace') as fh:
            raw = fh.read()
        body = wp_html.strip_elements(raw)
        body = wp_html.absolute_to_local(body)
        body = wp_html.normalise_whitespace(body)
        fm = [
            '---',
            'title: %s' % wp_html.yaml_escape(title),
            'slug: %s' % slug,
            'description: %s' % wp_html.yaml_escape(description),
            'legacyUrl: %s' % wp_html.yaml_escape('/%s' % filename),
            'noindex: true',
            '---',
        ]
        target = os.path.join(MEMORY, 'legacy-landings',
                               filename)
        with open(target, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(fm) + '\n\n' + body + '\n')
        redirects['/%s' % filename] = '/%s/' % slug
    print('  landings written: %d' % len(LANDINGS))

    # ---- redirects + blog index -------------------------------------------
    with open(os.path.join(DATA, 'redirects.json'), 'w') as fh:
        json.dump(redirects, fh, indent=1, sort_keys=True)
    with open(os.path.join(DATA, 'blog-index.json'), 'w') as fh:
        json.dump(blog_index, fh, indent=1, ensure_ascii=False)

    write_content_map(blog_index, redirects, media_map, needed)
    print('done.')


def write_content_map(blog_index, redirects, media_map, needed):
    lines = []
    lines.append('# Content Map — WordPress → Astro\n')
    lines.append('Generated by `tools/export_content.py`. '
                 'Regenerate after any re-export.\n')

    lines.append('\n## Totals\n')
    lines.append('| Metric | Count |')
    lines.append('|---|---|')
    lines.append('| Blog posts migrated | %d |' % len(blog_index))
    lines.append('| Pages migrated | 2 (privacy, thank-you) |')
    lines.append('| Landing pages migrated | %d |' % len(LANDINGS))
    lines.append('| Redirects generated | %d |' % len(redirects))
    lines.append('| Images to optimise | %d (%.1f MB source) |'
                 % (len(needed), sum(i['bytes'] for i in needed) / 1048576))

    lines.append('\n## URL map\n')
    lines.append('| Old (WP) | New (Astro) |')
    lines.append('|---|---|')
    lines.append('| `/` | `/` |')
    lines.append('| `/valley-city.html` or `/` (page 83) | `/` |')
    lines.append('| `/blog.html` | `/blog/` |')
    lines.append('| `/kebijakan-privasi.html` | `/privacy/` |')
    lines.append('| `/ter devriez.html` | `/thank-you/` |')
    lines.append('| `/promo.html` | `/simulasi-kpr/` |')
    lines.append('| `/nup.html` | `/nup/` |')
    lines.append('| `/sale.html` | `/sale/` |')
    lines.append('| `/agent.html` | `/agent/` |')
    lines.append('| `/skagent.html` | `/agent/terms/` |')
    lines.append('| `/agentvalley.html` | `/agent/alt/` |')
    lines.append('| `/<slug>.html` (71 posts) | `/blog/<slug>/` |')

    lines.append('\n## Blog posts\n')
    lines.append('| # | Date | Title | New URL | Words |')
    lines.append('|---|---|---|---|---|')
    for i, post in enumerate(blog_index, 1):
        lines.append('| %d | %s | %s | `/blog/%s/` | %d |'
                     % (i, post['date'], post['title'].replace('|', '\\|'),
                        post['slug'], post['words']))

    lines.append('\n## Near-duplicate pairs to resolve\n')
    lines.append('| A | B | Jaccard |')
    lines.append('|---|---|---|')
    for a, b, score in NEAR_DUPLICATES:
        lines.append('| `%s` | `%s` | %.2f |' % (a, b, score))

    lines.append('\n## Media mapping\n')
    lines.append('Every referenced upload maps to `/media/<folder>/<name>.webp`. '
                 'Full list in `site/src/data/media-needed.json`; '
                 'runtime map in `site/src/data/media-manifest.json`.\n')
    lines.append('| Source | New | KB |')
    lines.append('|---|---|---|')
    for item in sorted(needed, key=lambda i: -i['bytes'])[:40]:
        lines.append('| `%s` | `%s` | %d |'
                     % (item['src'], item['dest'], item['bytes'] // 1024))

    with open(os.path.join(MEMORY, '02-content-map.md'), 'w',
              encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')


NEAR_DUPLICATES = [
    ('perumahan-di-cimahi-tengah', 'perumahan-cimahi-city-view', 0.97),
    ('perumahan-baru-di-cimahi',
     'perumahan-baru-di-cimahi-solusi-hunian-nyaman-dekat-kota', 0.89),
    ('perumahan-cimahi', 'perumahan-permata-cimahi-bandung', 0.78),
    ('cicilan-rumah-bandung',
     'cicilan-rumah-bandung-miliki-hunian-impian-dengan-skema-ringan', 0.76),
    ('perumahan-di-cimahi-bandung', 'rumah-cimahi', 0.64),
    ('rumah-cimahi', 'perumahan-cimahi', 0.61),
    ('rumah-dijual-di-baros-cimahi', 'rumah-cimahi', 0.59),
    ('perumahan-di-cimahi-bandung', 'perumahan-cimahi', 0.55),
    ('rumah-dijual-di-baros-cimahi', 'perumahan-di-cimahi-bandung', 0.55),
]


if __name__ == '__main__':
    main()
