# GeoProMax: settlement

GeoProMax works out how much the ground settles under footings, rafts, buildings, tanks, pile groups and embankments, how fast, and whether that is within the limits for what is being built. Describe the soil layers and the water table, place the loads on the plan, and the answer updates while you type, on a desktop or a phone: the settlement at any point and over the whole plan, a cross-section with the stress bulbs and the settled ground, and the settlement with time up to the design life.

It runs inside the Project_Management site at `/geopromax`. Pull the site and it is there.

## What it calculates

| | |
|---|---|
| **Soil profile** | Any number of layers, each with unit weights above and below the water table, E (which can grow with depth) and ν, and, for clays, silts and organic soils, Cc, Cr, e0, OCR or POP (or mv from oedometer tests), cv, Cα and drainage through one face or both. 24 typical soils to start a layer from: clays and peat, silts and loess, sands and gravels, fills, residual soil and rocks. |
| **Foundations and loads** | Pad footings (column load), strip footings (wall load per metre), rafts, buildings (storeys times a load per storey), circular tanks, ring foundations, any polygon, embankments and pile groups. Each has a founding depth, can be turned on the plan, be rigid or flexible, use gross or net pressure, and go on at its own time. A form lays out a whole grid of column footings in one go. |
| **Pile groups** | Tomlinson's equivalent raft: at two thirds of the pile length with a 1 in 4 spread for friction piles, at the toes for end-bearing piles. |
| **Stresses** | Boussinesq or Westergaard, from each foundation's founding level. Rectangles are solved exactly by the corner method (Newmark 1935); circles, rings, polygons, turned footings and embankment slopes are split into strips of equal area. |
| **Immediate settlement** | Δσ·h / M in every sub-layer, with the constrained modulus M = E(1−ν)/((1+ν)(1−2ν)). |
| **Primary consolidation** | Cc and Cr about σ'p = OCR·σ'v0 + POP, or mv·Δσ·h, sub-layer by sub-layer. Unloading (an excavation heavier than the building) heaves along Cr. |
| **Rate** | Terzaghi's one-dimensional theory per layer, with wick drains by Hansbo (1981) and Carrillo's rule. Each stage's extra settlement consolidates from the time it goes on. |
| **Creep** | Cα/(1+ep)·h·log(t/t95), once a layer is 95% consolidated; Cα·Cr/Cc where the soil stays overconsolidated (Mesri and Castro 1987). |
| **Convergence** | Sub-layers are refined automatically until the settlement changes by less than 0.5%, and the Checks tab says so. Inputs that cannot be solved, or that put the answer in doubt, are flagged. |
| **Limits** | Pick what is being built (framed building on pads or a raft, masonry, steel shed, tall building, tank, silo, bridge, machine, crane, embankment) and the usual limits on settlement and tilt are set; type your own over them. Every foundation is checked on its own and against its neighbours, and the headline says whether the design is within the limits at the design life. |
| **CSI SAFE link** | Soil and structure solved in turn. Open the Soil Pressures table SAFE exports (the Excel file itself, a CSV, or pasted cells; SAFE 20 and later; any unit system, read from the table's own units row). GeoProMax turns the pressures into the load on the ground, works out the subgrade modulus under every part of the raft (pressure over settlement), bands them into a few soil properties and writes them out for SAFE in the units you choose. Run SAFE again, bring the new pressures in, and the panel shows how far the springs moved each round until they converge. |
| **Plan and section** | Total settlement over a grid at any time, with contours; a cross-section with the foundations at their depths, the piles, the stress bulbs and the settled ground. Play it through time with the time bar. |
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
| Turned footing, ring, L-shaped polygon | The same shapes built from exact rectangles and circles | within 1% |
| Founding depth, net pressure, pad and strip loads | Hand calculation | exact |
| Pile group | Tomlinson's equivalent raft by hand | exact |
| mv consolidation, E growing with depth | Hand calculation | within 0.1 mm |
| Heave under an excavation | Cr·log(σ'f/σ'v0) | within 0.1 mm |
| Wick drains | Hansbo (1981) with Carrillo's rule | within 0.5% |
| Automatic refinement | The same layer cut into 400 sub-layers | within 1% |
| SAFE loop against a rigid raft on springs | Converges in a few rounds to even settlement, with the load kept | within 10% evenness, load exact |
| Rigid square footing | 0.80 of the flexible centre settlement (Bowles) | within 0.05 |

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

GeoProMax gives results for design and checking by an engineer. Strain is taken as one-dimensional, and bearing capacity is not checked.
