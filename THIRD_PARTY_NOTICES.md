# Third-party notices

The repository's MIT license covers original Chain Scanner application and landscape code. Third-party software and data retain their own licenses; the root MIT license does not relicense the HYG star catalog.

## Astronomy Engine 2.1.19 — MIT

`vendor/astronomy.min.js` is the unmodified browser bundle from the `astronomy-engine` npm package, version 2.1.19. Copyright Don Cross; the bundle retains its original 2019–2023 notice. The separately supplied upstream license retains its 2019–2025 notice.

- Project: https://github.com/cosinekitty/astronomy
- Source commit: `61dc07020aaa6885d2c7f688a4d82beaf6edb9ef` (tag `v2.1.19`).
- Package: https://registry.npmjs.org/astronomy-engine/-/astronomy-engine-2.1.19.tgz
- Bundle SHA-256: `f41139a87941ea017ab902b954c9389fa27ea72083d7fab4971756d7769d14e6`.
- Full license: [vendor/astronomy-LICENSE](vendor/astronomy-LICENSE).

## HYG Database v4.1 — CC BY-SA 4.0

`stars.js` contains an adapted subset of the HYG Database by David Nash / Astronexus, which combines the Hipparcos, Yale Bright Star, and Gliese catalogs. This adapted data remains licensed under **Creative Commons Attribution-ShareAlike 4.0 International**, separately from the application code.

- Attribution: David Nash / Astronexus, HYG Database v4.1.
- Upstream archive: https://github.com/astronexus/HYG-Database
- Current project: https://codeberg.org/astronexus/hyg
- Exact input: https://github.com/astronexus/HYG-Database/blob/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg/CURRENT/hygdata_v41.csv
- Source SHA-256: `d9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd`.
- Changes: remove the Sun entry; retain stars with visual magnitude at most 4.8; retain J2000 right ascension (hours), declination (degrees), visual magnitude and B−V color index; sort by brightness; serialize 1,289 numeric rows into a JavaScript data assignment. The Sun is calculated independently.
- License summary: https://creativecommons.org/licenses/by-sa/4.0/
- Full legal code: [vendor/CC-BY-SA-4.0.txt](vendor/CC-BY-SA-4.0.txt).
- Original upstream notice: [vendor/HYG-LICENSE](vendor/HYG-LICENSE).

Redistributed adaptations of this catalog must preserve attribution, identify changes, and comply with the same ShareAlike terms. No endorsement by the catalog authors is implied.

## Reference calculations and existing services

Seasonal sunrise/sunset test fixtures were checked against the U.S. Naval Observatory Astronomical Applications one-day tables for Orlando (28.54 N, 81.38 W), 2026. These are constants in the tests, not runtime requests: https://aa.usno.navy.mil/data/RS_OneDay

The original application's links to Mark Forster and spawelo describe inspiration. Existing externally served Google Fonts and Firebase libraries retain their upstream terms. No font binaries or Firebase SDK copies are included in this feature's vendored assets.
