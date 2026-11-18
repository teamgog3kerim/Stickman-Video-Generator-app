---
name: FFmpeg scene transitions
description: Reliable transition timing for SVG-generated, animated scene clips.
---

When stitching SVG-generated scene clips with FFmpeg `xfade`, keep image-sequence inputs finite and append explicit repeated hold frames to outgoing scenes before the crossfade. In this renderer's concat/zoompan pipeline, relying on `tpad` after the animated clip caused the transition stream to stall before the next scene completed. Reset timestamps to a continuous frame timeline after `zoompan`.

**Why:** A multi-scene preview stalled while the renderer waited for transition frames; explicit finite tails rendered at the requested duration in both portrait and landscape tests.

**How to apply:** Preserve the explicit hold-segment approach for non-cut transitions, keep the overlap length in sync with the hold-frame count and FPS, and verify final MP4 duration with `ffprobe`.
