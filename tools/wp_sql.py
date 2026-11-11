"""Minimal, quote-aware MySQL dump reader.

Only what we need: parse `INSERT INTO <table> VALUES ...;` statements out of a
gzipped mysqldump without needing a MySQL server.
"""

import gzip
import os
import re
import sys

ESCAPES = {
    'n': '\n', 't': '\t', 'r': '\r', '0': '\x00', 'b': '\b', 'Z': '\x1a',
    '\\': '\\', '"': '"', "'": "'",
}


def load_sql(path):
    """Return the dump as text. Accepts .sql or .sql.gz."""
    if path.endswith('.gz'):
        with gzip.open(path, 'rt', encoding='utf-8', errors='replace') as fh:
            return fh.read()
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        return fh.read()


def scan_inserts(sql, table):
    """Yield lists of field values for every row of `table`."""
    pattern = re.compile(
        r"INSERT INTO `" + re.escape(table) + r"`\s*VALUES\s*", re.S)
    n = len(sql)
    for match in pattern.finditer(sql):
        pos = match.end()
        while True:
            while pos < n and sql[pos] in ' \n\r\t,':
                pos += 1
            if pos >= n or sql[pos] != '(':
                break
            pos += 1
            fields, cur, in_quote = [], [], False
            while pos < n:
                ch = sql[pos]
                if in_quote:
                    if ch == '\\':
                        nxt = sql[pos + 1] if pos + 1 < n else ''
                        cur.append(ESCAPES.get(nxt, nxt))
                        pos += 2
                        continue
                    if ch == "'":
                        in_quote = False
                        pos += 1
                        continue
                    cur.append(ch)
                    pos += 1
                    continue
                if ch == "'":
                    in_quote = True
                    pos += 1
                    continue
                if ch == ',':
                    fields.append(''.join(cur))
                    cur = []
                    pos += 1
                    continue
                if ch == ')':
                    fields.append(''.join(cur))
                    pos += 1
                    break
                cur.append(ch)
                pos += 1
            yield fields


def get_table(sql, table):
    return list(scan_inserts(sql, table))


def get_table_dicts(sql, table, columns):
    return [dict(zip(columns, row)) for row in get_table(sql, table)]


# --- Column layouts for the tables we care about ----------------------------

POST_COLUMNS = (
    "ID post_author post_date post_date_gmt post_content post_title "
    "post_excerpt post_status comment_status ping_status post_password "
    "post_name to_ping pinged post_modified post_modified_gmt "
    "post_content_filtered post_parent guid menu_order post_type "
    "post_mime_type comment_count"
).split()

POSTMETA_COLUMNS = "meta_id post_id meta_key meta_value".split()

OPTION_COLUMNS = "option_id option_name option_value autoload".split()

TERM_COLUMNS = (
    "term_id term_group taxonomy term_taxonomy_id description parent count "
    "filter"
).split()


def load_all(sql_path):
    """Convenience loader returning every table we use as dicts."""
    sql = load_sql(sql_path)
    return {
        'posts': get_table_dicts(sql, 'wp_posts', POST_COLUMNS),
        'postmeta': get_table_dicts(sql, 'wp_postmeta', POSTMETA_COLUMNS),
        'options': get_table_dicts(sql, 'wp_options', OPTION_COLUMNS),
    }


def index_meta(postmeta):
    """post_id -> {meta_key: meta_value}"""
    out = {}
    for row in postmeta:
        out.setdefault(row['post_id'], {})[row['meta_key']] = row['meta_value']
    return out


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if not path:
        print('usage: wp_sql.py <dump.sql[.gz]>')
        sys.exit(1)
    if not os.path.exists(path):
        print('not found:', path)
        sys.exit(1)
    data = load_all(path)
    print('posts   :', len(data['posts']))
    print('postmeta:', len(data['postmeta']))
    print('options :', len(data['options']))
