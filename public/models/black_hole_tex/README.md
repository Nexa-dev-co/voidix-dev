# black_hole_tex

**Nothing here is loaded by the app right now.** These three files are kept for one open question — see
below. If that question resolves the other way, delete this folder.

## History

`black_hole.glb` used to ship raw Sketchfab spec/gloss materials, which three.js has been unable to read
since r151 (`KHR_materials_pbrSpecularGlossiness` was removed). Every colour and all 12 textures were
silently discarded at load, so `useSunLabScene.ts` hand-rebuilt the materials and side-loaded copies of
the textures from this folder.

That is gone. The model is now converted to real metallic-roughness at build time — see the `specGloss`
recipe in `scripts/optimizeModels.mjs` — so three loads its own colours and textures natively, and the
diffuse copies that used to live here were deleted as dead weight.

## The open question: `*_emissive_mask.png`

The glow domes (`light1/2/3`) wrap over the black-hole sphere, and the model's real emissive maps colour
that over-the-hole face **blue**. These masks are those maps reprocessed to neutral greyscale where the
disc glows and pure black over the hole.

Sketchfab's own render does not show that face as blue, and **we do not know why.** The obvious
explanation was ruled out: the domes are `alphaMode: MASK`, but 0% of their diffuse alpha falls below the
cutoff, so nothing is being discarded. The remaining candidates are additive blending washing it out
against black, or UVs placing it on the far side.

So the plan is deliberately *not* to reapply these at load time — that was the hidden force we removed.
Look at the converted model first, try the material `blending` control (Normal / Additive / Multiply, now
in the lab's material panel), and only if the blue genuinely survives should these come back — as an
explicit toggle, not a load-time rewrite.

Regenerate from `temp/black_hole/textures/*_emissive.png` (blue-dominant pixels → black, rest → luminance):

```python
from PIL import Image
for name in ["black_hole_light1", "black_hole_light2", "black_hole_light3"]:
    im = Image.open(f"temp/black_hole/textures/{name}_emissive.png").convert("RGB")
    px = im.load(); w, h = im.size
    out = Image.new("RGB", (w, h)); op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if b > r * 1.05 and b > g * 0.9:
                op[x, y] = (0, 0, 0)
            else:
                lum = int(0.299 * r + 0.587 * g + 0.114 * b)
                op[x, y] = (lum, lum, lum)
    out.save(f"public/models/black_hole_tex/{name}_emissive_mask.png")
```

## Attribution — required

The model is **"Black Hole" by NestaEric**, licensed **CC-BY-4.0**, which *requires* credit wherever it
is shared. Full text: `models-src/black_hole-LICENSE.txt`.

> This work is based on "Black Hole"
> (https://sketchfab.com/3d-models/black-hole-e410da98b1e5445eae2acafaaa53587d) by NestaEric
> (https://sketchfab.com/Nestaeric) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)
