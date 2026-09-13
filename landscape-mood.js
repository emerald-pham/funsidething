/* Gentle time, season and colour cues for the living landscape.
   This module has no DOM, network or scanner-state dependency so it can be
   loaded by the scenery and exercised offline in a small browser context. */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const DAY = 86400000;
  const DEFAULT_TIMEZONE = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  })();

  const NORTHERN_NAMES = ['spring', 'summer', 'autumn', 'winter'];
  const SOUTHERN_NAMES = ['autumn', 'winter', 'spring', 'summer'];
  const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
  const TRANSITION_DAYS = 14;

  // These are intentionally soft accents. LivingSky already handles the
  // brightness of the sky; mood adds a quiet seasonal cast without replacing
  // that calibrated day/night contrast.
  const ACCENTS = {
    spring: { sky: '#b9dfd2', city: '#a9cec5', far: '#b8d99f', hill: '#9fce94', front: '#79b88b', tint: '#cfe8c4' },
    summer: { sky: '#f0d19a', city: '#d6b18a', far: '#d3d48e', hill: '#b8cb83', front: '#8bb47a', tint: '#f2d8a9' },
    autumn: { sky: '#e8b594', city: '#d29a83', far: '#d2ae73', hill: '#b78463', front: '#95654f', tint: '#e8b189' },
    winter: { sky: '#bfcee8', city: '#aabbd6', far: '#a8c9c9', hill: '#82a5b3', front: '#668a9b', tint: '#d1dbef' },
  };

  const PERIOD_NAMES = ['predawn', 'morning', 'noon', 'afternoon', 'golden-hour', 'evening', 'night'];
  const HOUR_LINES = [
  [
    "12 AM, huh? Even the calendar just turned in a fresh leaf.",
    "12 AM. A new day, but no need to unwrap it yet.",
    "12 AM already? The list can wear its pajamas too.",
    "12 AM. Midnight saved you the quietest bench.",
    "12 AM, neighbor. Tomorrow can knock again later."
  ],
  [
    "1 AM, huh? The moon has the late shift covered.",
    "1 AM. Your thoughts can queue politely until morning.",
    "1 AM, neighbor. A sip of water is a fine little plan.",
    "1 AM. Even your next step can use an indoor voice.",
    "1 AM already? Let's keep the adventures blanket-sized."
  ],
  [
    "2 AM. The river is handling all the running tonight.",
    "2 AM, huh? No need to hold a meeting with tomorrow.",
    "2 AM. A sleepy little pause counts as a plan.",
    "2 AM, neighbor. Your shoulders can clock out.",
    "2 AM. The to-dos won't mind waiting in their slippers."
  ],
  [
    "3 AM. A very small hour deserves very small expectations.",
    "3 AM, huh? The fish have declined all meetings.",
    "3 AM. Tomorrow's puzzles can stay in their box.",
    "3 AM, neighbor. You can just sit with the view.",
    "3 AM. Nothing here needs you to be impressive."
  ],
  [
    "4 AM. The morning is still looking for its slippers.",
    "4 AM, huh? Early doesn't have to mean hurried.",
    "4 AM. A quiet hello before the kettle gets ideas.",
    "4 AM, neighbor. You don't need to wake the whole list.",
    "4 AM. One gentle thing. Preferably with a blanket nearby."
  ],
  [
    "5 AM. The day is stretching. You can take your time too.",
    "5 AM, huh? Early birds are allowed tea breaks.",
    "5 AM. A fresh start can be very, very small.",
    "5 AM, neighbor. The morning saved you a slow lane.",
    "5 AM. No need to finish breakfast and the future at once."
  ],
  [
    "6 AM. Good morning. The list can wait for the kettle.",
    "6 AM, huh? A stretch is a perfectly respectable opening act.",
    "6 AM. Let's start with a little kindness, neighbor.",
    "6 AM. The day comes in bite-sized pieces, luckily.",
    "6 AM. Your first task may simply be finding your slippers."
  ],
  [
    "7 AM. Breakfast before world domination, perhaps?",
    "7 AM, huh? The toast has a very manageable agenda.",
    "7 AM. One small plan, with room for jam.",
    "7 AM, neighbor. Your morning needn't win any races.",
    "7 AM. A sip, a breath, and we'll see what happens."
  ],
  [
    "8 AM. The day is open. Browsing is allowed.",
    "8 AM, huh? No need to carry the entire afternoon yet.",
    "8 AM. A little plan with generous margins sounds nice.",
    "8 AM, neighbor. One thing can have the front seat.",
    "8 AM. The rest of the list can enjoy the view from here."
  ],
  [
    "9 AM. One thing at a time. The others can form a polite queue.",
    "9 AM, huh? A modest beginning is still a beginning.",
    "9 AM. You don't need a grand entrance, neighbor.",
    "9 AM. A cup beside you and one little thing ahead.",
    "9 AM. Let's give the morning a comfortable walking speed."
  ],
  [
    "10 AM. A tiny break? The clouds seem in favor.",
    "10 AM, huh? Your eyes might enjoy a field trip outside.",
    "10 AM. A little water for you, a whole river for the ducks.",
    "10 AM. The next thing can wait for one good stretch.",
    "10 AM, neighbor. Pauses belong in the plan too."
  ],
  [
    "11 AM. Lunch is on the horizon. No need to sprint toward it.",
    "11 AM, huh? The morning can leave a few loose threads.",
    "11 AM. One small step, then maybe something crunchy.",
    "11 AM, neighbor. You can set that thought down for a minute.",
    "11 AM. The view has no objection to an early breather."
  ],
  [
    "12 PM. Noon, huh? The sandwich committee has a suggestion.",
    "12 PM. The view saved you a lunch seat.",
    "12 PM, neighbor. Even big days need little picnics.",
    "12 PM. Let lunch be lunch. The list can bring its own sandwich.",
    "12 PM. Half a day behind you, one gentle moment here."
  ],
  [
    "1 PM. Welcome back. The afternoon accepts gentle arrivals.",
    "1 PM, huh? No need to restart at full kettle.",
    "1 PM. A small step is plenty after a sandwich.",
    "1 PM, neighbor. The afternoon left room for you.",
    "1 PM. Let's ease back in at strolling speed."
  ],
  [
    "2 PM. A daydream fits nicely in this hour.",
    "2 PM, huh? The butterflies aren't keeping score.",
    "2 PM. A little stretch could be the plot twist.",
    "2 PM, neighbor. You can make the next thing smaller.",
    "2 PM. The river has chosen a steady, unbothered pace."
  ],
  [
    "3 PM. A tea-sized pause seems like sound planning.",
    "3 PM, huh? The snack department would like a word.",
    "3 PM. One tiny thing, then a little looking up.",
    "3 PM, neighbor. Your afternoon is allowed a soft spot.",
    "3 PM. The clouds have been taking breaks all day. Very sensible."
  ],
  [
    "4 PM. Notice what's done. The list can wait its turn.",
    "4 PM, huh? Not every loose end needs tying today.",
    "4 PM. A gentle finish can begin with a small pause.",
    "4 PM, neighbor. The scenic route is still a route.",
    "4 PM. You may leave some adventure for tomorrow."
  ],
  [
    "5 PM. Time to let the busy bits loosen their collars.",
    "5 PM, huh? A little change of pace sounds lovely.",
    "5 PM. Put one thing down before picking up the evening.",
    "5 PM, neighbor. The whole list needn't come to dinner.",
    "5 PM. A short walk is a perfectly good transition scene."
  ],
  [
    "6 PM. Dinner-sized daydreams are welcome here.",
    "6 PM, huh? Something simple can be something lovely.",
    "6 PM. The evening has room for a slower fork.",
    "6 PM, neighbor. Let's leave a little space around the plans.",
    "6 PM. No need to serve the to-do list a second helping."
  ],
  [
    "7 PM. A book, a stroll, or a very small expedition to the sofa.",
    "7 PM, huh? Some nice things don't need checkboxes.",
    "7 PM. An unplanned little hour sounds quite grand.",
    "7 PM, neighbor. The view is happy to do the entertaining.",
    "7 PM. The evening has no dress code. Slippers are welcome."
  ],
  [
    "8 PM. The cozy corner is accepting visitors.",
    "8 PM, huh? A warm drink could be the whole event.",
    "8 PM. The list can settle in with a blanket too.",
    "8 PM, neighbor. Doing very little is an available option.",
    "8 PM. Let's give the evening some comfortable edges."
  ],
  [
    "9 PM, huh? The list can put its pajamas on too.",
    "9 PM. A small tidy thought, then a little peace.",
    "9 PM, neighbor. Nothing needs a grand finale tonight.",
    "9 PM. The next hour is allowed to ask less of you.",
    "9 PM. Even the imaginary village has closed its suggestion box."
  ],
  [
    "10 PM. Tomorrow can have a note instead of a rehearsal.",
    "10 PM, huh? The unfinished things have somewhere to sleep.",
    "10 PM. A last sip and a softer pace sound nice.",
    "10 PM, neighbor. You can start putting the day down.",
    "10 PM. The list won't get lonely. It has all those other tasks."
  ],
  [
    "11 PM. A gentle goodbye to this particular day.",
    "11 PM, huh? Tomorrow can introduce itself when it arrives.",
    "11 PM. Keep one kind thought. The others can find a pillow.",
    "11 PM, neighbor. The calendar can turn its own page.",
    "11 PM. A quiet minute is a lovely closing scene."
  ]
];

  function validDate(date) {
    if (!(date instanceof Date) || !Number.isFinite(+date)) throw new TypeError('Valid date required');
  }

  function validTimezone(value) {
    const timezone = value === undefined || value === null || value === '' ? DEFAULT_TIMEZONE : value;
    if (typeof timezone !== 'string' || !timezone.trim()) throw new RangeError('Invalid timezone');
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
    catch { throw new RangeError('Invalid timezone'); }
    return timezone;
  }

  function localParts(date, timezone) {
    validDate(date);
    const zone = validTimezone(timezone);
    const fields = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
    }).formatToParts(date);
    const result = {};
    for (const field of fields) if (field.type !== 'literal') result[field.type] = Number(field.value);
    result.millisecond = date.getUTCMilliseconds();
    result.timezone = zone;
    return result;
  }

  function normalizedLocation(location) {
    if (typeof location === 'number') return { latitude: location, timezone: DEFAULT_TIMEZONE };
    if (typeof location === 'string') return { latitude: 0, timezone: validTimezone(location) };
    if (location === undefined || location === null) return { latitude: 0, timezone: DEFAULT_TIMEZONE };
    if (typeof location !== 'object') throw new TypeError('Location object required');
    const latitude = location.latitude === undefined || location.latitude === null ? 0 : Number(location.latitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new RangeError('Invalid latitude');
    const timezone = validTimezone(location.timezone === undefined ? location.timeZone : location.timezone);
    const longitude = location.longitude === null || location.longitude === undefined ? null : Number(location.longitude);
    const sunAltitude = location.sunAltitude === null || location.sunAltitude === undefined ? null : Number(location.sunAltitude);
    return {
      latitude, timezone,
      longitude: Number.isFinite(longitude) ? longitude : null,
      sunAltitude: Number.isFinite(sunAltitude) ? sunAltitude : null,
      label: typeof location.label === 'string' ? location.label : '',
    };
  }

  function dayNumber(parts) {
    return (Date.UTC(parts.year, parts.month - 1, parts.day) - Date.UTC(parts.year, 0, 1)) / DAY
      + (parts.hour * 3600 + parts.minute * 60 + parts.second + parts.millisecond / 1000) / 86400;
  }

  function ordinal(year, month, day) {
    return (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / DAY;
  }

  function season(date, latitude, timezone) {
    const location = typeof latitude === 'object' && latitude !== null
      ? normalizedLocation(latitude)
      : normalizedLocation({ latitude: latitude === undefined ? 0 : latitude, timezone });
    const parts = localParts(date, location.timezone);
    const leapDays = (Date.UTC(parts.year + 1, 0, 1) - Date.UTC(parts.year, 0, 1)) / DAY;
    const boundaries = [
      ordinal(parts.year, 3, 20), ordinal(parts.year, 6, 21),
      ordinal(parts.year, 9, 22), ordinal(parts.year, 12, 21),
    ];
    const rawCurrent = dayNumber(parts);
    let index = 3;
    for (let i = 0; i < boundaries.length; i++) if (rawCurrent >= boundaries[i]) index = i;
    const start = boundaries[index];
    const end = index === 3 ? boundaries[0] + leapDays : boundaries[index + 1];
    // Winter begins in the previous calendar year. Unwrap January and March
    // dates onto that same interval before calculating progress or blending.
    const current = index === 3 && rawCurrent < start ? rawCurrent + leapDays : rawCurrent;
    const span = end - start;
    const position = current - start;
    const remaining = span - position;
    const names = location.latitude < 0 ? SOUTHERN_NAMES : NORTHERN_NAMES;
    const weights = { spring: 0, summer: 0, autumn: 0, winter: 0 };
    weights[names[index]] = 1;
    // Ease each boundary over two weeks so a palette does not snap at an
    // equinox or solstice. At the exact boundary, the new season owns the
    // public name while both adjacent accents meet at equal weight.
    if (position < TRANSITION_DAYS) {
      const t = 0.5 + 0.5 * smoothstep(0, TRANSITION_DAYS, position);
      weights[names[index]] = t;
      weights[names[(index + 3) % 4]] = 1 - t;
    } else if (remaining < TRANSITION_DAYS) {
      const t = 0.5 + 0.5 * smoothstep(0, TRANSITION_DAYS, remaining);
      weights[names[index]] = t;
      weights[names[(index + 1) % 4]] = 1 - t;
    }
    return {
      name: names[index],
      hemisphere: location.latitude < 0 ? 'south' : 'north',
      progress: Math.max(0, Math.min(1, position / span)),
      weights,
    };
  }

  function smoothstep(start, end, value) {
    const amount = Math.max(0, Math.min(1, (value - start) / (end - start)));
    return amount * amount * (3 - 2 * amount);
  }

  function clock(date, timezone) {
    const parts = localParts(date, timezone);
    const hours = (parts.hour % 12) + parts.minute / 60 + parts.second / 3600 + parts.millisecond / 3600000;
    const minutes = parts.minute + parts.second / 60 + parts.millisecond / 60000;
    return { hourAngle: TAU * hours / 12, minuteAngle: TAU * minutes / 60 };
  }

  function parseHex(value) {
    if (typeof value !== 'string') return null;
    let text = value.trim();
    if (/^#[0-9a-f]{3}$/i.test(text)) text = '#' + text.slice(1).split('').map(c => c + c).join('');
    if (!/^#[0-9a-f]{6}$/i.test(text)) return null;
    return text.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  }

  function toHex(rgb) {
    return '#' + rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('');
  }

  function mixColor(first, second, amount) {
    const a = parseHex(first), b = parseHex(second);
    if (!a || !b) return first;
    return toHex(a.map((channel, index) => channel + (b[index] - channel) * amount));
  }

  function weightedAccent(weights, role) {
    const values = [0, 0, 0];
    for (const name of SEASON_ORDER) {
      const color = parseHex(ACCENTS[name][role] || ACCENTS[name].front);
      const weight = weights[name] || 0;
      for (let i = 0; i < 3; i++) values[i] += color[i] * weight;
    }
    return toHex(values);
  }

  function roleForKey(key) {
    if (key === 'sky') return 'sky';
    if (key === 'city') return 'city';
    if (key === 'far') return 'far';
    if (key === 'hill') return 'hill';
    if (key === 'front') return 'front';
    if (key === 'tint') return 'tint';
    return 'front';
  }

  function palette(base, date, location) {
    validDate(date);
    if (!base || typeof base !== 'object') throw new TypeError('Base palette required');
    const context = normalizedLocation(location);
    const current = season(date, context.latitude, context.timezone);
    const amount = 0.12;
    // A role-aware accent keeps the existing sky/city/terrain relationship.
    // Mixing rather than replacing is what preserves the base palette's
    // luminance and readable night silhouette.
    const accents = {};
    for (const role of ['sky', 'city', 'far', 'hill', 'front', 'tint']) accents[role] = weightedAccent(current.weights, role);
    function apply(value, role) {
      if (Array.isArray(value)) return value.map(item => apply(item, role));
      if (typeof value === 'string' && parseHex(value)) return mixColor(value, accents[role] || accents.front, amount);
      if (!value || typeof value !== 'object') return value;
      const copy = {};
      for (const key of Object.keys(value)) {
        if (key === 'night') copy[key] = value[key];
        else copy[key] = apply(value[key], roleForKey(key));
      }
      return copy;
    }
    return apply(base, 'front');
  }

  function period(date, location) {
    const context = normalizedLocation(location);
    const parts = localParts(date, context.timezone);
    const minutes = parts.hour * 60 + parts.minute + parts.second / 60 + parts.millisecond / 60000;
    // A renderer can pass the already-calculated solar altitude. It wins near
    // twilight, where a fixed clock hour would call a winter sunset “afternoon”
    // or call a high-latitude summer midnight “night” at the wrong moment.
    if (context.sunAltitude !== null) {
      const beforeNoon = minutes < 720;
      if (context.sunAltitude < -12) return 'night';
      if (context.sunAltitude <= 0) return beforeNoon ? 'predawn' : 'evening';
      if (context.sunAltitude < 8) return beforeNoon ? 'morning' : 'golden-hour';
    }
    if (minutes < 240 || minutes >= 1350) return 'night';
    if (minutes < 390) return 'predawn';
    if (minutes < 690) return 'morning';
    if (minutes < 840) return 'noon';
    if (minutes < 1020) return 'afternoon';
    if (minutes < 1170) return 'golden-hour';
    return 'evening';
  }

  function randomFraction(random) {
    let value;
    if (typeof random === 'function') {
      try { value = random(); } catch { value = 0; }
    } else value = random;
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(0.999999999999, value));
  }

  function message(date, location, random) {
    validDate(date);
    const hour=localParts(date,normalizedLocation(location).timezone).hour;
    const lines=HOUR_LINES[hour];return lines[Math.floor(randomFraction(random)*lines.length)];
  }
  const messageCatalog=HOUR_LINES.flatMap((lines,hour)=>lines.map(text=>({hour,text})));

  const api = Object.freeze({
    season, palette, clock, period, message, messages: message,
    messageCatalog: Object.freeze(messageCatalog), messageCount: messageCatalog.length,
    periods: Object.freeze(PERIOD_NAMES.slice()),
  });
  root.LandscapeMood = api;
})(globalThis);
