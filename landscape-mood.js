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
    "Midnight has a little room for you.",
    "A new date, no need for a new demand.",
    "The clock turned over. You can stay still.",
    "Hello, midnight neighbor. Keep it gentle.",
    "Let this first hour be a soft landing."
  ],
  [
    "One in the morning is a quiet kind of company.",
    "A small light and a smaller next step.",
    "You can leave a little unfinished tonight.",
    "The late hours need no grand plans.",
    "Rest is welcome in this corner, too."
  ],
  [
    "Two o'clock. Nothing here needs a hurry.",
    "A quiet sip of water might be nice.",
    "Let your shoulders find their way down.",
    "A little pause in the middle of the night.",
    "Even a busy mind can visit a still place."
  ],
  [
    "Three in the morning, and the river carries on.",
    "You do not have to solve tomorrow tonight.",
    "A soft place for a wandering thought.",
    "The small hours can stay small.",
    "Put one thought down. Let the others wait."
  ],
  [
    "Four o'clock leaves room between things.",
    "Before the bustle, a little breathing space.",
    "The early hours have a bench for you.",
    "No need to get ahead of the whole day.",
    "One gentle thing is enough for now."
  ],
  [
    "Five o'clock. A little hello to the day.",
    "Let the morning arrive at its own pace.",
    "A warm cup can be a beginning.",
    "Early bird, you can take the slow path.",
    "A fresh page does not need filling at once."
  ],
  [
    "Six o'clock, and a new little chapter.",
    "Good morning, neighbor. Start softly.",
    "One small kindness before the day gathers speed.",
    "There is time for a stretch and a breath.",
    "Let your first step be an easy one."
  ],
  [
    "Seven o'clock has breakfast-sized possibilities.",
    "A sip, a bite, a little look outside.",
    "The morning can fit around you, too.",
    "Pick one thing to carry into the day.",
    "A familiar path is a fine place to start."
  ],
  [
    "Eight o'clock. Settle in at your own pace.",
    "A little plan, with room around the edges.",
    "The day need not be decided all at once.",
    "Good morning to you and your next small step.",
    "Take a breath before opening another door."
  ],
  [
    "Nine o'clock, and one thing can have your attention.",
    "A clear little space for a modest beginning.",
    "You can start without knowing every step.",
    "A cup beside you, a single thing ahead.",
    "The rest of the list can wait its turn."
  ],
  [
    "Ten o'clock might be a good time to look up.",
    "A tiny break belongs in the morning, too.",
    "Let your eyes wander farther than the next task.",
    "A little water, a little sky, then onward.",
    "There is room for a slower minute."
  ],
  [
    "Eleven o'clock. Leave some room for lunch.",
    "One more small step, if it feels right.",
    "The morning does not need a perfect ending.",
    "A pause before the middle of the day.",
    "You can set something down for a while."
  ],
  [
    "Noon, neighbor. The view saved you a seat.",
    "A midday breather is a lovely little plan.",
    "Perhaps a sandwich and a moment by the water.",
    "Half a day behind you. Just this moment here.",
    "Let lunch be more than another thing to finish."
  ],
  [
    "One in the afternoon. Begin again gently.",
    "The afternoon can have a smaller plan.",
    "A fresh sip and an unhurried next step.",
    "You can ease back in, little by little.",
    "There is no need to race the lunch break."
  ],
  [
    "Two o'clock has room for a daydream.",
    "A small step is still a step, neighbor.",
    "Let the afternoon stretch its legs.",
    "A change of view can be a little reset.",
    "Take the next thing at a comfortable pace."
  ],
  [
    "Three o'clock sounds like a tea-sized pause.",
    "A snack, a stretch, a moment to yourself.",
    "The river is in no rush this afternoon.",
    "One tiny thing, then look up again.",
    "A little breathing room for the middle stretch."
  ],
  [
    "Four o'clock. Notice what is already done.",
    "The day can leave a few loose ends.",
    "A gentle finish begins with one small choice.",
    "There is room to make the next thing smaller.",
    "You can take the scenic route through this hour."
  ],
  [
    "Five o'clock, and a chance to change pace.",
    "Let the busy part of the day loosen its grip.",
    "A small walk might be a lovely transition.",
    "Put down one thing before picking up another.",
    "The evening does not need the whole list."
  ],
  [
    "Six o'clock brings dinner-sized daydreams.",
    "A place at the table, a little time to breathe.",
    "Let this hour be a softer part of the day.",
    "Something simple can be something lovely.",
    "A slow hello to your evening, neighbor."
  ],
  [
    "Seven o'clock. Perhaps a little wandering time.",
    "A book, a stroll, or simply this view.",
    "There is room for things without a checkbox.",
    "Let the evening have some unplanned space.",
    "A quiet little adventure can stay close to home."
  ],
  [
    "Eight o'clock has a cozy corner for you.",
    "The list can wait while you settle in.",
    "A warm drink and a softer pace.",
    "Leave a little room for doing very little.",
    "A gentle evening is a perfectly good plan."
  ],
  [
    "Nine o'clock. Start putting the day down.",
    "A small tidy thought, then a little peace.",
    "Nothing needs a grand finale tonight.",
    "The next hour can ask less of you.",
    "Let a quiet moment be enough, neighbor."
  ],
  [
    "Ten o'clock is a good hour for softer edges.",
    "You can leave tomorrow a little note.",
    "Let the unfinished things rest for tonight.",
    "A last sip, a deep breath, a comfortable pause.",
    "The day does not need any more proving."
  ],
  [
    "Eleven o'clock. A gentle goodbye to the day.",
    "Keep one kind thought and let the rest settle.",
    "Tomorrow can meet you when it arrives.",
    "A quiet minute before the calendar turns.",
    "You have a place to rest your attention here."
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
