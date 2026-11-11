"""WordPress HTML → clean semantic HTML for Astro/MDX.

Handles the specific junk WordPress + Elementor + ElementsKit leave behind:
Gutenberg block comments, shortcodes, empty social anchors, duplicated H1s,
inline Elementor SVG icons, lightbox data attributes, related-post widgets,
self-linking featured images, and absolute upload URLs.
"""

import html
import html.parser
import re

# --- patterns ---------------------------------------------------------------

RE_COMMENTS = re.compile(r'<!--.*?-->', re.S)
RE_SCRIPT = re.compile(r'<script\b[^>]*>.*?</script>', re.S | re.I)
RE_STYLE = re.compile(r'<style\b[^>]*>.*?</style>', re.S | re.I)
RE_NOSCRIPT = re.compile(r'<noscript\b[^>]*>.*?</noscript>', re.S | re.I)
RE_SHORTCODE = re.compile(r'\[[a-zA-Z_][^\]]{0,200}\]')
RE_IFRAME = re.compile(r'<iframe\b[^>]*>.*?</iframe>', re.S | re.I)
RE_SVG = re.compile(r'<svg\b[^>]*>.*?</svg>', re.S | re.I)
RE_WHITESPACE = re.compile(r'[ \t\r\f\v]+')
RE_BLANK = re.compile(r'<p[^>]*>(\s|&nbsp;|<br\s*/?>)*</p>', re.I)

RE_ELEMENTOR_CLASS = re.compile(
    r'\b(?:elementor-element|elementor-widget[\w-]*|elementor-[\w-]+|'
    r'e-con[\w-]*|ek-container|ek-flex-block|jkit-[\w-]+|'
    r'elementor-kit-[\w-]+|swiper-[\w-]+)\b')

RE_ATTR_CLASS = re.compile(r'\sclass="[^"]*"')
RE_ATTR_ID = re.compile(r'\sid="[^"]*"')
RE_ATTR_STYLE = re.compile(r'\sstyle="[^"]*"')
RE_ATTR_TARGET = re.compile(r'\starget="_blank"(?!\s+rel=)')
RE_ATTR_DIM = re.compile(r'\s(?:width|height)="\d+"')
RE_ATTR_SRC = re.compile(r'\s(?:srcset|sizes|data-src|data-lazy-src)="[^"]*"')
RE_ATTR_DECODE = re.compile(r'\sdecoding="[^"]*"')
RE_ATTR_LOADING = re.compile(r'\sloading="[^"]*"')
RE_ATTR_DATA = re.compile(
    r'\sdata-[a-z0-9-]*(?:=(?:"[^"]*"|\'[^\']*\'|[^\s>]+))?')
RE_ATTR_TABLE = re.compile(r'\s(?:border|cellpadding|cellspacing|align|width)="[^"]*"')

RE_IMG_SRC = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', re.S | re.I)
RE_HREF_UPLOAD = re.compile(r'(href=")([^"]*?/wp-content/uploads/[^"]+)(")')
RE_HREF_ANY = re.compile(r'(<a\b[^>]*?\bhref=")([^"]+)(")', re.S | re.I)

# ElementsKit "Terpopuler" related-posts widget (ends every post).
RE_POPULAR = re.compile(
    r'<h2[^>]*>\s*Terpopuler\s*</h2>\s*(?:<article.*?</article>\s*)+', re.S | re.I)

# Some WordPress posts carry a pasted full document shell (<html><head>…<body>).
# The SEO plugin's canonical/og tags inside it point at the OLD permalink,
# which is why the old site had duplicate-content links to itself.
RE_HEAD_BLOCK = re.compile(r'<head\b[^>]*>.*?</head>', re.S | re.I)
RE_HTML_TAG = re.compile(r'</?html\b[^>]*>', re.I)
RE_BODY_TAG = re.compile(r'</?body\b[^>]*>', re.I)
RE_TITLE_TAG = re.compile(r'<title\b[^>]*>.*?</title>', re.S | re.I)
RE_META_TAG = re.compile(r'<meta\b[^>]*?/?>', re.I)
RE_LINK_TAG = re.compile(r'<link\b[^>]*?/?>', re.I)
RE_BASE_TAG = re.compile(r'<base\b[^>]*?/?>', re.I)

# Leading breadcrumb (paragraph or list form).
RE_CRUMB_P = re.compile(
    r'^\s*<p[^>]*>\s*(?:<a[^>]*>\s*)?(?:Home|Blog|Home\s*\|\s*Blog)'
    r'(?:\s*</a>)?\s*(?:<[^>]+>\s*)*</p>\s*', re.I)
RE_CRUMB_UL = re.compile(
    r'^\s*<ul[^>]*>\s*(?:<li[^>]*>\s*(?:<a[^>]*>\s*)?(?:Home|Blog)'
    r'(?:\s*</a>)?\s*</li>\s*){1,3}</ul>\s*', re.I)

# Bare YouTube/TikTok URLs sitting in text.
RE_BARE_VIDEO = re.compile(
    r'(?<!["\'>\s])(https?://(?:www\.)?(?:youtube\.com/shorts/|youtu\.be/|'
    r'facebook\.com/reel/|tiktok\.com/@[^/\s]+/video/)[^\s<"\']+)')

RE_BERIKLAN = re.compile(
    r'<p[^>]*>\s*(?:Butuh Bantuan Promosi Properti\?|'
    r'Promosikan Properti Anda Sekarang!)\b.*?</p>', re.S | re.I)
RE_BERIKLAN_LINKS = re.compile(
    r'<ul[^>]*>(?:\s*<li[^>]*>\s*<a[^>]*href="https?://(?:www\.)?beriklan\.co\.id[^"]*"[^>]*>'
    r'[^<]*</a>\s*</li>)+\s*</ul>', re.I)

CTA_BLOCK = (
    '<aside class="cta-inline">'
    '<p><strong>Promosikan properti Anda di sini.</strong> '
    'Beriklan Digital Agency membantu developer dan agen properti '
    'menemukan calon pembeli lewat Google Ads, Meta Ads, dan SEO. '
    '<a href="https://beriklan.co.id/" rel="nofollow noopener" target="_blank">'
    'Pelajari layanannya</a>.</p>'
    '</aside>'
)

# Spelling fixes carried over from the WordPress copy.
WORD_FIXES = {
    # The Spanish word "ambiente" leaked into an Indonesian comparison
    # table. It should read "lingkungan".
    'Limbiento': 'Lingkuangan',
    # A missing space that Elementor dropped in the shared "Suasana"
    # heading block — it appears in all 71 posts.
    'menenangkanSejak': 'menenangkan sejak',
}


def text_only(raw):
    """Plain text, for excerpt/meta generation."""
    raw = RE_SCRIPT.sub('', raw)
    raw = RE_COMMENTS.sub('', raw)
    raw = RE_SVG.sub('', raw)
    raw = re.sub(r'<[^>]+>', ' ', raw)
    raw = html.unescape(raw)
    raw = RE_WHITESPACE.sub(' ', raw)
    return raw.strip()


def strip_elements(raw):
    raw = RE_COMMENTS.sub('', raw)
    raw = RE_SCRIPT.sub('', raw)
    raw = RE_STYLE.sub('', raw)
    raw = RE_NOSCRIPT.sub('', raw)
    return raw


def drop_iframes(raw, keep_momento=True):
    def _repl(m):
        tag = m.group(0)
        if keep_momento and 'momento360.com' in tag:
            return tag
        return ''
    return RE_IFRAME.sub(_repl, raw)


def drop_svgs(raw):
    """Remove inline Elementor icon SVGs — they are decorative noise in prose."""
    return RE_SVG.sub('', raw)


def clean_attributes(raw):
    raw = RE_ELEMENTOR_CLASS.sub('', raw)
    raw = RE_ATTR_CLASS.sub('', raw)
    raw = RE_ATTR_ID.sub('', raw)
    raw = RE_ATTR_STYLE.sub('', raw)
    raw = RE_ATTR_TARGET.sub('', raw)
    raw = RE_ATTR_DIM.sub('', raw)
    raw = RE_ATTR_DECODE.sub('', raw)
    raw = RE_ATTR_LOADING.sub('', raw)
    raw = RE_ATTR_SRC.sub('', raw)
    raw = RE_ATTR_DATA.sub('', raw)
    raw = RE_ATTR_TABLE.sub('', raw)
    return raw


def unwrap_self_links(raw, self_paths):
    """Replace <a href="<own url>"><img/></a> with just the image."""
    if not self_paths:
        return raw
    for path in self_paths:
        for variant in (path, path.replace('.html', ''), path.rstrip('/')):
            if not variant:
                continue
            pattern = re.compile(
                r'<a\b[^>]*href="' + re.escape(variant) + r'"[^>]*>(.*?)</a>',
                re.S | re.I)
            raw = pattern.sub(r'\1', raw)
    return raw


def drop_empty_anchors(raw):
    """Remove anchors with no usable href, and empty-href anchors."""
    raw = re.sub(r'<a\b(?![^>]*href=)[^>]*>.*?</a>', '', raw, flags=re.S | re.I)
    raw = re.sub(r'<a\b[^>]*href=""\s*[^>]*>(.*?)</a>', r'\1', raw,
                 flags=re.S | re.I)
    return raw


def strip_leading_h1(raw):
    """Remove the first <h1> — the Astro layout supplies its own."""
    return re.sub(r'<h1\b[^>]*>.*?</h1>\s*', '', raw, count=1, flags=re.S | re.I)


def strip_leading_title_h2(raw, title):
    """Remove a leading <h2> that echoes the post title (WP template echo)."""
    if not title:
        return raw
    target = title.strip().lower()

    def _repl(m):
        text = text_only(m.group(2)).strip().lower()
        return '' if text == target else m.group(0)
    return re.sub(r'(<h2\b[^>]*>)(.*?)(</h2>)\s*', _repl, raw, count=1,
                  flags=re.S | re.I)


def strip_breadcrumb(raw):
    for _ in range(4):
        new = RE_CRUMB_UL.sub('', raw)
        new = RE_CRUMB_P.sub('', new)
        if new == raw:
            break
        raw = new
    return raw


def strip_popular_widget(raw):
    return RE_POPULAR.sub('', raw)


def strip_document_shell(raw):
    """Remove a pasted <html>/<head>/<body> shell from a post body.

    The SEO plugin used to inject a full document head into the content.
    Its canonical and og:url tags point at the old WordPress permalink, so
    leaving them in would both break links and duplicate the page metadata
    that the Astro layout already generates.
    """
    raw = RE_HEAD_BLOCK.sub('', raw)
    raw = RE_HTML_TAG.sub('', raw)
    raw = RE_BODY_TAG.sub('', raw)
    raw = RE_TITLE_TAG.sub('', raw)
    raw = RE_META_TAG.sub('', raw)
    raw = RE_LINK_TAG.sub('', raw)
    raw = RE_BASE_TAG.sub('', raw)
    return raw


def replace_beriklan(raw):
    if RE_BERIKLAN.search(raw):
        raw = RE_BERIKLAN.sub(CTA_BLOCK, raw)
        raw = RE_BERIKLAN_LINKS.sub('', raw)
    return raw


def link_bare_videos(raw):
    def _repl(m):
        url = m.group(1)
        label = 'Tonton videonya'
        return ('<a href="%s" target="_blank" rel="noopener" '
                'class="video-link">%s</a>' % (url, label))
    return RE_BARE_VIDEO.sub(_repl, raw)


def rewrite_media_urls(raw, media_map):
    def _img(m):
        url = m.group(2)
        new = media_map.get(url) or media_map.get(_strip_host(url))
        return m.group(1) + (new or url) + m.group(3)
    raw = RE_IMG_SRC.sub(_img, raw)

    def _href(m):
        url = m.group(2)
        new = media_map.get(url) or media_map.get(_strip_host(url))
        return m.group(1) + (new or url) + m.group(3)
    return RE_HREF_UPLOAD.sub(_href, raw)


def _strip_host(url):
    url = url.strip()
    for prefix in ('http://valleycity.id', 'https://valleycity.id'):
        if url.startswith(prefix):
            return url[len(prefix):]
    return url


def rewrite_links(raw, link_map):
    """Rewrite internal hrefs from the old WordPress shape to the new routes.

    External URLs, mailto/tel, protocol-relative URLs and pure fragments are
    left untouched. Query strings and fragments on a rewritten link are kept.
    """
    if not link_map:
        return raw

    def _repl(m):
        url = m.group(2).strip()
        if (not url or url.startswith('#')
                or url.startswith(('mailto:', 'tel:', 'sms:', 'javascript:',
                                   'http://', 'https://', '//'))):
            return m.group(0)

        base, hash_sep, fragment = url.partition('#')
        query = ''
        if '?' in base:
            base, qs = base.split('?', 1)
            query = '?' + qs

        target = (link_map.get(base)
                  or link_map.get(base.rstrip('/'))
                  or link_map.get(base + '/'))
        if not target:
            return m.group(0)
        return m.group(1) + target + query + hash_sep + fragment + m.group(3)

    return RE_HREF_ANY.sub(_repl, raw)


def strip_shortcodes(raw, form_marker=None):
    if form_marker:
        raw = raw.replace("[sureforms id='1058']", form_marker)
        raw = raw.replace('[sureforms id="1058"]', form_marker)
    return RE_SHORTCODE.sub('', raw)


def normalise_whitespace(raw):
    raw = RE_WHITESPACE.sub(' ', raw)
    raw = re.sub(r'>\s+<', '><', raw)
    raw = re.sub(r'\n\s*\n+', '\n', raw)
    raw = RE_BLANK.sub('', raw)
    raw = re.sub(r'<li>\s*</li>', '', raw)
    return raw.strip()


def absolute_to_local(raw):
    return (raw.replace('http://valleycity.id', '')
               .replace('https://valleycity.id', ''))


def apply_word_fixes(raw):
    for wrong, right in WORD_FIXES.items():
        if wrong == right:
            continue
        raw = re.sub(r'\b' + re.escape(wrong) + r'\b', right, raw)
    return raw


def clean_content(raw, media_map=None, title=None, form_marker=None,
                  self_paths=None):
    """Full pipeline for a WordPress post_content string."""
    media_map = media_map or {}
    out = strip_elements(raw)
    # Make every URL origin-relative early so the later passes can match them.
    out = absolute_to_local(out)
    out = strip_document_shell(out)
    out = drop_iframes(out)
    out = strip_shortcodes(out, form_marker=form_marker)
    out = strip_popular_widget(out)
    out = strip_leading_title_h2(out, title)
    out = strip_breadcrumb(out)
    out = strip_leading_h1(out)
    out = replace_beriklan(out)
    out = unwrap_self_links(out, self_paths)
    out = rewrite_media_urls(out, media_map)
    out = drop_empty_anchors(out)
    out = drop_svgs(out)
    out = clean_attributes(out)
    out = link_bare_videos(out)
    out = apply_word_fixes(out)
    out = normalise_whitespace(out)
    out = balance_tags(out)
    out = to_block_lines(out)
    return out


def first_paragraph(raw, limit=160):
    """First meaningful paragraph, trimmed on a word boundary."""
    for match in re.finditer(r'<p[^>]*>(.*?)</p>', raw, flags=re.S | re.I):
        text = text_only(match.group(1))
        if len(text) >= 40:
            break
    else:
        return ''
    if len(text) <= limit:
        return text
    cut = text[:limit]
    if ' ' in cut:
        cut = cut.rsplit(' ', 1)[0]
    return cut.rstrip(' ,.;:—–-') + '…'


def yaml_escape(value):
    if value is None:
        return '""'
    text = str(value)
    text = text.replace('\\', '\\\\').replace('"', '\\"')
    text = text.replace('\n', ' ').replace('\r', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return '"' + text + '"'


# --- Tag balancing ---------------------------------------------------------

VOID_TAGS = {
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
}


class _Balancer(html.parser.HTMLParser):
    """Repairs unbalanced HTML so MDX/JSX parsing never chokes."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        if tag in VOID_TAGS:
            self.out.append(self.get_starttag_text())
            return
        self.out.append(self.get_starttag_text())
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.out.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            return
        if tag not in self.stack:
            return  # stray closer — drop it
        # Close everything opened after <tag>, then close <tag> itself.
        while self.stack:
            top = self.stack.pop()
            self.out.append('</%s>' % top)
            if top == tag:
                break

    def handle_data(self, data):
        self.out.append(data)

    def handle_entityref(self, name):
        self.out.append('&%s;' % name)

    def handle_charref(self, name):
        self.out.append('&#%s;' % name)

    def handle_comment(self, data):
        pass

    def handle_decl(self, decl):
        pass

    def handle_pi(self, data):
        pass

    def unknown_decl(self, data):
        pass

    def result(self):
        while self.stack:
            self.out.append('</%s>' % self.stack.pop())
        return ''.join(self.out)


def balance_tags(raw: str) -> str:
    """Close unclosed tags and drop stray closing tags."""
    parser = _Balancer()
    try:
        parser.feed(raw)
        parser.close()
    except Exception:
        return raw
    return parser.result()


# Block-level elements. MDX only treats JSX as a block when it starts a line,
# so every one of these has to be put on its own line.
BLOCK_TAGS = (
    'p|div|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|th|td|caption|'
    'h1|h2|h3|h4|h5|h6|figure|figcaption|aside|section|article|header|'
    'footer|nav|blockquote|pre|hr|iframe|form|main|address|details|summary'
)


def to_block_lines(raw: str) -> str:
    """Put block-level tags on their own lines so MDX parses them as blocks."""
    raw = re.sub(r'<(/?)(%s)\b' % BLOCK_TAGS, r'\n<\1\2', raw, flags=re.I)
    raw = re.sub(r'[ \t]+', ' ', raw)
    raw = re.sub(r'\n{3,}', '\n\n', raw)
    raw = re.sub(r'^\n+', '', raw)
    return raw.strip()
