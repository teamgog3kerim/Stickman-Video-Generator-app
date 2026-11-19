---
name: ImageMagick SVG backgrounds
description: Reliable photo background embedding for the SVG-to-MP4 renderer.
---

Use optimized `data:image/...;base64` sources when an SVG rendered by ImageMagick needs a local photo background. Relative or file-based `<image href>` links rendered blank in this workspace, while data URIs worked.

**Why:** The cinematic video renderer needs bundled photographs to appear consistently in every generated frame.

**How to apply:** Resize/compress background assets first, embed the resulting data URI in generated SVG, then verify with an actual MP4 render and extracted frame.
