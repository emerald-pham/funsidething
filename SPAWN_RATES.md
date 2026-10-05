# Landscape spawn rates

Edit the Rate column below, then reload. This file is read by the app.
Use 0 to disable, 1 for the default, 0.5 for less, or 2 for more. Values from
0 to 10 are accepted. Keep event IDs and the two-column table intact.
An invalid table is rejected as a whole; missing rows use 1.

Ordinary visitors use relative selection weights, so increasing one reduces
others' share of the same limited visitor budget. Seasonal eligibility still applies.
Train and metro have dedicated service: about 65 and 50 seconds crossing,
respectively, followed by 12 and 8 seconds of rest at rate 1. Their rate divides
that rest time; only one vehicle per track runs at once. Motion pauses offscreen.
Standalone fireworks check every 30 seconds of active nighttime viewing with a
40% chance at rate 1. Each show independently samples a duration from 60 to
300 seconds, continues bursting behind the city, then rests for 60 seconds
after its actual end. The first check is after 20 active seconds. Arrival
timing stays random and respects the scene budget.
Festivals check once per active minute at a 0.6% chance, wait at least 30 active
minutes between visits, share the seven-minute rare cooldown with alien visits,
and cross the lake on a barge in about 127–183 seconds, depending on the
assigned travel speed (150-second baseline). A festival owns its
fireworks; standalone shows and festivals do not overlap. Both require the Sun
below civil twilight. Rates scale these chances, capped at 100%.
Woodland rows control the separate animal pool (default: 1% chance per 30 seconds).
Clocktower visits check once per visible nighttime minute with a 2% chance at
rate 1, about one visit per 50 active night minutes. Peter Pan, Wendy, John and
Michael arrive separately, rest on the sloped roof, and depart within 50 seconds.
Daylight cancels the visit; hidden tabs pause it. Reduced motion keeps the four
roof silhouettes stationary with a gentle fade. The rate scales only the rare
start chance; it never changes their flight speed or the number of children.
Weather rows scale episode chances, capped at 100%; durations remain unchanged.
Ambience rows scale seasonal particle cycle speed (0 hides particles).
All safety caps, reduced-motion preferences, and season rules remain in effect.

The banner event is the message-towing biplane; airshow is the aerobatic plane.
Skywriters trace one human word in smoke. They appear only when the Skywriters
bank has an unseen valid word; the skywriter rate cannot create fallback words.
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
