# Usage: DUMP=/tmp/out.json node test/run.js && python3 tools/render_png.py /tmp/out.json docs/local_test_output.png "Title"
# Turns the real mock-test output (sheet contents) into a table image, labelled as mock output with the creation time in JST.
# Optional 4th argument: an HTML file (for example a generated PDF body) to render instead of the sheets.
import json, html, sys, datetime
from playwright.sync_api import sync_playwright
d = json.load(open(sys.argv[1])); out = sys.argv[2]; title = sys.argv[3] if len(sys.argv) > 3 else ''
page = open(sys.argv[4]).read() if len(sys.argv) > 4 else None
jst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M')
css = "body{font-family:'Noto Sans CJK JP',sans-serif;margin:16px;width:1000px}table{border-collapse:collapse;font-size:12px;margin-bottom:8px}td,th{border:1px solid #bbb;padding:3px 6px}th{background:#e8f0fe}.n{font-size:12px;background:#fff8e1;border:1px solid #f0d58a;padding:6px}.pg{border:1px solid #999;padding:24px;width:640px;background:#fff}"
b = f"<div class='n'>模擬環境での出力 / Mock-environment output: node test/run.js with fake Google services and fictional data. Created {jst} JST</div><h3>{html.escape(title)}</h3>"
if page:
    b += f"<div class='pg'>{page}</div>"
else:
    for n, rows in d['sheets'].items():
        if not rows: continue
        b += f"<h4>{html.escape(n)}</h4><table>" + "".join("<tr>" + "".join(f"<{'th' if i==0 else 'td'}>{html.escape(str(c))}</{'th' if i==0 else 'td'}>" for c in r) + "</tr>" for i, r in enumerate(rows)) + "</table>"
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome'); pg = br.new_page(viewport={'width': 1040, 'height': 300})
    pg.set_content(f"<style>{css}</style>{b}"); pg.screenshot(path=out, full_page=True); br.close()
