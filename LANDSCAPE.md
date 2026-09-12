# A living landscape

The scene is a stylized, full-azimuth Florida panorama with rolling hills, cycle trails, a city, elevated metro, railway, clouds, aircraft, balloons, nesting birds, fireflies, and occasional visitors. It does not depict actual Florida terrain or live traffic/weather.

## Sky and appearance

The observer is Orlando: 28.5383° N, 81.3792° W, 20 m elevation. The device clock supplies the current instant; displayed local time uses America/New_York (including daylight saving time). Astronomy Engine calculates topocentric Sun and Moon positions, lunar phase, and seasonal sunrise/set. The sky updates once a minute. Atmospheric refraction is modeled; actual observed rise/set can vary with the local horizon and weather.

The starfield contains 1,289 catalog stars to visual magnitude 4.8. J2000 positions are precessed/nutated to the observation date and projected onto a cylindrical full-azimuth panorama (north at its seam, east left, south center, west right). Only above-horizon stars are drawn, without constellation lines. This preserves a real rotating starfield while compressing it into the available sky; it is scenery, not a calibrated planetarium. Moonlight and low elevation reduce star brightness. The Moon is also visible by day when above the horizon.

Light/Dark/System applies only to the foreground app. It receives a subtle scene tint, while the background always follows the calculated Florida sky. `Enjoy the view` reveals the scenery; `Back to your tasks` returns focus to the originating control.

## Motion and performance

First launch asks for Normal or Reduced motion. Settings and a footer control reopen that choice. A device request for reduced motion always wins, including changes while the app is open. Reduced motion stops all ambient animation; the sky and clock still update once per minute to reflect reality. Before a choice, the scene is still; Escape chooses reduced motion. The preference is device-local, not cloud-synced. If storage is blocked, it still applies for that visit.

Normal motion uses persistent clouds and wind, with fireflies after dusk, plus bounded randomized arrivals. Morning arrivals are more frequent. Rare alien visits have at least seven minutes of active-scene cooldown; the cow is returned unharmed. Returning to a tab refreshes ordinary arrivals without resetting the rare-event cooldown. Hidden tabs stop the animation and astronomy timers.

The scenery uses two local canvases: a cached background and sparse dynamic foreground. The loop is capped at 24 fps, effective DPR at 1.5, each canvas at three million pixels, and transient events at 14. Long suspended intervals are not replayed. All assets are precached for offline PWA use. No runtime landscape API, key, billing or quota is involved.

## Validation

Run `node --test tests.js` for core, scanner and PWA contracts. Browser coverage is opt-in because this repository has no browser package dependency. Serve this directory, then run with an installed Playwright module:

```sh
LANDSCAPE_BROWSER_URL=http://127.0.0.1:8766/ \
LANDSCAPE_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs \
node --test --test-name-pattern='Landscape browser:' tests.js
```

The default browser channel is Chrome; set `LANDSCAPE_BROWSER_CHANNEL` for a compatible installed channel. Browser tests cover first-launch focus, live reduced-motion changes, hidden-tab suspension, independent themes, persistence, overflow, and return navigation. Rendered review additionally covers narrow phones, tablets, wide desktops, short landscape, and day/dawn/dusk/night against both theme modes.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the MIT astronomy library and separately licensed CC BY-SA star data. The original application code remains MIT.
