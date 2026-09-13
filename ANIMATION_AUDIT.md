# Landscape tuning audit — September 13, 2026

This pass preserves the existing palette, scene composition, ordinary visitor cadence, and reduced-motion behavior. It checks scale, visitor lifetimes, astronomy, and the added occasional wildlife and rain.

## Scale and lifetimes

| Family | Members reviewed | Result |
| --- | --- | --- |
| Path travelers | cyclist and packs, skateboarder, rollerskater, walker, dogwalker | Cyclist hips now connect to fixed-length, forward-bending legs throughout the pedal revolution. Existing path scales remain coherent. Through-travelers exit the viewport; local walkers continue walking while fading into the scenery. |
| Meadow animals | rabbit, deer | Existing local routes, ground contact, and discreet entrance/exit fades retained. |
| Seated visitors | reader, picnic, couple, kite | Arrival, activity, packing, standing, and walking-away phases. Blankets fold, food is gathered, books are carried, and kites are reeled in. Direction, hand/string attachment, gait transitions, and moving depth are checked. |
| Birds and insects | bird, flock, butterfly | Nest visits end with takeoff; flocks and butterflies travel out of view. Their established size hierarchy is retained. |
| Rail transport | train, metro | The farther metro is reduced to 72% of its previous carriage scale, including spacing and strokes. The foreground train keeps its size. Both remain aligned with their rails. |
| Aircraft | plane, airshow, banner, hangglider, balloon | Existing silhouettes represent different distances; altitude lanes alone are not treated as distance. Banner, smoke, pilot, and basket stay attached. Offscreen travel or effect fade completes each visit. |
| Water visitors | jetski, sailboat, cruise, yacht, windsurfer, duck, fish, dolphin | Water lanes now scale vessels with distance. Small craft remain much smaller than ships, even across opposing depth lanes; wakes scale too. Dolphin/fish lanes describe horizontal routes at fixed water depth. Ducks may take off continuously from their swimming position, with staggered companions. Fish and dolphins finish local breaches with fades. |
| Rare effects | meteor, fireworks, abduction | Finite streak/burst/pickup-and-return sequences; existing fades and departures retained. |
| Foreground wildlife | deer, fox, rabbit, raccoon | Separate pool and random source: one 1% roll every 30 seconds, at most one arrival per successful roll, four animals maximum, three-minute visits. No initial guaranteed animal and no effect on ordinary spawn odds or capacity. Slow walks fade in/out among foreground trees. |
| Ambient scene | clouds, water, reflections, wind grass, fireflies, fountain, stand | These are scenery or repeating ambient processes, not unexpired visitor events. They intentionally remain, while visitors renew. |
| Rain | gentle streaks and a faint atmospheric tint | Episodes ease in and out. A fixed UTC schedule gives the same weather status on all devices, independent of login, storage, location, and locked scene time. Twenty percent of half-hour slots contain a twelve-minute shower; this is decorative weather, not a forecast. Correct device clocks are required for agreement. Reduced motion uses stationary streaks. |
| App UI | fades, toast/row transitions, button states, scrolling | Existing behavior and reduced-motion contracts retained. |

Every ordinary/rare visitor still has a finite duration. Normal motion advances their ages and removes expired events. Pausing or hiding the app preserves visits without accumulating missed spawns. Ordinary singleton/water caps can intentionally skip a spawn opportunity; ambient movement continues. These limits preserve the existing density and atmosphere.

## Astronomy

Season names now change at Astronomy Engine's computed equinox/solstice instant, rather than fixed dates. Both hemispheres share that instant; their names differ, and time zones determine its local calendar date. Palette blending remains gentle around boundaries.

Sunrise and sunset use the observer's coordinates and local calendar day, including DST, date-line zones, and polar absence of events. Seasonal solar locks construct the representative date in the observer's time zone. Fixed `HH:MM` scene locks intentionally use the device's local clock, as labeled; standard JavaScript DST normalization applies to a nonexistent local hour. A time-zone field permits correcting an observer/device-zone mismatch without a network geocoder.

Sun/Moon positions use topocentric coordinates, date-of-observation equatorial transforms, and atmospheric refraction. Star positions retain the J2000-to-date rotation. The public star helper now correctly accepts an explicit Astronomy Engine rotation object. Lunar illumination uses the library's physical illuminated fraction, and its bright limb faces the Sun in the observer's sky. Midnight sun is classified as daylight.

Reference fixtures: [USNO 2026 Earth seasons](https://aa.usno.navy.mil/calculated/seasons?dst=false&submit=Get+Data&tz=0&tz_label=true&tz_sign=1&year=2026), [Astronomy Engine API](https://github.com/cosinekitty/astronomy/blob/master/source/js/README.md). Calculations remain bundled and offline; no weather or astronomy API is called at runtime. The panoramic scene and celestial disk sizes are illustrative, not an angularly calibrated planetarium.

## Verification

Test-first failures were observed for the new controls, missing changelog, hip geometry, water depth scale, duck takeoff, fixed season boundaries, observer-date solar locks, explicit star rotation, independent wildlife scheduling, guest departure, rain scheduling, timezone edits, lunar illumination, reverse kite attachment, and polar daylight.

Chrome and WebKit each completed a 6,534-case sprite sweep over 33 ordinary/foreground visitor variants, three viewport sizes (320×568, 844×390, 1440×900), both directions, three lanes, and eleven lifecycle points. No invalid drawing coordinates or page errors were reported. Five contact sheets at a common drawing scale were visually inspected, including packing/departure, duck flight, boat proportions, and all four foreground animals. Separate screenshots check full-scene composition and time controls on phone and desktop. These checks supplement rather than replace the existing rare-effect and lifecycle regression tests.

The final repository suite passed 632 tests with no failures or skips, including all enabled browser tests. Chrome and WebKit passed day/night, reduced-motion/resume, overflow, and page-error checks at desktop, phone, and short-landscape sizes. Two isolated browser contexts with New York and Tokyo time zones and different scene locks agreed on rain and clear weather; reduced rain stayed still. A local service-worker-controlled offline reload restored the current changelog, season lock, wildlife, and weather assets. Independent review found a polar-season fallback mismatch; it was repaired and regression-tested. Deployment is verified separately in the delivery result.

## Changelog maintenance

Settings renders the dated entries in `#appChangelog`. Add an outcome-focused entry for each app change. The changelog test fingerprints every precached app asset plus the service worker (normalizing the changelog block and cache key to avoid circular hashes), so an unrecorded source change fails validation. Refresh the entry's `data-app-fingerprint` after writing the entry, then refresh the service-worker shell fingerprint. The latter includes the changelog itself, ensuring installed/offline devices receive the updated history.
