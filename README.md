# GeoProMax: settlement

GeoProMax works out how much the ground settles under foundations, tanks and embankments, and how fast. Describe the soil layers and the water table, place the loads on the plan, and the answer updates while you type, on a desktop or a phone: the settlement at any point and over the whole plan, a cross-section with the stress bulbs and the settled ground, and the settlement with time up to the design life.

It runs inside the Project_Management site at `/geopromax`. Pull the site and it is there.

## What it calculates

| | |
|---|---|
| **Soil profile** | Any number of layers, each with unit weights above and below the water table, E and ν, and, for clays, silts and organic soils, Cc, Cr, e0, OCR or POP, cv, Cα and drainage through one face or both. Ten typical soils to start a layer from. |
| **Loads** | Rectangles, circles and embankments (crest, side slopes, height and fill unit weight), anywhere on the plan, each switched on or off and each applied at its own time, so a fill built in stages is a set of loads. |
| **Stresses** | Boussinesq or Westergaard. Rectangles are solved exactly by the corner method (Newmark 1935), so a point beside a load is as exact as one under it; circles are split into 40 strips of equal area and embankment slopes into 20 steps. |
| **Immediate settlement** | Δσ·h / M in every sub-layer, with the constrained modulus M = E(1−ν)/((1+ν)(1−2ν)). |
| **Primary consolidation** | Cc and Cr about σ'p = OCR·σ'v0 + POP, sub-layer by sub-layer. |
| **Rate** | Terzaghi's one-dimensional theory per layer. Each stage's extra settlement consolidates from the time it goes on. |
| **Creep** | Cα/(1+ep)·h·log(t/t95), once a layer is 95% consolidated. |
| **Plan** | Total settlement over a grid at any time, with contours, the largest settlement and the steepest tilt (checked against 1/500 and 1/300). Play it through time with the time bar. |
| **Report** | A printable report (save it as PDF), the results table as CSV, and the project as a JSON file. |

All calculations run in the browser (`geopromax_app/static/engine`, plain ES modules with no build step). The plan grid and the section are worked out in a Web Worker, so the page never freezes. The same engine files are tested in Node. The Flask server only serves the page and keeps each person's projects, with version history (Projects, History). Undo and redo work across every input (Ctrl+Z, Ctrl+Shift+Z).

## Verification

The **Verification** tab runs these checks in the browser, and CI runs the same checks on every push.

| Check | Reference | GeoProMax |
|---|---|---|
| Corner of a rectangle, m = n = 0.5, 1, 2 | Newmark (1935) chart values | within 5e-4 |
| Point beside a rectangle | Boussinesq point load, integrated numerically | within 0.02 kPa |
| Centre of a circle, z = R and 2R | q[1 − (1 + (R/z)²)^−1.5] | within 0.3 kPa |
| Centre of a long embankment | Osterberg (1957) | within 0.4 kPa |
| Westergaard corner, ν = 0 and 0.3 | Westergaard point load, integrated | within 3e-4 |
| U at Tv = 0.197 and 0.848 | Terzaghi: 50% and 90% | within 0.2% |
| Normally and over-consolidated clay | Hand calculation | within 0.1 mm |
| Settlement at t50 | Half the final | within 1 mm |
| Elastic layer under a wide load | Δσ·H / M | exact |
| Secondary compression | Cα·H/(1+ep) per log cycle | within 0.2 mm |
| Two load stages | One load of their sum | exact |

## Run it alone

```bash
pip install -r requirements.txt
GEOPROMAX_DEV_ACCOUNT=me python -m geopromax_app      # http://127.0.0.1:5062
```

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest -q                    # the server, plus the engine tests through Node
node --test tests/engine.test.mjs      # the engine alone
```

## How it fits into Project_Management

Project_Management keeps a copy of `geopromax_app/` and mounts it at `/geopromax` with `app/geopromax_door.py`, the same way as Talus. The site handles sign-in and access (the `geopromax` program in Setup) and passes the account to GeoProMax in the request (`geopromax.site`). Projects live in the site's data folder under `geopromax/`.

To update the site, copy `geopromax_app/` across and commit it there.

GeoProMax gives results for design and checking by an engineer. Loads are taken as flexible: a stiff raft settles more evenly than the plan shows.
