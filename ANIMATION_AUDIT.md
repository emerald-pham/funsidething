# Animation audit — September 13, 2026

This audit covers the current animation catalog, complete event lifetimes, direction and randomized variants, ambient scenery, interaction layering, and motion controls. It extends the earlier repairs to frame pacing, tab continuity, pedaling, deer leg attachment, bird departures, and dog paw contact.

## Coverage

The deterministic renderer sweep exercises 121 evenly spaced points from birth through expiry for every type below, both directions, seeds 0 / 0.551 / 0.999, lanes 0 / 0.5 / 0.999, and short / nominal / long durations (0.8 / 1 / 1.2). Chrome and WebKit run at 320×568, 844×390, and 1440×900. It checks finite drawing coordinates, balanced canvas save/restore, opacity, transforms, and stroke caps after every frame. Day-only and night-only visitors are evaluated under their visibility condition.

Enlarged rendered sequences and boundary frames complement the numerical sweep. Numerical validity alone does not establish visual correctness. Normal and reduced motion are checked separately, as are local verification and deployed/offline verification.

| Family | Every catalog member included | Visual checks |
| --- | --- | --- |
| Path travelers | cyclist, skateboarder, rollerskater, walker, dogwalker | Entry/exit, direction, gait, wheels/feet, hills, packs/companions |
| Meadow animals | rabbit, deer | Hop/stride cycles, slope attachment, ground contact, fades |
| Stationary visitors | reader, picnic, couple, kite | Entrance/exit fades, seated poses, props, kite/string continuity |
| Birds/insects | bird, flock, butterfly | Nest arrival/perching/departure, paired birds, flock formation, wing folding |
| Rail transport | train, metro | Carriage spacing, full tail exit, track alignment, tree occlusion |
| Aircraft | plane, airshow, banner, hangglider, balloon | Direction, smoke/banner attachment, formation, drift and offscreen boundaries |
| Water visitors | jetski, sailboat, cruise, yacht, windsurfer, duck, fish, dolphin | Shore clearance, wakes, bobbing/courses, jumps, facing, overlap depth |
| Rare/night events | meteor, fireworks, abduction | Full emergence/decay, burst sequence, beam/pickup/return/departure |

There are **32 distinct event types**: 29 regular types, meteors, and two rare types. Random seed/lane/time inputs are continuous; this is a full catalog and boundary audit with a defined variation matrix, not a claim to have viewed every possible random frame.

## Ambient and UI coverage

Source review covered cloud drift and wraparound; sun, moon, stars and clock refresh; city windows; sun/star/city water reflections; ripples and wakes; fountain jets; wind grass; fireflies; cached layer clipping and draw order; scheduling and event limits. Browser checks covered noon, sunset and midnight, scene-only and scanner views, normal/reduced motion, live preference changes, hidden-tab pause/resume, phone/short-landscape/desktop layouts and high-DPR sizing. No further clipping or lifecycle defects were found in that matrix.

The scanner review included scene-view fades, row highlighting, toast fade/translation, progress-bar width, action opacity/focus restoration, button press transforms, and programmatic task-reveal scrolling. Reduced scrolling was reproduced and checked after repair in Chrome and WebKit.

## Confirmed defects repaired in this pass

| Defect | Repair and regression coverage |
| --- | --- |
| Fish popped in/out fully opaque and reverse fish still moved right | Fade the local breach at both endpoints and honor direction; test endpoints, near-endpoints, mid-flight and both directions |
| UFO cow/beam appeared and disappeared abruptly; reverse UFO flew the same way | Separate the cow's lifetime from the beam, ease the beam, keep the returned cow on its ground anchor, and honor UFO direction; test pickup/return boundaries and offscreen entry/exit |
| Rear water visitors could paint over nearer boats | Unify boats, ducks, fish and dolphins into a waterline-depth-sorted pass; test both arrival orders, all eight water types and three viewports; visually confirm rear duck/front sailboat |
| Flying birds leaked rounded stroke caps into later scenery | Save and restore bird drawing state; test flying/perched variants and pre-existing cap styles |
| Revealing a task still animated scrolling under Reduced motion | Use an immediate scroll unless Normal motion is explicitly selected and the device permits it; test app/device preferences and verify real scroll positions in both browsers |

## Final validation

The final deterministic sweep completed **1,254,528 frame cases**, covering all 32 types with no invalid coordinates, unbalanced canvas state, opacity/transform leaks, or stroke-cap leaks. This is automated frame coverage, not a claim that a person watched one million images. Visual inspections use enlarged sequences, phase boundaries, representative overlaps and full scene layouts.

The final repository suite passed **590 tests with zero failures and zero skips**, including the opt-in browser tests. Service-worker cache fingerprints are regenerated for the changed shell; deployment and offline reload are verified separately after push.
