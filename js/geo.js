// Geo + time math: distances, great-circle interpolation, solar terminator, timezone conversions.
const GeoUtils = (() => {
  const RAD = Math.PI / 180;
  const EARTH_RADIUS_KM = 6371;

  function toRad(deg) { return deg * RAD; }
  function toDeg(rad) { return rad / RAD; }

  // Great-circle distance between two lat/lon points, in km.
  function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
  }

  // Spherical interpolation between two points along the great circle.
  // Returns an array of [lat, lon] points, split into segments where the
  // path crosses the antimeridian (so Leaflet doesn't draw a line across the whole map).
  function greatCirclePath(lat1, lon1, lat2, lon2, numPoints = 64) {
    const phi1 = toRad(lat1), lam1 = toRad(lon1);
    const phi2 = toRad(lat2), lam2 = toRad(lon2);

    const d =
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin((phi2 - phi1) / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
        )
      );

    const rawPoints = [];
    if (d === 0) {
      rawPoints.push([lat1, lon1]);
    } else {
      for (let i = 0; i <= numPoints; i++) {
        const f = i / numPoints;
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
        const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
        const z = A * Math.sin(phi1) + B * Math.sin(phi2);
        const phi = Math.atan2(z, Math.sqrt(x * x + y * y));
        const lam = Math.atan2(y, x);
        rawPoints.push([toDeg(phi), toDeg(lam)]);
      }
    }

    // Split into segments wherever the path jumps across the +/-180 meridian.
    const segments = [];
    let current = [rawPoints[0]];
    for (let i = 1; i < rawPoints.length; i++) {
      const prevLon = current[current.length - 1][1];
      const [lat, lon] = rawPoints[i];
      if (Math.abs(lon - prevLon) > 180) {
        segments.push(current);
        current = [];
      }
      current.push([lat, lon]);
    }
    segments.push(current);
    return segments;
  }

  // --- Solar terminator (day/night line) ---
  // Standard low-precision solar position formulas (Astronomical Almanac approximations).
  function julianDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function sunEclipticPosition(jd) {
    const n = jd - 2451545.0;
    let L = (280.46 + 0.9856474 * n) % 360;
    if (L < 0) L += 360;
    let g = (357.528 + 0.9856003 * n) % 360;
    if (g < 0) g += 360;
    const lambda = L + 1.915 * Math.sin(toRad(g)) + 0.02 * Math.sin(toRad(2 * g));
    return lambda;
  }

  function eclipticObliquity(jd) {
    const n = jd - 2451545.0;
    const T = n / 36525;
    return 23.4393 - 0.0000004 * T;
  }

  function sunEquatorialPosition(lambda, obliquity) {
    const lambdaR = toRad(lambda);
    const obliquityR = toRad(obliquity);
    let alpha = toDeg(Math.atan2(Math.cos(obliquityR) * Math.sin(lambdaR), Math.cos(lambdaR)));
    const delta = toDeg(Math.asin(Math.sin(obliquityR) * Math.sin(lambdaR)));
    return { alpha, delta };
  }

  function gmstHours(jd) {
    const n = jd - 2451545.0;
    let gst = (280.46061837 + 360.98564736629 * n) % 360;
    if (gst < 0) gst += 360;
    return gst / 15;
  }

  // Returns the subsolar point { lat, lon } for a given Date.
  function subsolarPoint(date) {
    const jd = julianDate(date);
    const lambda = sunEclipticPosition(jd);
    const obliquity = eclipticObliquity(jd);
    const { alpha, delta } = sunEquatorialPosition(lambda, obliquity);
    const gst = gmstHours(jd); // hours
    // Subsolar longitude: where local sidereal time == right ascension.
    let lon = alpha - gst * 15;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return { lat: delta, lon };
  }

  // Builds a polygon (array of [lat,lon]) covering the night side of the globe for the given date.
  function nightPolygon(date, stepDeg = 2) {
    const jd = julianDate(date);
    const lambda = sunEclipticPosition(jd);
    const obliquity = eclipticObliquity(jd);
    const { alpha, delta } = sunEquatorialPosition(lambda, obliquity);
    const gst = gmstHours(jd);
    const deltaR = toRad(delta);

    const points = [];
    const pole = delta >= 0 ? -90 : 90; // pole that's fully dark

    points.push([pole, -180]);
    for (let lon = -180; lon <= 180; lon += stepDeg) {
      const lst = gst + lon / 15; // local sidereal time, hours
      const ha = lst * 15 - alpha; // hour angle, degrees
      const haR = toRad(ha);
      let lat;
      if (Math.abs(delta) < 1e-6) {
        lat = 0;
      } else {
        lat = toDeg(Math.atan(-Math.cos(haR) / Math.tan(deltaR)));
      }
      points.push([lat, lon]);
    }
    points.push([pole, 180]);
    return points;
  }

  // --- Timezone-aware conversions (handles DST correctly via Intl) ---

  // Offset in minutes of `timeZone` from UTC at the instant `date`.
  function tzOffsetMinutes(date, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(date).reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    return (asUTC - date.getTime()) / 60000;
  }

  // Converts a "wall clock" date+time string as observed in `timeZone` into a UTC Date.
  function zonedTimeToUtc(dateStr, timeStr, timeZone) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
    let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
    for (let i = 0; i < 2; i++) {
      const offset = tzOffsetMinutes(guess, timeZone);
      guess = new Date(Date.UTC(y, m - 1, d, hh, mm) - offset * 60000);
    }
    return guess;
  }

  function formatInZone(date, timeZone, opts) {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(date);
  }

  function isDaytime(date, timeZone) {
    const hourStr = formatInZone(date, timeZone, { hour: "2-digit", hourCycle: "h23" });
    const hour = Number(hourStr);
    return hour >= 6 && hour < 18;
  }

  function countryFlagEmoji(iso2) {
    if (!iso2 || iso2.length !== 2) return "";
    const codePoints = [...iso2.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  }

  return {
    haversineKm,
    greatCirclePath,
    subsolarPoint,
    nightPolygon,
    tzOffsetMinutes,
    zonedTimeToUtc,
    formatInZone,
    isDaytime,
    countryFlagEmoji,
  };
})();
