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
  const PERIOD_LINES = {
  "predawn": [
    "The village is still snoozing.",
    "A tiny day is getting ready.",
    "Shh. Even the paths are sleepy.",
    "Your morning can wait a moment.",
    "A cozy little pause before hello.",
    "No hurry, early bird.",
    "The kettle can take its time.",
    "A quiet corner, just for you.",
    "Pocket a little peace for later.",
    "The day will find you soon."
  ],
  "morning": [
    "Morning, neighbor.",
    "A fresh day, a familiar path.",
    "Your little corner is waking up.",
    "Maybe a stroll before the bustle?",
    "Good morning to you and the trees.",
    "One tiny thing, then a tea break.",
    "The birds have a busy little plan.",
    "A new day fits in small steps.",
    "Hello, lovely little morning.",
    "Leave a little room for daydreams."
  ],
  "noon": [
    "Lunch break, neighbor?",
    "A little picnic sounds nice.",
    "The view saved you a seat.",
    "A tiny pause counts too.",
    "Perhaps a sandwich by the water?",
    "There is no rush on this path.",
    "Time for a pocket-sized adventure.",
    "Your next thing can be a small thing.",
    "The village has room for a breather.",
    "A sip of tea, a bit of sky."
  ],
  "afternoon": [
    "A little wandering time.",
    "The long way home looks lovely.",
    "Maybe just one more daydream.",
    "A bench, a book, a little break.",
    "Your to-dos can share the day.",
    "A small step is plenty, neighbor.",
    "The water is doing its own thing.",
    "No need to race the butterflies.",
    "A cozy pause between adventures.",
    "You have earned a little looking up."
  ],
  "golden-hour": [
    "The day is putting on its cozy colors.",
    "A golden little goodbye to the day.",
    "Time to take the scenic way home.",
    "The village is slowing its footsteps.",
    "A lovely hour for doing very little.",
    "One last stroll, neighbor?",
    "The day can end with a small thing.",
    "A warm little pause before evening.",
    "Your next adventure can wait.",
    "Pocket this little bit of evening."
  ],
  "evening": [
    "Welcome to the cozy part of the day.",
    "The village is tucking itself in.",
    "A little lamplight, a little quiet.",
    "Maybe the kettle is calling.",
    "The paths are getting sleepy.",
    "Time to put your busy pockets down.",
    "Nothing wrong with a gentle evening.",
    "The day did enough. So did you.",
    "A quiet hello from the waterfront.",
    "You can leave a little for tomorrow."
  ],
  "night": [
    "Even the busy bees have clocked out.",
    "The village has gone soft and quiet.",
    "A tiny goodnight from the trees.",
    "Your next adventure can wait.",
    "The stars can mind the sky tonight.",
    "Rest your busy little pockets.",
    "No errands for the moon tonight.",
    "A cozy corner under the stars.",
    "Time for a small, sleepy pause.",
    "Goodnight, neighbor."
  ]
};
  const SEASON_LINES = {
  "spring": [
    "New leaves, little joys.",
    "Spring is taking its time.",
    "A fresh little season.",
    "Room for something to grow."
  ],
  "summer": [
    "A soft summer hello.",
    "Summer can take it slow.",
    "A little summer daydream.",
    "The green season is here."
  ],
  "autumn": [
    "A cozy turn of the season.",
    "Autumn has a gentle pace.",
    "A little leaf-shaped joy.",
    "Time for cozy little things."
  ],
  "winter": [
    "A little winter quiet.",
    "The cool season says hello.",
    "A cozy season for a pause.",
    "Winter can take its time."
  ]
};

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
    const context = normalizedLocation(location);
    const current = season(date, context.latitude, context.timezone);
    const which = period(date, context);
    const lines = PERIOD_LINES[which];
    const value = randomFraction(random);
    const index = Math.min(lines.length - 1, Math.floor(value * lines.length));
    const scenery = SEASON_LINES[current.name][(index + Math.floor(value * 4)) % 4];
    return lines[index] + ' ' + scenery;
  }

  const messageCatalog = [];
  for (const which of PERIOD_NAMES) {
    for (const line of PERIOD_LINES[which]) {
      for (const name of SEASON_ORDER) messageCatalog.push({ period: which, season: name, text: line + ' ' + SEASON_LINES[name][messageCatalog.length % 4] });
    }
  }

  const api = Object.freeze({
    season, palette, clock, period, message, messages: message,
    messageCatalog: Object.freeze(messageCatalog), messageCount: messageCatalog.length,
    periods: Object.freeze(PERIOD_NAMES.slice()),
  });
  root.LandscapeMood = api;
})(globalThis);
