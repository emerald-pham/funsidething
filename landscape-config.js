/* Shared, immutable configuration for the living landscape. Every seasonal
   schedule, accent, weather bound and woodland roll belongs here so adding a
   new season does not scatter another set of constants through the renderers. */
(function (root) {
  'use strict';

  const freeze = value => Object.freeze(value);
  const freezeEntries = entries => freeze(entries.map(entry => freeze({ ...entry })));
  const BASE_EVENTS = freeze([
    'cyclist', 'bird', 'balloon', 'train', 'metro', 'plane', 'duck', 'fish',
    'butterfly', 'rabbit', 'deer', 'kite', 'reader', 'picnic', 'couple',
    'walker', 'airshow', 'banner', 'skywriter', 'hangglider', 'jetski', 'sailboat',
    'cruise', 'yacht', 'dolphin', 'flock', 'skateboarder', 'rollerskater',
    'hoverboard', 'scooter', 'windsurfer', 'dogwalker',
  ]);
  const WINTER_EVENTS = freeze([
    'train', 'metro', 'plane', 'balloon', 'skywriter', 'walker', 'dogwalker', 'deer',
    'rabbit', 'flock', 'snowman', 'skier', 'snowangel',
  ]);
  const NIGHT_EVENTS = freeze([
    'meteor', ...BASE_EVENTS.filter(type => !['bird', 'butterfly'].includes(type)),
  ]);
  const NIGHT_REGULARS = freeze(['meteor', 'metro', 'plane']);
  const WATER_EVENTS = freeze(['jetski', 'sailboat', 'cruise', 'yacht', 'dolphin', 'windsurfer']);

  const ACCENTS = freeze({
    spring: freeze({ sky: '#b9dfd2', city: '#a9cec5', far: '#b8d99f', hill: '#9fce94', front: '#79b88b', tint: '#cfe8c4' }),
    summer: freeze({ sky: '#f0d19a', city: '#d6b18a', far: '#d3d48e', hill: '#b8cb83', front: '#8bb47a', tint: '#f2d8a9' }),
    autumn: freeze({ sky: '#e8b594', city: '#d29a83', far: '#ead0a0', hill: '#d7ad78', front: '#c69762', tint: '#e8b189' }),
    winter: freeze({ sky: '#bfcee8', city: '#aabbd6', far: '#f4f5ed', hill: '#dce9e6', front: '#b0c8c4', tint: '#d1dbef' }),
  });

  // Weights keep the familiar transit and walking rhythm visible while a
  // balloon retains roughly a ten percent daytime share as the pool grows.
  const DAY_WEIGHTS = freeze({ balloon: 5, walker: 4, cyclist: 3, train: 3, metro: 3,
    hoverboard: 2, scooter: 2, skateboarder: 2, rollerskater: 2 });
  const DAY_ENTRIES = freezeEntries(BASE_EVENTS.map(type => ({ type, weight: DAY_WEIGHTS[type] || 1 })));
  const WINTER_DAY_ENTRIES = freezeEntries(WINTER_EVENTS.map(type => ({ type, weight: 1 })));
  const NIGHT_ENTRIES = freezeEntries(NIGHT_EVENTS.map(type => ({ type, weight: 1 })));
  const WINTER_NIGHT_EVENTS = freeze(['meteor', ...WINTER_EVENTS]);
  const WINTER_NIGHT_ENTRIES = freezeEntries(WINTER_NIGHT_EVENTS.map(type => ({ type, weight: 1 })));

  const EVENT_DURATIONS = freeze({
    snowman: 180, skier: 75, snowangel: 100, dogwalker: 70, skateboarder: 65,
    rollerskater: 75, hoverboard: 65, scooter: 70, windsurfer: 95, fireworks: 9,
    flock: 65, dolphin: 8, duck: 80, fish: 5, butterfly: 35, rabbit: 22,
    deer: 55, kite: 90, reader: 140, picnic: 150, couple: 120, walker: 60,
    airshow: 40, banner: 100, skywriter: 90, hangglider: 90, meteor: 1.8, jetski: 32,
    sailboat: 140, cruise: 180, yacht: 95,
  });

  const WEATHER = freeze({
    slot: 10800000,
    showerMinutes: freeze([20, 45]),
    stormMinutes: freeze([30, 60]),
    chance: .35,
    stormChance: .35,
    startMinutes: freeze([15, 90]),
    rampMinutes: 2,
  });
  const WOODLAND = freeze({
    types: freeze(['deer', 'fox', 'rabbit', 'raccoon']),
    interval: 30,
    maxActive: 4,
    chance: .01,
    duration: 180,
  });

  const seasonConfig = {};
  for (const name of ['spring', 'summer', 'autumn']) {
    seasonConfig[name] = freeze({ name, events: BASE_EVENTS, accent: ACCENTS[name], mood: ACCENTS[name], dayEntries: DAY_ENTRIES, nightEntries: NIGHT_ENTRIES, weather: WEATHER });
  }
  seasonConfig.winter = freeze({ name: 'winter', events: WINTER_EVENTS, accent: ACCENTS.winter, mood: ACCENTS.winter, dayEntries: WINTER_DAY_ENTRIES, nightEntries: WINTER_NIGHT_ENTRIES, weather: WEATHER });

  // Markdown is data, never executable code. Validate the whole table before
  // replacing rates so a typo cannot partially change a scene's schedule.
  const spawnRateNames=freeze([...new Set([...BASE_EVENTS,...WINTER_EVENTS,'meteor','abduction','fireworks',
    ...WOODLAND.types.map(type=>'woodland-'+type),'rain','thunderstorm','snow','snowstorm',
    ...['spring','summer','autumn','winter'].map(season=>'ambience-'+season)])]);
  let rates=Object.create(null);
  function spawnRate(type){return rates[type] ?? 1;}
  function setSpawnRates(markdown){
    const next=Object.create(null);let count=0;
    for(const line of String(markdown).split(/\r?\n/)){
      if(!line.trim().startsWith('|'))continue;
      const cells=line.split('|').slice(1,-1).map(cell=>cell.trim());
      if(cells[0]==='Event'||cells.every(cell=>/^:?-+:?$/.test(cell)))continue;
      if(cells.length!==2||!spawnRateNames.includes(cells[0])||!/^\d+(?:\.\d+)?$/.test(cells[1]))return false;
      const value=Number(cells[1]);
      if(!Number.isFinite(value)||value>10||Object.hasOwn(next,cells[0]))return false;
      next[cells[0]]=value;count++;
    }
    if(!count)return false;
    rates=next;return true;
  }

  function fraction(random) {
    let value;
    try { value = typeof random === 'function' ? random() : random; } catch { value = 0; }
    return Number.isFinite(value) ? Math.max(0, Math.min(.999999999, value)) : 0;
  }
  function entriesFor(season, phase) {
    if (phase === 'night') return (seasonConfig[season] || seasonConfig.summer).nightEntries;
    return (seasonConfig[season] || seasonConfig.summer).dayEntries;
  }
  function pickEvent(season = 'summer', phase = 'day', random = Math.random) {
    const entries = entriesFor(season, phase).map(entry=>({...entry,weight:entry.weight*spawnRate(entry.type)}));
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if(!total)return null;
    let cursor = fraction(random) * total;
    for (const entry of entries) {
      if (cursor < entry.weight) return entry.type;
      cursor -= entry.weight;
    }
    return entries[entries.length - 1].type;
  }

  const API = freeze({
    version: 1,
    spawnRateNames, spawnRate, setSpawnRates,
    rail: freeze({train: freeze({duration:65,gap:12}),metro: freeze({duration:50,gap:8})}),
    seasons: freeze(seasonConfig),
    eventTypes: BASE_EVENTS,
    winterEvents: WINTER_EVENTS,
    nightEvents: NIGHT_EVENTS,
    winterNightEvents: WINTER_NIGHT_EVENTS,
    nightRegulars: NIGHT_REGULARS,
    waterEvents: WATER_EVENTS,
    pools: freeze({
      day: DAY_ENTRIES,
      winterDay: WINTER_DAY_ENTRIES,
      night: NIGHT_ENTRIES,
    }),
    weather: WEATHER,
    durations: EVENT_DURATIONS,
    eventDurations: EVENT_DURATIONS,
    woodland: WOODLAND,
    pickEvent,
    eventsForSeason: season => (seasonConfig[season] || seasonConfig.summer).events.slice(),
  });
  root.LandscapeConfig = API;
})(globalThis);
