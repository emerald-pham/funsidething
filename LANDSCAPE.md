# A living landscape

The scene is a stylized, full-azimuth Florida panorama with rolling hills, cycle trails, a city, elevated metro, railway, clouds, aircraft, balloons, nesting birds, fireflies, and occasional visitors. It does not depict actual Florida terrain or live traffic/weather.

## Sky and appearance

The observer is Orlando: 28.5383° N, 81.3792° W, 20 m elevation. The device clock supplies the current instant; displayed local time uses America/New_York (including daylight saving time). Astronomy Engine calculates topocentric Sun and Moon positions, lunar phase, and seasonal sunrise/set. The sky updates once a minute. Atmospheric refraction is modeled; actual observed rise/set can vary with the local horizon and weather.

The starfield contains 1,289 catalog stars to visual magnitude 4.8. J2000 positions are precessed/nutated to the observation date and projected onto a cylindrical full-azimuth panorama (north at its seam, east left, south center, west right). Only above-horizon stars are drawn, without constellation lines. This preserves a real rotating starfield while compressing it into the available sky; it is scenery, not a calibrated planetarium. Moonlight and low elevation reduce star brightness. The Moon is also visible by day when above the horizon.

At night, the lake samples the actual painted sky in narrow moving bands. The Moon, stars, airplanes, balloons, birds, skywriting, and any future object above the horizon therefore share one reflection rule. Perspective and the shoreline mask decide whether an object is close enough to the horizon to reach visible water. Boats mirror their complete silhouette downward from their own waterline, with wave-softened compression.

Light/Dark/System applies only to the foreground app. It receives a subtle scene tint, while the background always follows the calculated Florida sky. `Enjoy the view` reveals the scenery; `Back to your tasks` returns focus to the originating control.

## Motion and performance

First launch asks for Normal or Reduced motion. Settings and a footer control reopen that choice. A device request for reduced motion always wins, including changes while the app is open. Reduced motion stops all ambient animation; the sky and clock still update once per minute to reflect reality. Before a choice, the scene is still; Escape chooses reduced motion. The preference is device-local, not cloud-synced. If storage is blocked, it still applies for that visit.

Normal motion uses persistent clouds and wind, with fireflies after dusk, plus bounded randomized arrivals. Morning arrivals are more frequent. Rare alien visits have at least seven minutes of active-scene cooldown; the cow is returned unharmed. Standalone fireworks have independent 40% checks every 30 active nighttime seconds. Each show samples a duration from one to five minutes at arrival, repeats bursts behind the city, and rests for one minute after its actual end. The rarer festival barge has 0.6% minute checks, waits at least 30 active minutes between visits, and shares the seven-minute cooldown with alien visits. Its complete hull, stage, crowd and launch racks use the same depth scale as the other large boats. It sails fully on and off screen with a complete stage, swaying crowd, steady LEDs and slow light beams, with no strobes. Its 150-second baseline crossing varies with its assigned vehicle speed; hull, wake, passengers and launch racks stay attached. Both displays launch visible shells into colored trails, let every burst fade, and enter the same water mirror as the skyline. City silhouettes hide random-show sparks; barge fireworks stay in the foreground. The stage and hull reflect about their own waterline; fireworks enter the shared sky mirror. Uneven bursts leave curved ballistic trails and fading embers. The last shells finish before the barge exits. Returning to a tab resumes existing visitors without resetting the rare-event cooldown. Hidden tabs stop the animation and astronomy timers.

Every arrival is assigned a travel speed between 82 and 118 percent of the baseline, so a later fast visitor can overtake a slower one. Moving people and animals also use deterministic, seeded pace curves that gently speed up and slow down during each finite visit. Vehicles hold their assigned speed on the horizontal axis while their vertical movement may still vary with water, air, or terrain. Routes remain forward-only and keep their exact entrance and exit. The existing lower tram cars are joined by small couplers; the vehicle models and the flyers/train/tram depth order remain unchanged. Airplane banners transition from light fabric in daylight to dark blue fabric with light lettering as night falls.

The scenery uses two local canvases: a cached background and sparse dynamic foreground. The loop is capped at 30 fps, effective DPR at 1.5, each canvas at three million pixels, and transient events at 14. Tab switches preserve active visitors and their progress. Long suspended intervals are not replayed. All assets are precached for offline PWA use. No runtime landscape API, key, billing or quota is involved.

Cyclists pedal through a complete crank rotation. Deer legs share the body’s slope transform, dogs plant their paws according to distance traveled, and nesting birds perch before taking off and leaving the scene.

Distant facades have restrained, stable color variation. Shorter buildings favor brick; taller towers favor modern glass and metal. One exposed window toggles every 30 active nighttime seconds, and the cached skyline and reflection update together. Windows hidden behind nearer buildings or the clock tower are excluded from selection. Do not add low-rise housing behind the metropolis: the user rejected a prior background infill attempt. Metropolis foreground microtrees are also excluded, while the existing hill and woodland trees remain. Each eligible garden and patio string starts with an independent one-in-twelve chance of being lit, so all-on and all-off skylines remain possible. Opportunities stay spaced two minutes apart on the visible scene clock; at each nighttime opportunity, one eligible garden or patio string is independently resampled with that same one-in-twelve chance. Its state and cached reflection change only if the new outcome differs. Lit samples survive repaint and resize, but all illuminated garden fixtures and patio strings are hidden in daylight. Some eligible shorter towers may have rooftop patios with warm fairy strings; at most one eligible shorter, non-rod roof can host a temporary party. The independent scheduler has a 2% chance every 30 visible nighttime seconds, runs for 24 visible seconds, and waits another 30 night seconds after expiry. Selection covers all structurally eligible roofs, including gardens/plain roofs, and does not share the festival/firework cooldown. Daylight or a resize that invalidates the selected roof cancels the event. Its dynamic spotlight cones are reflected with the life layer, hidden tabs pause without catch-up, and reduced motion keeps a static pose while the event still expires. See [SCENERY_GUIDELINES.md](SCENERY_GUIDELINES.md) for the visual acceptance checklist and known failure patterns.

## Validation

Run `node --test tests.js` for core, scanner and PWA contracts. Browser coverage is opt-in because this repository has no browser package dependency. Serve this directory, then run with an installed Playwright module:

```sh
LANDSCAPE_BROWSER_URL=http://127.0.0.1:8766/ \
LANDSCAPE_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs \
node --test --test-name-pattern='Landscape browser:' tests.js
```

The default browser channel is Chrome; set `LANDSCAPE_BROWSER_CHANNEL` for a compatible installed channel. Browser tests cover first-launch focus, live reduced-motion changes, hidden-tab suspension, independent themes, persistence, overflow, and return navigation. Rendered review additionally covers narrow phones, tablets, wide desktops, short landscape, and day/dawn/dusk/night against both theme modes.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the MIT astronomy library and separately licensed CC BY-SA star data. The original application code remains MIT.

Rain uses both viewport width and area for a dense, bounded curtain, including tall phones. Falling rain paints once over the complete scene and lake, without mirrored upward streaks. Reflected clouds, snow, and lightning retain their established behavior.
