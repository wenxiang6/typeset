"""Generate src/data/content.ts from the textutil-extracted HTML of the .doc.
Keeps bold runs exactly as in the source document."""
import re, html, json, sys

SRC = '/Users/gongyi/.hermes/cache/scratch/paiban/htmlout/geo.html'
OUT = '/Users/gongyi/wenxiang/paiban/src/data/content.ts'

h = open(SRC, encoding='utf-8', errors='replace').read()
body = h[h.find('</style>'):]
paras = re.findall(r'<p class="(p\d+)">(.*?)</p>', body, re.S)

def runs_of(inner: str):
    # normalise: keep only <b> markers, unescape everything else
    s = inner
    s = s.replace('<span class="Apple-converted-space">', '').replace('</span>', '')
    s = re.sub(r'<span[^>]*>', '', s)
    s = re.sub(r'</span>', '', s)
    s = s.replace('<br>', '').replace('<br/>', '')
    s = re.sub(r'</?b[^>]*>', '\x01', s)   # toggle marker on BOTH open and close
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s).strip()
    out = []
    for i, part in enumerate(s.split('\x01')):
        bold = (i % 2 == 1)
        if part == '':
            continue
        if out and out[-1]['b'] == bold:
            out[-1]['t'] += part
        else:
            out.append({'t': part, 'b': bold})
    # trim trailing whitespace-only runs
    while out and out[-1]['t'].strip() == '':
        out.pop()
    return out

allp = [(i, cls, runs_of(inner)) for i, (cls, inner) in enumerate(paras)]

# --- classification (index in textutil paragraph order) ---
ISSUE = {5}
NOTE = {7, 8}
H2 = {9, 15, 24, 41, 57, 62, 77, 79}
H3 = {25, 28, 30, 36, 42, 45, 47, 53, 63, 70, 80, 95}
NUM_A = {12: '1.', 13: '2.', 14: '3.'}
NUM_B = {16: '1.', 17: '2.', 22: '3.'}
BULLET = {18, 19, 20, 21}

PAGES = [
    [5, 7, 8, 9, 10, 11, 12, 13],
    [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33],
    [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46],
    [47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58],
    [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69],
    [70, 71, 72, 73, 74, 75, 76, 77, 78],
    [79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94],
    [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 109, 110, 111, 112],
]
assert sum(len(p) for p in PAGES) == len(set(x for p in PAGES for x in p))
used = {x for p in PAGES for x in p}
body_idx = {i for i, cls, r in allp if r and i < 113}
missing = sorted(body_idx - used)
extra = sorted(used - body_idx)
print('unused body paragraphs:', missing, file=sys.stderr)
print('unknown references:', extra, file=sys.stderr)

def esc(s: str) -> str:
    return s.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')

def runs_ts(runs):
    parts = []
    for r in runs:
        if r['b']:
            parts.append('{ t: `%s`, b: true }' % esc(r['t']))
        else:
            parts.append('{ t: `%s` }' % esc(r['t']))
    return '[%s]' % ', '.join(parts)

def block_ts(i: int):
    runs = dict((j, r) for j, c, r in allp)[i]
    if i in ISSUE:
        # 期刊标题之后紧跟配图（图片资源在 src/config/images.ts 里配置）
        return "{ k: 'issue', runs: %s },\n    { k: 'figure', runs: [] }" % runs_ts(runs)
    if i in NOTE:
        return "{ k: 'note', runs: %s }" % runs_ts(runs)
    if i in H2:
        return "{ k: 'h2', runs: %s }" % runs_ts(runs)
    if i in H3:
        return "{ k: 'h3', runs: %s }" % runs_ts(runs)
    if i in NUM_A:
        return "{ k: 'item', marker: '%s', runs: %s }" % (NUM_A[i], runs_ts(runs))
    if i in NUM_B:
        return "{ k: 'item', marker: '%s', runs: %s }" % (NUM_B[i], runs_ts(runs))
    if i in BULLET:
        return "{ k: 'item', marker: '\\u2022', runs: %s }" % runs_ts(runs)
    return "{ k: 'p', runs: %s }" % runs_ts(runs)

lines = []
lines.append('// 由 scripts/gen_content.py 从《地理时政周刊一.doc》自动提取生成')
lines.append('// 加粗 run 与原文档一致；勿手改文字，改 .doc 后重新生成')
lines.append('')
lines.append('export type Run = { t: string; b?: boolean }')
lines.append("export type BlockKind = 'issue' | 'figure' | 'note' | 'h2' | 'h3' | 'p' | 'item'")
lines.append('export type Block = {')
lines.append('  k: BlockKind')
lines.append('  runs: Run[]')
lines.append('  marker?: string')
lines.append('}')
lines.append('')
lines.append('export const pages: Block[][] = [')
for p in PAGES:
    lines.append('  [')
    for i in p:
        lines.append('    ' + block_ts(i) + ',')
    lines.append('  ],')
lines.append(']')
lines.append('')
lines.append('export const TOTAL_PAGES = pages.length')
lines.append('')

open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))
print('wrote', OUT, len('\n'.join(lines)), 'chars')
for i, cls, r in allp[:6]:
    print(i, cls, r[:2], file=sys.stderr)
