#!/usr/bin/env python3
"""
Equipment photo pipeline  (one-time / on-demand, runs on a developer machine — not in production)

  rules.json  ->  Pexels search  ->  rembg background removal  ->  quality score  ->  best cutout per machine type
              ->  transparent WebP  ->  contact sheets (for human review)  ->  mapping + credits

Usage (from this folder, venv active or use .venv/bin/python):
    PEXELS_API_KEY in .env (git-ignored)
    .venv/bin/python build_images.py --out ../../../revampedFrontend/public/equipment
    options: --only key1,key2   --redo key1   --candidates 6   --threshold 0.62

Everything is cached in ./.cache so re-runs are cheap and resumable.
Pexels licence: free to use and modify; photographers are credited in CREDITS.txt (API guidelines).
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent.parent
RULES_FILE = BACKEND / "migrations" / "data" / "equipment-image-rules.json"
MAP_FILE = BACKEND / "migrations" / "data" / "equipment-images.json"
CACHE = HERE / ".cache"
for sub in ("search", "raw", "cut", "meta"):
    (CACHE / sub).mkdir(parents=True, exist_ok=True)

PEXELS_URL = "https://api.pexels.com/v1/search"
GREAT = 0.80

STOP = {"white", "background", "isolated", "a", "the", "of", "and", "set"}
PERSON = re.compile(r"\b(man|men|woman|women|person|people|worker|workers|boy|girl|child|kid|kids|hand|hands|holding|someone|male|female|guy|lady|portrait|selfie)\b")
FAKE = re.compile(r"\b(toy|toys|miniature|illustration|vector|drawing|cartoon|3d|render|icon|logo|sketch|painting|model|monochrome|black and white|grayscale|greyscale|desk|laptop|kitchen|cooking|baking|collection|assorted|variety|various|assortment|toolbox|workbench|setup)\b")
SCENE = re.compile(r"\b(spark|sparks|flying|cutting through|in action|site|yard|aerial|landscape|interior|exterior|outdoor|outdoors|parked|against|leaning|lying|sitting|resting|surrounded|pile|piles|stack|stacks|cluster|group|rows|row|many|several|multiple|bunch|bundle|stacked)\b")
MULTI = re.compile(r"\b(and|with|next to|beside|alongside|along with)\b")


def load_env():
    f = HERE / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def sha(s):
    return hashlib.sha1(s.encode()).hexdigest()[:16]


# --------------------------------------------------------------------------- Pexels
def pexels_search(query, per_page):
    cache = CACHE / "search" / f"{sha(query)}-{per_page}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    key = os.environ["PEXELS_API_KEY"]
    for attempt in range(8):
        try:
            r = requests.get(PEXELS_URL, headers={"Authorization": key}, params={"query": query, "per_page": per_page}, timeout=30)
        except requests.RequestException:
            time.sleep(5 * (attempt + 1))  # transient network problem: back off and retry
            continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(10 * (attempt + 1))
            continue
        r.raise_for_status()
        data = r.json()
        cache.write_text(json.dumps(data))
        time.sleep(0.4)
        return data
    raise RuntimeError(f"Pexels unreachable / rate-limited for {query!r}")


def download(photo):
    path = CACHE / "raw" / f"{photo['id']}.jpg"
    if not path.exists():
        # only ever fetch from Pexels' own CDN
        url = photo["src"]["large"]
        assert url.startswith("https://images.pexels.com/"), url
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        path.write_bytes(r.content)
    return Image.open(path).convert("RGB")


# --------------------------------------------------------------------------- cutout + scoring
_session = None


def cutout(photo_id, img):
    global _session
    path = CACHE / "cut" / f"{photo_id}.png"
    if path.exists():
        return Image.open(path).convert("RGBA")
    from rembg import new_session, remove

    if _session is None:
        _session = new_session("isnet-general-use")
    out = remove(img, session=_session).convert("RGBA")
    out.save(path)
    return out


def clip(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def mask_metrics(cut, orig):
    small = cut.copy()
    small.thumbnail((512, 512))
    a = np.asarray(small)[:, :, 3] / 255.0
    mask = a > 0.5
    fg = mask.sum()
    h, w = mask.shape
    if fg < h * w * 0.05:
        return None
    fg_ratio = fg / (h * w)
    labels, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, labels, range(1, n + 1)) if n else np.array([fg])
    largest = float(np.max(sizes) / fg)
    n_sig = int(np.sum(sizes > 0.06 * fg))
    band = max(2, int(min(h, w) * 0.02))
    ring = np.zeros_like(mask)
    ring[:band, :] = ring[-band:, :] = ring[:, :band] = ring[:, -band:] = True
    touch = float((mask & ring).sum() / fg)
    amb = float(((a > 0.1) & (a < 0.9)).sum() / fg)
    fg_score = clip(min((fg_ratio - 0.08) / 0.17, (0.95 - fg_ratio) / 0.30, 1.0))
    # plain backdrop? low luminance variance around the photo border => cleaner cutout
    g = np.asarray(orig.convert("L").resize((w, h)), dtype=float)
    border_std = float(g[ring].std())
    hsv = np.asarray(orig.resize((w, h)).convert("HSV"), dtype=float)
    sat = float(hsv[:, :, 1][mask].mean() / 255.0)
    return {
        "n_sig": n_sig,
        "sat": round(sat, 3),
        "fg_ratio": round(fg_ratio, 3),
        "largest": round(largest, 3),
        "touch": round(touch, 3),
        "amb": round(amb, 3),
        "fg_score": round(fg_score, 3),
        "bg_simple": round(clip(1 - border_std / 70.0), 3),
    }


def relevance(photo, term):
    alt = (photo.get("alt") or "").lower()
    words = [w for w in re.findall(r"[a-z]+", term.lower()) if w not in STOP]
    if not alt:
        return 0.5, alt
    hit = sum(1 for w in words if w in alt) / max(1, len(words))
    # the head noun (generator, mixer, drill …) must be in the description, otherwise it is probably the wrong object
    head = words[-1] if words else ""
    if head and head not in alt and head.rstrip("s") not in alt:
        hit *= 0.4
    return hit, alt


def score(photo, term):
    meta_f = CACHE / "meta" / f"{photo['id']}-{sha(term)}.json"
    if meta_f.exists():
        return json.loads(meta_f.read_text())
    rel, alt = relevance(photo, term)
    res = {"id": photo["id"], "score": 0.0, "rel": round(rel, 2), "alt": alt, "term": term}
    try:
        orig = download(photo)
        cut = cutout(photo["id"], orig)
        m = mask_metrics(cut, orig)
    except Exception as e:  # network / decode problems => just skip this candidate
        res["error"] = str(e)[:120]
        meta_f.write_text(json.dumps(res))
        return res
    if m:
        share = clip((m["largest"] - 0.6) / 0.35)
        s = (
            0.20 * share
            + 0.10 * (1 - clip(m["touch"] * 6))
            + 0.08 * clip(1 - m["amb"] * 8)
            + 0.12 * m["fg_score"]
            + 0.07 * m["bg_simple"]
            + 0.08 * clip(m["sat"] / 0.25)
            + 0.35 * rel
        )
        if PERSON.search(alt) or FAKE.search(alt):
            s -= 0.25
        if MULTI.search(alt):
            s -= 0.12
        if SCENE.search(alt):
            s -= 0.18
        if m["n_sig"] >= 2:
            s -= min(0.30, 0.15 * (m["n_sig"] - 1))
        if m["sat"] < 0.06:
            s -= 0.20  # black-and-white / colourless photo
        if alt and rel < 0.5:
            s = min(s, 0.5)
        res.update(m)
        res["score"] = round(s, 3)
    meta_f.write_text(json.dumps(res))
    return res


# --------------------------------------------------------------------------- choose best per rule
def load_exclude():
    f = HERE / "exclude.json"
    return json.loads(f.read_text()) if f.exists() else {}


MAX_PER_KEY = 24


def best_for_rule(rule, per_page, threshold):
    terms = rule["terms"]
    banned = set(load_exclude().get(rule["key"], []))
    stages = [
        [f"{terms[0]} white background"],
        [terms[0]],
        [f"{t} white background" for t in terms[1:]] + terms[1:],
    ]
    seen, best, pool = set(), None, []
    for qs in stages:
        for q in qs:
            data = pexels_search(q, per_page)
            term = q.replace(" white background", "")
            for photo in data.get("photos", []):
                if photo["id"] in seen or photo["id"] in banned or len(seen) >= MAX_PER_KEY:
                    continue
                seen.add(photo["id"])
                r = score(photo, term)
                r["photo"] = {
                    "id": photo["id"],
                    "photographer": photo.get("photographer"),
                    "photographer_url": photo.get("photographer_url"),
                    "pexels_url": photo.get("url"),
                    "alt": photo.get("alt"),
                }
                r["query"] = q
                pool.append(r)
                if best is None or r["score"] > best["score"]:
                    best = r
        if best and best["score"] >= GREAT:
            break
    top = sorted((r for r in pool if r["score"] > 0), key=lambda r: -r["score"])[:4]
    return best, len(seen), top


def finalize(cut, path, size=640, margin=0.08):
    a = np.asarray(cut)[:, :, 3]
    ys, xs = np.where(a > 12)
    crop = cut.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    target = int(size * (1 - 2 * margin))
    scale = target / max(crop.size)
    crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(crop, ((size - crop.width) // 2, (size - crop.height) // 2), crop)
    canvas.save(path, "WEBP", quality=90, method=6)


def review_sheets(results):
    """One row per machine type, its top-4 candidates side by side (cut-outs from the cache)."""
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except Exception:
        font = ImageFont.load_default()
    tile, per_sheet = 230, 6
    keys = sorted(results)
    paths = []
    for s0 in range(0, len(keys), per_sheet):
        chunk = keys[s0 : s0 + per_sheet]
        sheet = Image.new("RGB", (4 * tile + 120, len(chunk) * (tile + 44)), "#cbd5e1")
        d = ImageDraw.Draw(sheet)
        for ri, k in enumerate(chunk):
            y = ri * (tile + 44)
            d.text((6, y + 8), k, fill="#0f172a", font=font)
            for ci, c in enumerate(results[k].get("top", [])):
                x = 120 + ci * tile
                d.rectangle([x + 3, y + 3, x + tile - 3, y + tile + 40], fill="#ffffff")
                try:
                    im = Image.open(CACHE / "cut" / f"{c['id']}.png").convert("RGBA")
                    a = np.asarray(im)[:, :, 3]
                    ys, xs = np.where(a > 12)
                    im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
                    im.thumbnail((tile - 20, tile - 20))
                    sheet.paste(im, (x + (tile - im.width) // 2, y + 8 + (tile - 20 - im.height) // 2), im)
                except Exception:
                    pass
                d.text((x + 8, y + tile - 6), f"#{ci + 1}  id {c['id']}", fill="#0f172a", font=font)
                d.text((x + 8, y + tile + 12), f"score {c['score']:.2f}  rel {c['rel']}", fill="#15803d" if c["score"] >= 0.75 else "#b45309", font=font)
        p = CACHE / f"review_{s0 // per_sheet + 1:02d}.png"
        sheet.save(p)
        paths.append(p)
    return paths


def contact_sheets(sheet_dir, results, rules_by_key, img_dir):
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
    except Exception:
        font = ImageFont.load_default()
    tile_w, tile_h, cols, per_sheet = 250, 290, 6, 24
    keys = sorted(results)
    sheets = []
    for s in range(0, len(keys), per_sheet):
        chunk = keys[s : s + per_sheet]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tile_w, rows * tile_h), "#e2e8f0")
        d = ImageDraw.Draw(sheet)
        for i, k in enumerate(chunk):
            x, y = (i % cols) * tile_w, (i // cols) * tile_h
            d.rectangle([x + 4, y + 4, x + tile_w - 4, y + tile_h - 4], fill="#ffffff")
            r = results[k]
            if r["status"] == "ok":
                im = Image.open(img_dir / r["file"]).convert("RGBA")
                im.thumbnail((tile_w - 24, tile_w - 24))
                sheet.paste(im, (x + (tile_w - im.width) // 2, y + 10), im)
                col = "#15803d" if r["score"] >= 0.75 else "#b45309"
                d.text((x + 10, y + tile_w - 6), f"{k}", fill="#0f172a", font=font)
                d.text((x + 10, y + tile_w + 14), f"score {r['score']:.2f}  rel {r['rel']}", fill=col, font=font)
                d.text((x + 10, y + tile_w + 34), (r["photo"]["alt"] or "")[:34], fill="#475569", font=font)
            else:
                d.text((x + 10, y + 100), "NO GOOD MATCH", fill="#b91c1c", font=font)
                d.text((x + 10, y + tile_w - 6), k, fill="#0f172a", font=font)
                d.text((x + 10, y + tile_w + 14), f"best {r.get('score', 0):.2f}", fill="#b91c1c", font=font)
        p = sheet_dir / f"_contact_sheet_{s // per_sheet + 1}.png"
        sheet.save(p)
        sheets.append(p)
    return sheets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--redo", default="")
    ap.add_argument("--candidates", type=int, default=6)
    ap.add_argument("--finalize", action="store_true", help="build output files for the pinned photos in pins.json")
    args = ap.parse_args()
    load_env()
    out_dir = Path(args.out).resolve()
    rules = [r for r in json.loads(RULES_FILE.read_text()) if not r.get("skip")]
    results_file = CACHE / "results.json"
    results = json.loads(results_file.read_text()) if results_file.exists() else {}

    if not args.finalize:
        if not os.environ.get("PEXELS_API_KEY"):
            sys.exit("Missing PEXELS_API_KEY (put it in tools/equipment-images/.env)")
        only = {k for k in args.only.split(",") if k}
        redo = {k for k in args.redo.split(",") if k}
        t0 = time.time()
        for i, rule in enumerate(rules, 1):
            k = rule["key"]
            if (only and k not in only) or (k in results and k not in redo):
                continue
            best, n, top = best_for_rule(rule, args.candidates, 0)
            results[k] = {"candidates": n, "top": [
                {"id": r["id"], "score": r["score"], "rel": r["rel"], "photo": r["photo"], "query": r["query"], "alt": r["photo"].get("alt")}
                for r in top]}
            results_file.write_text(json.dumps(results, indent=1))
            sc = results[k]["top"][0]["score"] if results[k]["top"] else None
            print(f"[{i:>2}/{len(rules)}] {k:<20} best={sc} cand={n}  {time.time()-t0:.0f}s", flush=True)
        sheets = review_sheets(results)
        print("REVIEW SHEETS:", [str(x) for x in sheets])
        return

    # ---- phase B: only photos that were reviewed and pinned are shipped
    pins = json.loads((HERE / "pins.json").read_text())
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.webp"):
        old.unlink()
    ok = {}
    for k, pid in pins.items():
        if pid is None:
            continue
        entry = next((c for c in results.get(k, {}).get("top", []) if c["id"] == pid), None) or next(
            c for r in results.values() for c in r["top"] if c["id"] == pid
        )
        cut = Image.open(CACHE / "cut" / f"{pid}.png").convert("RGBA")
        finalize(cut, out_dir / f"{k}.webp")
        ok[k] = {"file": f"{k}.webp", "photo": entry["photo"], "score": entry["score"]}
    MAP_FILE.write_text(json.dumps({"images": {k: v["file"] for k, v in sorted(ok.items())}}, indent=1))
    credits = ["Equipment photos are cut-outs of photos from Pexels (https://www.pexels.com), used under the Pexels licence.", ""]
    for k, v in sorted(ok.items()):
        p = v["photo"]
        credits.append(f"{v['file']}: photo by {p['photographer']} ({p['photographer_url']}) - {p['pexels_url']}")
    (out_dir / "CREDITS.txt").write_text("\n".join(credits) + "\n")
    final = {k: {"status": "ok", "file": v["file"], "score": v["score"], "rel": 1.0, "photo": v["photo"]} for k, v in ok.items()}
    sheets = contact_sheets(CACHE, final, {}, out_dir)
    print(f"FINALIZED {len(ok)} images -> {out_dir}; contact sheets {[x.name for x in sheets]}")


if __name__ == "__main__":
    main()
