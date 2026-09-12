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
    predawn: [
      'The day is still gathering at the edges.', 'There is room in the blue before the lists wake up.',
      'A quiet beginning is already enough for now.', 'The first light has nowhere it needs to hurry.',
      'The world is stretching softly ahead of you.', 'Let this small, blue pause belong to you.',
      'Before the noise, there is this open breath.', 'The horizon is making space for a new page.',
      'The early air keeps a little room to breathe.', 'You can meet the morning one gentle step at a time.',
    ],
    morning: [
      'A world outside your todo list is warming into view.', 'Morning has brought more than one way forward.',
      'You can carry one thing at a time into this light.', 'The day is open, even where the path bends.',
      'There is a little more sky than there is urgency.', 'Let the first bright hours stay spacious.',
      'The landscape is busy growing and still takes its time.', 'A soft start can be a real start.',
      'You have permission to leave some room between tasks.', 'The morning light is a quiet kind of company.',
    ],
    noon: [
      'The bright middle of the day can hold a pause.', 'Sunlight is making ordinary things feel sufficient.',
      'There is a whole world outside the next checkbox.', 'Let the day be wide for a moment.',
      'One thing at a time still counts in full daylight.', 'The clearest hour does not need a perfect plan.',
      'You can look up without falling behind.', 'Even the high sun leaves room for a breath.',
      'A small pause belongs in the middle of the day.', 'The view is here, asking nothing from you.',
    ],
    afternoon: [
      'The day is easing toward its softer side.', 'There is time for the path and the plan to share space.',
      'The light is changing; you can change pace too.', 'A little room to breathe can follow a busy hour.',
      'The afternoon keeps its own quiet momentum.', 'Let one finished thing be enough for this moment.',
      'The horizon is patient with the rest of your list.', 'You can take the scenic route through this hour.',
      'The warm air says there is more to notice than progress.', 'Keep a little attention for what is not a task.',
    ],
    'golden-hour': [
      'The light is turning every small thing toward gold.', 'The horizon has softened the edges of the day.',
      'This is a good hour for leaving a little unscheduled.', 'The long light is asking you to look around.',
      'The day can end gently, even if it began in a rush.', 'A world outside your todo list is glowing nearby.',
      'Let the golden quiet find you where you are.', 'Nothing needs solving in this particular light.',
      'The path is warm, open and in no hurry.', 'One thing at a time; the sun knows how to set.',
    ],
    evening: [
      'The evening is making a little room around the day.', 'You can set down one thought with the sunlight.',
      'The busy hours are behind you for a while.', 'A softer sky is enough of an arrival.',
      'Let the last light keep you company, lightly.', 'The world is still here after the list grows quiet.',
      'There is no need to make this gentle hour productive.', 'The evening path remembers how to wander.',
      'A little breathing space looks good on the day.', 'You made it here; the rest can wait its turn.',
    ],
    night: [
      'The dark is wide enough to hold a quiet thought.', 'A world outside your todo list is shining somewhere.',
      'The night keeps its own unhurried company.', 'You can let the unfinished things grow quiet.',
      'There is room to breathe beneath the patient stars.', 'One thing at a time, and sometimes nothing at all.',
      'The landscape is resting; you are allowed to rest too.', 'The dark does not ask you to be brighter.',
      'A small pause can be the whole plan tonight.', 'The sky is carrying on without needing an answer.',
    ],
  };
  const SEASON_LINES = {
    // Keep these cues compatible with every period: a summer night can hold
    // warmth and deep green, while a winter night can hold cool air and stars.
    spring: ['Spring green is returning by degrees.', 'New leaves are taking their time.', 'The season is softening the green edges.', 'A fresh breeze is moving through the view.'],
    summer: ['Summer warmth is resting over the view.', 'Warm air is holding steady outside.', 'Green is deepening in the quiet light.', 'A soft summer breeze is passing through.'],
    autumn: ['Autumn is warming the far edges.', 'The season is turning gently toward amber.', 'The trees are keeping a little gold.', 'Cooler air is arriving with soft colours.'],
    winter: ['Winter is keeping the horizon clear.', 'Cool air is leaving more sky to see.', 'Bare branches are making room for stars.', 'A quiet blue belongs to this season.'],
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
