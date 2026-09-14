/* Gentle time, season and colour cues for the living landscape.
   This module has no DOM, network or scanner-state dependency so it can be
   loaded by the scenery and exercised offline in a small browser context. */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const DAY = 86400000;
  const CONFIG = root.LandscapeConfig;
  if (!CONFIG) throw new Error('LandscapeConfig must load before landscape-mood.js');
  const DEFAULT_TIMEZONE = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  })();

  const NORTHERN_NAMES = ['spring', 'summer', 'autumn', 'winter'];
  const SOUTHERN_NAMES = ['autumn', 'winter', 'spring', 'summer'];
  const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
  const TRANSITION_DAYS = 14;

  // These intentionally soft accents live in the shared registry. LivingSky
  // handles sky brightness; mood adds a quiet seasonal cast without replacing
  // that calibrated day/night contrast.
  const ACCENTS = Object.freeze(Object.fromEntries(SEASON_ORDER.map(name => [name, CONFIG.seasons[name].accent])));

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

  // Holiday copy is a second pool so ordinary days keep their five stable
  // hour-specific lines. Each holiday gets the same generous five choices,
  // with the local hour and holiday name filled in at the last moment.
  const HOLIDAY_LINES = Object.freeze({
    "New Year's Day": [
      "{{hour}}, neighbor. {{name}} can begin with one soft little hello.",
      "{{hour}}. A fresh page for {{name}}, with plenty of room around it.",
      "{{hour}}, huh? {{name}} does not need a grand plan just yet.",
      "{{hour}}. The waterfront is raising a quiet cup to {{name}}.",
      "{{hour}}, neighbor. Let {{name}} arrive at a comfortable walking speed."
    ],
    "Martin Luther King Jr. Day": [
      "{{hour}}. {{name}} leaves room for kindness to take the next step.",
      "{{hour}}, neighbor. A gentle pause can honor the hope in {{name}}.",
      "{{hour}}. The view is holding a quiet, thoughtful space for {{name}}.",
      "{{hour}}, huh? Let {{name}} be a small invitation toward kindness.",
      "{{hour}}, neighbor. There is room today for care, courage, and rest on {{name}}."
    ],
    "Washington's Birthday": [
      "{{hour}}. {{name}} can be a quiet pause among the big ideas.",
      "{{hour}}, neighbor. Even {{name}} deserves a slow stroll by the water.",
      "{{hour}}, huh? Set down the speeches and keep one kind thought for {{name}}.",
      "{{hour}}. The waterfront saved a calm little bench for {{name}}.",
      "{{hour}}, neighbor. A comfortable pace is a fine way to mark {{name}}."
    ],
    "Memorial Day": [
      "{{hour}}. {{name}} holds a quiet place for remembrance and rest.",
      "{{hour}}, neighbor. Let {{name}} be gentle, grateful, and unhurried.",
      "{{hour}}. The water is keeping a peaceful moment for {{name}}.",
      "{{hour}}, huh? A little stillness can belong to {{name}} too.",
      "{{hour}}, neighbor. Remembering can share {{name}} with a soft breath."
    ],
    "Juneteenth National Independence Day": [
      "{{hour}}. {{name}} brings room for freedom, joy, and a slow breath.",
      "{{hour}}, neighbor. Let {{name}} carry a little lightness and a lot of hope.",
      "{{hour}}. The harbor is making room for the joy in {{name}}.",
      "{{hour}}, huh? A small celebration is a lovely part of {{name}}.",
      "{{hour}}, neighbor. {{name}} can hold joy at whatever pace feels kind."
    ],
    "Independence Day": [
      "{{hour}}. {{name}} can sparkle softly; no grand finale required.",
      "{{hour}}, neighbor. A little picnic is a perfectly good {{name}} plan.",
      "{{hour}}, huh? The sky saved a quiet patch for {{name}} daydreams.",
      "{{hour}}. Let {{name}} bring a warm glow and a slower pace.",
      "{{hour}}, neighbor. Fireworks can wait while you enjoy this small {{name}} view."
    ],
    "Labor Day": [
      "{{hour}}. {{name}} is an excellent excuse to loosen your shoulders.",
      "{{hour}}, neighbor. The to-do list can take a little {{name}} break too.",
      "{{hour}}, huh? A slow stroll is worthy {{name}} celebration.",
      "{{hour}}. Let {{name}} leave some space around the work of being alive.",
      "{{hour}}, neighbor. Rest is allowed to be the main event on {{name}}."
    ],
    "Columbus Day": [
      "{{hour}}. {{name}} and Indigenous Peoples' Day invite thoughtful reflection.",
      "{{hour}}, neighbor. The horizon holds many histories to remember on {{name}}.",
      "{{hour}}, huh? Let {{name}} make room for listening, learning, and rest.",
      "{{hour}}. The harbor keeps a quiet, respectful space for {{name}}.",
      "{{hour}}, neighbor. A thoughtful pause is a kind way to mark {{name}}."
    ],
    "Veterans Day": [
      "{{hour}}. {{name}} holds a grateful, quiet space for those who served.",
      "{{hour}}, neighbor. Let {{name}} be gentle, thankful, and unhurried.",
      "{{hour}}. The harbor is keeping a calm moment of gratitude for {{name}}.",
      "{{hour}}, huh? A peaceful pause is a worthy way to mark {{name}}.",
      "{{hour}}, neighbor. Gratitude for {{name}} can sit beside you while water moves."
    ],
    "Thanksgiving Day": [
      "{{hour}}. {{name}} can fit one more small thing: a comfortable breath.",
      "{{hour}}, neighbor. A thankful pause is plenty for this part of {{name}}.",
      "{{hour}}, huh? The table can wait while you enjoy the view on {{name}}.",
      "{{hour}}. Let {{name}} be warm, simple, and generous with its margins.",
      "{{hour}}, neighbor. No need to race toward {{name}} dessert or anything else."
    ],
    "Christmas Day": [
      "{{hour}}. {{name}} can be cozy, quiet, and exactly your size today.",
      "{{hour}}, neighbor. A little wonder is plenty for {{name}}.",
      "{{hour}}, huh? The {{name}} lights are twinkling without asking anything of you.",
      "{{hour}}. Let {{name}} bring a soft glow to this small waterfront pause.",
      "{{hour}}, neighbor. Slippers are excellent formalwear for {{name}}."
    ],
    "Groundhog Day": [
      "{{hour}}. {{name}} is a fine day to peek out and go gently back in.",
      "{{hour}}, neighbor. No shadow can hurry this little {{name}} pause.",
      "{{hour}}, huh? A cozy burrow is a perfectly good {{name}} destination.",
      "{{hour}}. The forecast for {{name}} calls for one unhurried breath.",
      "{{hour}}, neighbor. A small {{name}} hello to the groundhog, then back to your pace."
    ],
    "Valentine's Day": [
      "{{hour}}. {{name}} includes you, too, right here in the quiet.",
      "{{hour}}, neighbor. A little kindness for yourself is a lovely {{name}} gift.",
      "{{hour}}, huh? The harbor has saved a warm corner for {{name}}.",
      "{{hour}}. Let {{name}} be soft around the edges and generous with rest.",
      "{{hour}}, neighbor. No grand {{name}} gesture needed; a gentle breath is enough."
    ],
    "St. Patrick's Day": [
      "{{hour}}. {{name}} can have a little green, a little luck, and no hurry.",
      "{{hour}}, neighbor. A lucky pause is a perfectly good {{name}} tradition.",
      "{{hour}}, huh? The river is carrying a tiny bit of {{name}} cheer.",
      "{{hour}}. Let {{name}} be playful without becoming another task.",
      "{{hour}}, neighbor. A small wandering thought counts as {{name}} magic."
    ],
    "April Fools' Day": [
      "{{hour}}. The only {{name}} trick today is making your next step smaller.",
      "{{hour}}, neighbor. {{name}} permits a little silliness and a lot of ease.",
      "{{hour}}, huh? The ducks promise no surprise meeting for {{name}}.",
      "{{hour}}. A soft joke and a quiet view make a fine {{name}} plan.",
      "{{hour}}, neighbor. On {{name}}, leave punchlines and to-dos unfinished."
    ],
    "Easter Sunday": [
      "{{hour}}. {{name}} can be a small bright pause among the new beginnings.",
      "{{hour}}, neighbor. A gentle morning or evening is enough for {{name}}.",
      "{{hour}}, huh? Let {{name}} bring a little color without a busy schedule.",
      "{{hour}}. The waterfront is hiding one peaceful egg-shaped moment for {{name}}.",
      "{{hour}}, neighbor. New beginnings can start very softly on {{name}}."
    ],
    "Earth Day": [
      "{{hour}}. The river and trees have saved a grateful breath for {{name}}.",
      "{{hour}}, neighbor. {{name}} is a lovely excuse to look closely at the living view.",
      "{{hour}}, huh? One small kind choice is plenty for {{name}}.",
      "{{hour}}. Let {{name}} be a gentle thank-you to the ground beneath you.",
      "{{hour}}, neighbor. The clouds, water, and trees celebrate {{name}} quietly too."
    ],
    "Mother's Day": [
      "{{hour}}. {{name}} has room for a soft thank-you and a comfortable pause.",
      "{{hour}}, neighbor. Let {{name}} include a little care for the caregiver, too.",
      "{{hour}}, huh? A warm cup and a kind thought make a lovely {{name}} gift.",
      "{{hour}}. The harbor is holding a gentle seat for everyone marking {{name}}.",
      "{{hour}}, neighbor. Rest can be part of the {{name}} celebration."
    ],
    "Flag Day": [
      "{{hour}}. {{name}} can be a small, breezy pause with room for belonging.",
      "{{hour}}, neighbor. Let the colors of {{name}} pass by at a quiet pace.",
      "{{hour}}, huh? The harbor has a little wind and a lot of breathing room for {{name}}.",
      "{{hour}}. A gentle look up is a fine way to mark {{name}}.",
      "{{hour}}, neighbor. {{name}} can be thoughtful without becoming another assignment."
    ],
    "Father's Day": [
      "{{hour}}. {{name}} has room for a quiet thank-you and a slow breath.",
      "{{hour}}, neighbor. A simple stroll makes a fine {{name}} celebration.",
      "{{hour}}, huh? Let {{name}} be easygoing, warm, and generous with time.",
      "{{hour}}. The water saved a calm little seat for everyone marking {{name}}.",
      "{{hour}}, neighbor. Rest is a perfectly good part of the {{name}} plan."
    ],
    "Halloween": [
      "{{hour}}. {{name}} can be spooky, cozy, and entirely free of pressure.",
      "{{hour}}, neighbor. A tiny moonlit wander is plenty of {{name}} adventure.",
      "{{hour}}, huh? The ghosts have promised to queue politely for {{name}}.",
      "{{hour}}. Let {{name}} bring the soft lantern glow and leave the rush outside.",
      "{{hour}}, neighbor. Even a {{name}} pumpkin knows there is time to sit and glow."
    ],
    "Christmas Eve": [
      "{{hour}}. {{name}} can be a quiet pocket before the lights and laughter.",
      "{{hour}}, neighbor. A soft pause is a lovely gift on {{name}}.",
      "{{hour}}, huh? The harbor is keeping one calm little corner for {{name}}.",
      "{{hour}}. Let {{name}} arrive slowly; the twinkle lights can wait.",
      "{{hour}}, neighbor. No wrapping required for this peaceful {{name}} moment."
    ],
    "New Year's Eve": [
      "{{hour}}. {{name}} can end gently; tomorrow will bring its own hello.",
      "{{hour}}, neighbor. A quiet little countdown is plenty for {{name}}.",
      "{{hour}}, huh? The list can stay in its slippers through {{name}}.",
      "{{hour}}. Let {{name}} be a warm pause before the calendar turns.",
      "{{hour}}, neighbor. You do not have to carry {{name}} or the whole year to its doorstep."
    ],
  });

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

  function dayOfWeek(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }

  function nthWeekday(year, month, weekday, occurrence) {
    const first = dayOfWeek(year, month, 1);
    return 1 + (weekday - first + 7) % 7 + (occurrence - 1) * 7;
  }

  function lastWeekday(year, month, weekday) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return lastDay - (dayOfWeek(year, month, lastDay) - weekday + 7) % 7;
  }

  // Gregorian Easter, kept local and deterministic so a holiday never needs
  // a network lookup or an embedded table that expires after one year.
  function easterDate(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = (h + l - 7 * m + 114) % 31 + 1;
    return { month, day };
  }

  function holidayForParts(parts) {
    const { year, month, day } = parts;
    const easter = easterDate(year);
    // Easter takes precedence over smaller fixed observances when their dates
    // happen to coincide (as they do on April 1 in 2029).
    if (month === easter.month && day === easter.day) return 'Easter Sunday';
    const fixed = {
      '1-1': "New Year's Day",
      '2-2': 'Groundhog Day',
      '2-14': "Valentine's Day",
      '3-17': "St. Patrick's Day",
      '4-1': "April Fools' Day",
      '4-22': 'Earth Day',
      '6-14': 'Flag Day',
      '6-19': 'Juneteenth National Independence Day',
      '7-4': 'Independence Day',
      '10-31': 'Halloween',
      '11-11': 'Veterans Day',
      '12-24': 'Christmas Eve',
      '12-25': 'Christmas Day',
      '12-31': "New Year's Eve",
    };
    const fixedName = fixed[`${month}-${day}`];
    if (fixedName) return fixedName;

    // US federal holidays whose dates are set by a weekday occurrence.
    if (month === 1 && day === nthWeekday(year, 1, 1, 3)) return 'Martin Luther King Jr. Day';
    if (month === 2 && day === nthWeekday(year, 2, 1, 3)) return "Washington's Birthday";
    if (month === 5 && day === lastWeekday(year, 5, 1)) return 'Memorial Day';
    if (month === 9 && day === nthWeekday(year, 9, 1, 1)) return 'Labor Day';
    if (month === 10 && day === nthWeekday(year, 10, 1, 2)) return 'Columbus Day';
    if (month === 11 && day === nthWeekday(year, 11, 4, 4)) return 'Thanksgiving Day';

    // These familiar observances are also calculated from their Sunday rule.
    if (month === 5 && day === nthWeekday(year, 5, 0, 2)) return "Mother's Day";
    if (month === 6 && day === nthWeekday(year, 6, 0, 3)) return "Father's Day";
    return null;
  }

  function hourLabel(hour) {
    return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
  }

  function materializeHoliday(template, hour, name) {
    return template.replace(/\{\{hour\}\}/g, hourLabel(hour)).replace(/\{\{name\}\}/g, name);
  }

  const seasonCache = new Map();
  function seasonBoundaries(year) {
    if (!seasonCache.has(year)) {
      const values = root.Astronomy.Seasons(year);
      seasonCache.set(year, ['mar_equinox','jun_solstice','sep_equinox','dec_solstice'].map((key,index) => ({date:values[key].date,index})));
      if (seasonCache.size > 9) seasonCache.delete(seasonCache.keys().next().value);
    }
    return seasonCache.get(year);
  }
  function season(date, latitude, timezone) {
    const location = typeof latitude === 'object' && latitude !== null
      ? normalizedLocation(latitude)
      : normalizedLocation({ latitude: latitude === undefined ? 0 : latitude, timezone });
    const parts = localParts(date, location.timezone);
    // Equinoxes and solstices are global instants. A timezone changes their
    // calendar label, never the instant or the palette's transition progress.
    const boundaries = [parts.year-1,parts.year,parts.year+1].flatMap(seasonBoundaries);
    const next = boundaries.findIndex(boundary => +boundary.date > +date);
    const start = boundaries[next-1], end = boundaries[next], index = start.index;
    const span = (+end.date - +start.date) / DAY;
    const position = (+date - +start.date) / DAY;
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
      start: new Date(+start.date), end: new Date(+end.date),
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
      if (typeof value === 'string' && parseHex(value)) {
        const ground=['far','hill','front'].includes(role);
        // Snowfields lose their lawn tint in daylight, while the existing
        // night palette still determines how much light reaches the ground.
        const winterStrength=role==='front'?.55:.80;
        const strength=amount+(ground?(winterStrength*current.weights.winter+.5*current.weights.autumn)*(1-(base.night||0)*.78):0);
        return mixColor(value, accents[role] || accents.front, strength);
      }
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

  // Only bullet lines inside recognized sections are authored copy. Empty
  // sections leave the hourly prompt blank, and Markdown stays plain text.
  let humanText = Object.create(null);
  const AI_AIRPLANE_LINES = ['ONE THING AT A TIME','ROOM TO BREATHE','HELLO, BEAUTIFUL DAY','TAKE YOUR TIME'];
  function setHumanText(markdown) {
    const next = Object.create(null);
    let section = null;
    for (const line of String(markdown).split(/\r?\n/)) {
      if (/^##\s/.test(line)) {
        const title = line.replace(/^##\s+/, '').trim();
        section = /^(Hour (?:[01]\d|2[0-3])|Airplanes|Skywriters|Any time of day)$/.test(title) ||
          (title.startsWith('Holiday ') && Object.hasOwn(HOLIDAY_LINES, title.slice(8))) ? title : null;
      } else if (section && /^-\s+\S/.test(line)) {
        (next[section] ||= []).push(line.slice(2).trim());
      }
    }
    humanText = next;
  }
  const HISTORY_KEY = 'fvp:chain-scanner:scene-seen:v1';
  const SEEN_MS = 7 * 86400000;
  let historyStorage = null, historyClock = () => Date.now(), seen = new Map();
  function configureHistory(storage, clock = () => Date.now()) {
    historyStorage = storage; historyClock = clock; seen = new Map();
  }
  function readSeen() {
    const now = historyClock();
    // Each observation has its own storage key. Concurrent tabs cannot replace
    // one another's observations as they could with one read/modify/write list.
    // A blocked store still leaves the in-memory history usable for this visit.
    try {
      const keys = Array.from({length: historyStorage?.length || 0}, (_,i) => historyStorage.key(i));
      for (const key of keys) {
        if (!key?.startsWith(HISTORY_KEY + ':')) continue;
        let rows;
        try { rows = JSON.parse(historyStorage.getItem(key)); } catch { continue; }
        if (!Array.isArray(rows)) continue;
        let expired = true;
        for (const row of rows) {
          if (!Array.isArray(row) || typeof row[0] !== 'string' || !Number.isFinite(row[1])) continue;
          if (now - row[1] < SEEN_MS) expired = false;
          if (row[1] <= now && now - row[1] < SEEN_MS)
            seen.set(row[0], Math.max(seen.get(row[0]) || 0, row[1]));
        }
        if (expired) historyStorage.removeItem(key);
      }
    } catch {}
    for (const [text, at] of seen) if (now - at >= SEEN_MS) seen.delete(text);
    return seen;
  }
  function recordSeen(text, seenKey = text) {
    if (!text) return;
    readSeen();
    const now = historyClock(), rows = [...new Set([text, seenKey])].map(key => [key, now]);
    for (const [key, at] of rows) seen.set(key, at);
    // Store rendered wording and its template identity atomically. The identity
    // holds across clock labels; the wording holds across human/AI/banner pools.
    const key = HISTORY_KEY + ':' + now + ':' + encodeURIComponent(text) + ':' + encodeURIComponent(seenKey);
    try { historyStorage?.setItem(key, JSON.stringify(rows)); } catch {}
  }
  function unique(lines) { return [...new Set(lines)]; }
  function unseen(lines) { const history = readSeen(); return unique(lines).filter(text => !history.has(text)); }
  function pick(lines, random) { return lines[Math.floor(randomFraction(random) * lines.length)] || ''; }
  function airplaneMessage(random) { return pick(unseen(humanText.Airplanes || AI_AIRPLANE_LINES), random); }
  // Reserved for future skywriter rendering; no invented human placeholders.
  function skywriterMessage(random) { return pick(unseen(humanText.Skywriters || []), random); }
  function messageEntry(date, location, random) {
    validDate(date);
    const context = normalizedLocation(location);
    const parts = localParts(date, context.timezone);
    const name = holidayForParts(parts);
    const hourly = humanText['Hour ' + String(parts.hour).padStart(2, '0')] || [];
    const anytime = humanText['Any time of day'] || [];
    // The hour is a display label, not a new line for seven-day seen history.
    const humanEntry = text => anytime.includes(text) ?
      {text: hourLabel(parts.hour) + '. ' + text, seenKey: text, author: 'Human'} : {text, author: 'Human'};
    const human = unique([
      ...hourly, ...(humanText['Holiday ' + name] || []),
      ...anytime,
    ]);
    if (human.length) {
      const available = unseen(human);
      if (available.length) return humanEntry(pick(available, random));
    }
    // Only human hourly copy may recycle. No AI fallback on load, holidays,
    // or after exhausting the human holiday/anytime pool.
    return hourly.length ? humanEntry(pick(unique(hourly), random)) : {text: '', author: null};
  }

  function message(date, location, random) { return messageEntry(date, location, random).text; }

  function holiday(date, location) {
    validDate(date);
    const context = normalizedLocation(location);
    return holidayForParts(localParts(date, context.timezone));
  }

  const messageCatalog=HOUR_LINES.flatMap((lines,hour)=>lines.map(text=>({hour,text})));
  const holidayCatalog = Object.freeze(Object.keys(HOLIDAY_LINES).map(name => Object.freeze({
    name,
    variantCount: HOLIDAY_LINES[name].length,
  })));

  const api = Object.freeze({
    season, palette, clock, period, holiday, message, messages: message,
    setHumanText, messageEntry, airplaneMessage, skywriterMessage, configureHistory, recordSeen,
    messageCatalog: Object.freeze(messageCatalog), messageCount: messageCatalog.length,
    holidayCatalog,
    periods: Object.freeze(PERIOD_NAMES.slice()),
  });
  root.LandscapeMood = api;
})(globalThis);
