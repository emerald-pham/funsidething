# Solar-time audit — September 19, 2026

The app calculates solar events offline using the bundled Astronomy Engine and the saved sky location's latitude, longitude, and IANA time zone. The selected location's calendar day determines the search window. Searches span two UTC days and then reject events outside the requested local day, covering 23- and 25-hour daylight-saving dates.

## Four separate events

- **First light:** beginning of civil twilight, geometric solar center ascending through −6°.
- **Sunrise:** the Sun's upper limb rises through the horizon, including standard atmospheric refraction.
- **Sunset:** the Sun's upper limb sets below the horizon, including standard atmospheric refraction.
- **Last light:** end of civil twilight, geometric solar center descending through −6°.

First/last light here explicitly means civil twilight, not astronomical twilight. Definitions follow the [National Weather Service](https://www.weather.gov/fsd/twilight); calculations use Astronomy Engine's [SearchAltitude and SearchRiseSet](https://github.com/cosinekitty/astronomy/blob/master/source/js/README.md#SearchAltitude). These are standard unobstructed-horizon predictions, not terrain- or weather-specific observations.

## Independent reference checks

Compared all four events against the U.S. Naval Observatory one-day tables, retrieved September 19, 2026. Signed differences below are app prediction minus the USNO published minute. Every available event was within 30 seconds; tests allow two minutes for model and published-minute differences. A dash means neither source predicts that event on the local date.

| Location | Local date | First light | Sunrise | Sunset | Last light |
| --- | --- | --- | --- | --- | --- |
| London | 2026-09-19 | 10s | -20s | -8s | 15s |
| Orlando | 2026-06-21 | -25s | -27s | 13s | 10s |
| Sydney | 2026-12-21 | 29s | -23s | 25s | -26s |
| New York DST | 2026-03-08 | -24s | -7s | 12s | -28s |
| Kathmandu | 2026-03-20 | -18s | 3s | -10s | 12s |
| Kiritimati | 2026-01-01 | 0s | 27s | -25s | 2s |
| Tromso winter | 2026-12-21 | 15s | — | — | 8s |
| Tromso summer | 2026-06-21 | — | — | — | — |

The fixtures cover both hemispheres, the New York spring DST transition, Kathmandu's quarter-hour offset, Kiritimati's +14-hour date-line zone, and Tromsø's polar seasons. Existing tests also cover fall DST, London and Sydney transitions, leap-year seasons, astronomical equinox/solstice boundaries, and both hemispheres' seasonal overrides.

A season override uses a representative date (the 15th of January, April, July, or October), shifted by six months in the southern hemisphere. Solar presets use that date in the observer's zone. The dialog exposes the effective date and time zone instead of implying the preview is today's sky. Manual clock input remains explicitly device-local. At polar locations unavailable events are shown as “Does not occur”; selecting one follows live time. Polar winter can still have first/last light without a sunrise or sunset.

The audit found no numerical sunrise/sunset defect in the reference cases. The missing distinction was civil twilight: it is now calculated and displayed separately, with four named presets and local clock times.

### Reference requests

- [London — 2026-09-19](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-19&coords=51.5,-0.12&tz=1)
- [Orlando — 2026-06-21](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=28.5383,-81.3792&tz=-4)
- [Sydney — 2026-12-21](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=-33.87,151.21&tz=11)
- [New York DST — 2026-03-08](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-08&coords=40.71,-74.01&tz=-4)
- [Kathmandu — 2026-03-20](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-20&coords=27.72,85.32&tz=5.75)
- [Kiritimati — 2026-01-01](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-01-01&coords=1.87,-157.43&tz=14)
- [Tromso winter — 2026-12-21](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=69.65,18.96&tz=1)
- [Tromso summer — 2026-06-21](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=69.65,18.96&tz=2)
