#!/usr/bin/env python3
"""Quantum Rarity visit counter. Standard library only.

POST /api/hit    {"v": visitor_id}                       a page view
POST /api/check  {"v": visitor_id, "a": address, "t": tier, "n": one_in}
GET  /stats?key=SECRET                                   the owner's dashboard

Stores one JSON line per event. Never stores IP addresses or anything that is
not a public Solana address. Runs on 127.0.0.1 behind Caddy.
"""
import html, json, os, re, sys, time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

DATA = os.environ.get("QR_DATA", "/var/lib/quantum-rarity/events.jsonl")
KEY = os.environ.get("QR_KEY", "")
PORT = int(os.environ.get("QR_PORT", "5191"))
MAX_FILE = 200 * 1024 * 1024  # stop writing past 200 MB
ADDR = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
VID = re.compile(r"^[a-z0-9]{8,32}$")
TIERS = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"]

os.makedirs(os.path.dirname(DATA), exist_ok=True)


def append(ev):
    try:
        if os.path.exists(DATA) and os.path.getsize(DATA) > MAX_FILE:
            return
        with open(DATA, "a") as f:
            f.write(json.dumps(ev, separators=(",", ":")) + "\n")
    except OSError:
        pass


def load():
    out = []
    try:
        with open(DATA) as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except FileNotFoundError:
        pass
    return out


def fmt(n):
    return f"{n:,}"


def dashboard():
    evs = load()
    now = time.time()
    day = now - 86400
    hits = [e for e in evs if e.get("k") == "hit"]
    checks = [e for e in evs if e.get("k") == "check"]
    def uniq(es): return len({e.get("v") for e in es})
    tiers = Counter(e.get("t") for e in checks)
    top = Counter(e.get("a") for e in checks).most_common(15)
    best = sorted(checks, key=lambda e: -float(e.get("n") or 0))[:15]
    recent = checks[-100:][::-1]
    per_day = Counter(time.strftime("%Y-%m-%d", time.gmtime(e["ts"])) for e in hits)
    days = sorted(per_day)[-14:]
    peak = max([per_day[d] for d in days] or [1])

    def row_addr(a):
        a = html.escape(a or "")
        return f'<a href="/#{a}" target="_blank">{a}</a>'

    def when(ts):
        return time.strftime("%d %b %H:%M", time.gmtime(ts)) + " UTC"

    cards = [
        ("Visits", fmt(len(hits)), f"{fmt(len([e for e in hits if e['ts'] > day]))} today"),
        ("Visitors", fmt(uniq(hits)), f"{fmt(uniq([e for e in hits if e['ts'] > day]))} today"),
        ("Wallets checked", fmt(len(checks)), f"{fmt(len([e for e in checks if e['ts'] > day]))} today"),
        ("Different wallets", fmt(len({e.get('a') for e in checks})), f"by {fmt(uniq(checks))} people"),
    ]
    h = ['<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
         '<title>Quantum Rarity stats</title><meta name="robots" content="noindex">',
         '<link rel="stylesheet" href="/stats/style.css">',
         '<div class="page"><h1>Quantum Rarity · stats</h1><p class="sub">Updated ' + when(now) + '. Refresh to update.</p>',
         '<div class="cards">' + "".join(f'<div><dt>{a}</dt><dd>{b}</dd><small>{c}</small></div>' for a, b, c in cards) + '</div>',
         '<h2>Visits per day</h2><div class="bars">' + "".join(
             f'<div title="{d}: {per_day[d]}"><i style="height:{max(2, 100 * per_day[d] / peak):.0f}%"></i><span>{d[5:]}</span><b>{per_day[d]}</b></div>' for d in days) + '</div>',
         '<h2>Tiers found</h2><table>' + "".join(f'<tr><td>{t}</td><td class="n">{fmt(tiers.get(t, 0))}</td></tr>' for t in TIERS) + '</table>',
         '<h2>Rarest wallets checked</h2><table><tr><th>Wallet</th><th>Tier</th><th class="n">1 in</th></tr>' + "".join(
             f'<tr><td class="a">{row_addr(e.get("a"))}</td><td>{html.escape(str(e.get("t")))}</td><td class="n">{fmt(int(float(e.get("n") or 0)))}</td></tr>' for e in best) + '</table>',
         '<h2>Most checked wallets</h2><table><tr><th>Wallet</th><th class="n">Times</th></tr>' + "".join(
             f'<tr><td class="a">{row_addr(a)}</td><td class="n">{c}</td></tr>' for a, c in top) + '</table>',
         '<h2>Latest checks</h2><table><tr><th>When</th><th>Wallet</th><th>Tier</th></tr>' + "".join(
             f'<tr><td>{when(e["ts"])}</td><td class="a">{row_addr(e.get("a"))}</td><td>{html.escape(str(e.get("t")))}</td></tr>' for e in recent) + '</table>',
         '</div>']
    return "".join(h)


class H(BaseHTTPRequestHandler):
    server_version = "qr-stats"

    def log_message(self, *a):
        pass

    def send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlparse(self.path).path
        n = int(self.headers.get("content-length") or 0)
        if n > 2048:
            return self.send(413)
        try:
            d = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self.send(400)
        v = str(d.get("v", ""))
        if not VID.match(v):
            return self.send(400)
        if path == "/api/hit":
            append({"k": "hit", "ts": int(time.time()), "v": v})
            return self.send(204)
        if path == "/api/check":
            a, t = str(d.get("a", "")), str(d.get("t", ""))
            try:
                one_in = float(d.get("n", 0))
            except (TypeError, ValueError):
                one_in = 0
            if not ADDR.match(a) or t not in TIERS:
                return self.send(400)
            append({"k": "check", "ts": int(time.time()), "v": v, "a": a, "t": t, "n": min(one_in, 1e300)})
            return self.send(204)
        self.send(404)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/stats/style.css":
            return self.send(200, CSS.encode(), "text/css")
        if u.path in ("/stats", "/stats/"):
            key = parse_qs(u.query).get("key", [""])[0]
            if not KEY or key != KEY:
                return self.send(403, b"forbidden")
            return self.send(200, dashboard().encode(), "text/html; charset=utf-8")
        self.send(404)


CSS = """body{margin:0;background:#e8edf2;color:#152238;font:15px/1.5 system-ui,sans-serif}
.page{max-width:1100px;margin:0 auto;padding:28px 18px}h1{margin:0;font-size:28px}.sub{color:#4b5a73;margin:4px 0 22px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.cards div{background:#fff;border:2px solid #152238;border-radius:4px;padding:14px}
dt{color:#4b5a73;font-size:13px}dd{margin:2px 0;font:600 30px ui-monospace,Consolas,monospace}small{color:#4b5a73}
h2{font-size:18px;margin:28px 0 8px}table{width:100%;border-collapse:collapse;background:#fff;border:1.5px solid #152238}
td,th{padding:7px 10px;border-top:1px solid #d2dbe5;text-align:left}th{background:#f3f6f9;font-size:13px}.n{text-align:right;font-family:ui-monospace,Consolas,monospace}
td.a{font-family:ui-monospace,Consolas,monospace;font-size:13px;word-break:break-all}a{color:#2350b8}
.bars{display:flex;gap:6px;align-items:flex-end;height:150px;background:#fff;border:1.5px solid #152238;padding:10px 10px 28px}
.bars div{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;position:relative}
.bars i{display:block;background:#152238;border-radius:2px 2px 0 0}.bars span{position:absolute;bottom:-20px;left:0;right:0;text-align:center;font-size:11px;color:#4b5a73}
.bars b{position:absolute;top:-2px;left:0;right:0;text-align:center;font-size:11px}
@media(max-width:700px){.cards{grid-template-columns:1fr 1fr}}"""

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        print(dashboard()[:200])
        sys.exit(0)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
