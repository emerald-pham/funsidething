# Landscape spawn rates

Edit the Rate column below, then reload. This file is read by the app.
Use 0 to disable, 1 for the default, 0.5 for less, or 2 for more. Values from
0 to 10 are accepted. Keep event IDs and the two-column table intact.
An invalid table is rejected as a whole; missing rows use 1.

Ordinary visitors use relative selection weights, so increasing one reduces
others' share of the same limited visitor budget. Seasonal eligibility still applies.
Train and metro have dedicated seeded-chance service: 65 and 50 seconds baseline
crossing, respectively. Opportunities are one maximum sampled crossing apart
(65/.82 and 50/.82 seconds, rounded upwards to a millisecond to prevent
rounded-lifetime overlap). Admission probability is that rounded interval
divided by the unrounded maximum crossing plus the configured 12 or 8 seconds
divided by the rate. Consequently,
expected start spacing equals the former maximum crossing plus rate-scaled rest;
rest is now an average contribution, not a minimum after every crossing. Only
one vehicle per track runs at once; rate 0 disables admission. A rejection does
not force a later arrival or impose a maximum wait. Painting pauses offscreen;
arrivals and age follow the shared UTC schedule.
Standalone fireworks check every 120 seconds of eligible UTC twilight/nighttime with a
40% chance at rate 1; the first check is after 80 UTC seconds. Each show keeps
its original sampled 60–300-second scheduling reservation, but its visible
shells, flights and bloom tails finish within 60 seconds. The next opportunity
is four times the sampled reservation plus 240 seconds after its start.
Scaling the entire interval, including failed checks, retains the current
four-times-original spacing independently of the shorter display window.
Regular volleys fire two shells; the second has a deterministic seeded
0–300 ms delay. The finale widens through overlapping two-, three- and five-shell volleys,
ending in a closing crown with naturally fading embers before the 60-second display limit. Geometry keeps at most 320 active particles. Arrival timing stays random
and respects the existing scene budget and shared UTC clock; hidden tabs do no painting and reduced motion uses still poses.
Festivals check once per UTC minute at a 1.2% chance, wait at least 30 UTC
minutes between visits, share the seven-minute rare cooldown with alien visits,
and cross the lake on a barge in about 127–183 seconds, depending on the
assigned travel speed (150-second baseline). A festival owns its
fireworks; standalone shows and festivals do not overlap. Both admit sunrise, sunset, and nighttime below the existing +8-degree
full-day boundary, independent of solar direction. Polar daylight remains excluded. Their particle brightness
fades smoothly from full night at -12 degrees to zero at +8 degrees. Rates scale these chances, capped at 100%.
The barge display follows its actual crossing duration. Its staged finale
builds to the five-shell closing crown at 65% of that crossing while its
launchers are still visible. Travel speed, duration and cooldown stay unchanged. Fairy lights
retain independent one-minute nighttime sampling with one-in-six activation
odds. Skyline windows use independent seeded state samples in normalized window
space. The current 7.5-second UTC tick is retained. A per-window seeded phase
spreads opportunities; each opportunity samples 50% lit, 50% dark. Opportunities
are 512 ticks apart (3840 seconds); a 50% change probability preserves the
existing doubled mean toggle spacing of 7680 seconds and the former parity
rule’s 50% long-run lit occupancy. Equal successive states are valid: no parity flip,
backwards-search fallback or maximum-wait transition forces a change. Daylight
eligibility and brightness stay unchanged.
Distant rain-storm lightning uses 23.5-second opportunities with a 50% seeded
admission chance, retaining the previous 47-second mean strike spacing. Each
weather episode has a seeded phase and independent strike/position draws.
The .28-second three-segment bolt, storm intensity, snow exclusion, reduced-motion
exclusion and absence of full-screen flashes remain unchanged.
Woodland rows control the separate animal pool (default: 1% chance per 30 seconds).
Clocktower visits check once per UTC nighttime minute with a 2% chance at
rate 1, about one visit per 50 UTC night minutes. Peter Pan, Wendy, John and
Michael arrive separately, rest on the sloped roof, and depart within 50 seconds.
Daylight hides the visit; hidden tabs pause painting and reconstruct current visits on return. Reduced motion keeps the four
roof silhouettes stationary with a gentle fade. The rate scales only the rare
start chance; it never changes their flight speed or the number of children.
Weather rows scale episode chances, capped at 100%; durations remain unchanged.
Ambience rows scale seasonal particle cycle speed (0 hides particles).
All safety caps, reduced-motion preferences, and season rules remain in effect.

The banner event is the message-towing biplane; airshow is the aerobatic plane.
Skywriters trace one valid human word from the local Skywriters bank in smoke.
The shared renderer samples this bank without filtering private reading history,
so reading cannot suppress an admitted aircraft or change its smoke geometry.
With no valid word, the admitted aircraft crosses without smoke lettering; the
skywriter rate cannot create fallback words. The current flight reconciles a
newly loaded human bank immediately rather than retaining empty boot copy;
matching smoke geometry requires matching loaded banks. Other local message selection retains
its nonrepeat history. Neither reading history nor human wording is newly synced.
Cloud movement, astronomical objects, and the clock are continuous scenery,
not spawned visitors. Text itself is edited in HUMAN_WRITTEN_HOURLY_TAGS.md.

When publishing edits, refresh the service-worker and changelog fingerprints
and deploy this file with the app so installed offline copies receive it.

| Event | Rate |
| --- | --- |
| cyclist | 1 |
| bird | 1 |
| balloon | 1 |
| train | 1 |
| metro | 1 |
| plane | 1 |
| duck | 1 |
| fish | 1 |
| butterfly | 1 |
| rabbit | 1 |
| deer | 1 |
| kite | 1 |
| reader | 1 |
| picnic | 1 |
| couple | 1 |
| walker | 1 |
| airshow | 1 |
| banner | 1 |
| skywriter | 1 |
| hangglider | 1 |
| jetski | 1 |
| sailboat | 1 |
| cruise | 1 |
| yacht | 1 |
| dolphin | 1 |
| flock | 1 |
| skateboarder | 1 |
| rollerskater | 1 |
| hoverboard | 1 |
| scooter | 1 |
| windsurfer | 1 |
| dogwalker | 1 |
| snowman | 1 |
| skier | 1 |
| snowangel | 1 |
| meteor | 1 |
| abduction | 1 |
| fireworks | 1 |
| festival | 1 |
| clocktower-visit | 1 |
| woodland-deer | 1 |
| woodland-fox | 1 |
| woodland-rabbit | 1 |
| woodland-raccoon | 1 |
| rain | 1 |
| thunderstorm | 1 |
| snow | 1 |
| snowstorm | 1 |
| ambience-spring | 1 |
| ambience-summer | 1 |
| ambience-autumn | 1 |
| ambience-winter | 1 |
