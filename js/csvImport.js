// Parses a Flighty CSV export into this app's flight record schema.
const CSVUtils = (() => {
  // Minimal RFC4180-ish CSV parser (handles quoted fields, embedded commas/newlines).
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
    }
    return rows;
  }

  // "2023-08-31T09:53" -> { date: "2023-08-31", time: "09:53" }; null if empty/malformed.
  function splitDateTime(raw) {
    if (!raw) return null;
    const [datePart, timePart] = raw.split("T");
    if (!datePart || !timePart || timePart.length < 4) return null;
    return { date: datePart, time: timePart.slice(0, 5) };
  }

  function firstNonEmpty(...vals) {
    for (const v of vals) if (v) return v;
    return "";
  }

  // Parses Flighty's CSV export format into flight records.
  // Returns { records, unknownAirports, unknownAirlines }.
  function parseFlightyCSV(text, knownAirportCodes) {
    const rows = parseCSV(text.trim());
    if (!rows.length) return { records: [], unknownAirports: [], unknownAirlines: [] };

    const header = rows[0];
    const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    const col = (row, name) => (idx[name] !== undefined ? (row[idx[name]] || "").trim() : "");

    const unknownAirports = new Set();
    const unknownAirlines = new Set();
    const records = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((f) => f === "")) continue;
      if (col(row, "Canceled").toLowerCase() === "true") continue;

      const airlineCode = col(row, "Airline");
      const flightNum = col(row, "Flight");
      const origin = col(row, "From");
      const destination = col(row, "To");
      if (!origin || !destination) continue;

      if (knownAirportCodes && !knownAirportCodes.has(origin)) unknownAirports.add(origin);
      if (knownAirportCodes && !knownAirportCodes.has(destination)) unknownAirports.add(destination);
      if (airlineCode && !AIRLINES[airlineCode]) unknownAirlines.add(airlineCode);

      const depSource = firstNonEmpty(
        col(row, "Gate Departure (Actual)"),
        col(row, "Gate Departure (Scheduled)"),
        col(row, "Take off (Actual)"),
        col(row, "Take off (Scheduled)")
      );
      const arrSource = firstNonEmpty(
        col(row, "Gate Arrival (Actual)"),
        col(row, "Gate Arrival (Scheduled)"),
        col(row, "Landing (Actual)"),
        col(row, "Landing (Scheduled)")
      );
      const dep = splitDateTime(depSource);
      const arr = splitDateTime(arrSource);
      // Only trust the times when both ends are known; a lone "T00:00" is Flighty's
      // placeholder for a quickly-logged flight with no real time captured.
      const hasRealTimes = Boolean(dep && arr);

      const date = (dep && dep.date) || col(row, "Date");
      const cabin = col(row, "Cabin Class");
      const notes = col(row, "Notes");
      const noteParts = [cabin, notes].filter(Boolean);

      records.push({
        id: col(row, "Flight Flighty ID") || `${date}-${airlineCode}${flightNum}-${origin}-${destination}`,
        date,
        airline: AIRLINES[airlineCode] || airlineCode,
        flightNumber: `${airlineCode}${flightNum}`.trim(),
        origin,
        destination,
        departTime: hasRealTimes ? dep.time : "",
        arriveTime: hasRealTimes ? arr.time : "",
        arriveDate: hasRealTimes && arr.date !== date ? arr.date : "",
        aircraft: col(row, "Aircraft Type Name"),
        seat: col(row, "Seat"),
        notes: noteParts.join(" — "),
      });
    }

    return { records, unknownAirports: [...unknownAirports], unknownAirlines: [...unknownAirlines] };
  }

  // ---------- Generic CSV (any spreadsheet with recognizable column names) ----------
  const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ALIASES = {
    date: ["date", "flightdate", "departuredate", "depdate"],
    airline: ["airline", "carrier", "airlinecode", "airlinename"],
    flight: ["flight", "flightnumber", "flightno", "flightnum", "flt"],
    from: ["from", "origin", "departure", "departureairport", "dep", "orig", "origincode", "fromairport"],
    to: ["to", "destination", "arrival", "arrivalairport", "arr", "dest", "destinationcode", "toairport"],
    departTime: ["departtime", "departuretime", "deptime", "std", "departs"],
    arriveTime: ["arrivetime", "arrivaltime", "arrtime", "sta", "arrives"],
    arriveDate: ["arrivedate", "arrivaldate", "arrdate"],
    aircraft: ["aircraft", "aircrafttype", "plane", "equipment"],
    seat: ["seat", "seatnumber"],
    notes: ["notes", "note", "comments", "comment", "class", "cabin", "cabinclass"],
  };

  function airportCode(raw) {
    const m = String(raw || "").toUpperCase().match(/\b[A-Z]{3}\b/);
    return m ? m[0] : "";
  }

  // Accepts "2024-03-05", "2024-03-05 14:30", "2024-03-05T14:30", "14:30", "2:30 PM".
  function parseLooseDateTime(raw) {
    const s = String(raw || "").trim();
    let date = "";
    let rest = s;
    const dm = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (dm) {
      date = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
      rest = s.slice(dm[0].length);
    }
    const tm = rest.match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
    let time = "";
    if (tm) {
      let h = Number(tm[1]);
      if (tm[3]) h = (h % 12) + (/p/i.test(tm[3]) ? 12 : 0);
      if (h < 24) time = `${String(h).padStart(2, "0")}:${tm[2]}`;
    }
    return { date, time };
  }

  function parseGenericCSV(rows, knownAirportCodes) {
    const headerKeys = rows[0].map(norm);
    const colIdx = {};
    for (const [field, names] of Object.entries(ALIASES)) {
      const i = headerKeys.findIndex((h) => names.includes(h));
      if (i >= 0) colIdx[field] = i;
    }
    const get = (row, f) => (colIdx[f] !== undefined ? (row[colIdx[f]] || "").trim() : "");
    if (colIdx.from === undefined || colIdx.to === undefined) {
      throw new Error('Could not find "From" and "To" airport columns in the header row.');
    }

    const records = [];
    const unknownAirports = new Set();
    const unknownAirlines = new Set();
    let skipped = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const origin = airportCode(get(row, "from"));
      const destination = airportCode(get(row, "to"));
      const dep = parseLooseDateTime(get(row, "departTime"));
      const arr = parseLooseDateTime(get(row, "arriveTime"));
      const date = parseLooseDateTime(get(row, "date")).date || dep.date;
      if (!origin || !destination || !date) { skipped++; continue; }

      let airlineCode = get(row, "airline");
      const flightNumber = get(row, "flight").replace(/\s+/g, "").toUpperCase();
      const fm = flightNumber.match(/^([A-Z0-9]{2,3}?)(\d{1,4})$/);
      if (fm && !airlineCode) airlineCode = fm[1];
      const upper = airlineCode.toUpperCase();

      if (knownAirportCodes && !knownAirportCodes.has(origin)) unknownAirports.add(origin);
      if (knownAirportCodes && !knownAirportCodes.has(destination)) unknownAirports.add(destination);
      if (airlineCode && airlineCode.length <= 3 && !AIRLINES[upper]) unknownAirlines.add(airlineCode);

      const hasTimes = Boolean(dep.time && arr.time);
      const arriveDate = parseLooseDateTime(get(row, "arriveDate")).date || arr.date;
      records.push({
        id: `${date}-${flightNumber || upper}-${origin}-${destination}`,
        date,
        airline: AIRLINES[upper] || airlineCode,
        flightNumber,
        origin,
        destination,
        departTime: hasTimes ? dep.time : "",
        arriveTime: hasTimes ? arr.time : "",
        arriveDate: hasTimes && arriveDate && arriveDate !== date ? arriveDate : "",
        aircraft: get(row, "aircraft"),
        seat: get(row, "seat"),
        notes: get(row, "notes"),
      });
    }
    return { records, unknownAirports: [...unknownAirports], unknownAirlines: [...unknownAirlines], skipped };
  }

  // ---------- Calendar (.ics) ----------
  function unfoldICS(text) {
    return text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  }

  function unescapeICS(v) {
    return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  }

  // "DTSTART;TZID=Europe/Paris:20240305T143000" -> { name, params, value }
  function parseICSLine(line) {
    const colon = line.indexOf(":");
    if (colon < 0) return null;
    const [name, ...params] = line.slice(0, colon).split(";");
    return { name: name.toUpperCase(), params: params.join(";").toUpperCase(), value: line.slice(colon + 1) };
  }

  // Returns { date, time, utc }; utc is true for "...Z" values and time is "" for all-day events.
  function parseICSDate(value) {
    const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z?))?$/);
    if (!m) return null;
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : "", utc: m[6] === "Z" };
  }

  function utcToLocal(d, tz) {
    const [h, mi] = d.time.split(":").map(Number);
    const [y, mo, da] = d.date.split("-").map(Number);
    const instant = new Date(Date.UTC(y, mo - 1, da, h, mi));
    const parts = GeoUtils.formatInZone(instant, tz, {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)/);
    if (!parts) return d;
    return { date: `${parts[3]}-${parts[1]}-${parts[2]}`, time: `${parts[4]}:${parts[5]}`, utc: false };
  }

  // Separators between two airport codes: arrows, dashes, ">", or the word "to".
  const ROUTE_RE = /\b([A-Z]{3})\s*(?:→|➔|✈|->|–|—|-|>|to|TO)\s*([A-Z]{3})\b/;

  function parseICS(text, knownAirportCodes, tzByCode) {
    const lines = unfoldICS(text);
    const records = [];
    const unknownAirports = new Set();
    const unknownAirlines = new Set();
    let skipped = 0;
    let ev = null;

    const finish = (e) => {
      const summary = e.SUMMARY || "";
      const blob = [e.SUMMARY, e.LOCATION, e.DESCRIPTION].filter(Boolean).join("\n");
      let origin = "", destination = "";
      const route = summary.match(ROUTE_RE) || blob.match(ROUTE_RE);
      if (route) {
        [origin, destination] = [route[1], route[2]];
      } else if (knownAirportCodes) {
        const found = [];
        for (const m of blob.matchAll(/\b[A-Z]{3}\b/g)) {
          if (knownAirportCodes.has(m[0]) && !found.includes(m[0])) found.push(m[0]);
        }
        [origin, destination] = found;
      }
      const start = e.DTSTART && parseICSDate(e.DTSTART.value);
      if (!origin || !destination || !start) { skipped++; return; }

      const fm = summary.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/);
      const airlineCode = fm ? fm[1] : "";
      const flightNumber = fm ? `${fm[1]}${fm[2]}` : "";
      if (knownAirportCodes && !knownAirportCodes.has(origin)) unknownAirports.add(origin);
      if (knownAirportCodes && !knownAirportCodes.has(destination)) unknownAirports.add(destination);

      let dep = start;
      let arr = e.DTEND ? parseICSDate(e.DTEND.value) : null;
      if (dep.utc && dep.time && tzByCode && tzByCode[origin]) dep = utcToLocal(dep, tzByCode[origin]);
      if (arr && arr.utc && arr.time && tzByCode && tzByCode[destination]) arr = utcToLocal(arr, tzByCode[destination]);
      const hasTimes = Boolean(dep.time && arr && arr.time);
      const seat = (blob.match(/\bseat:?\s*(\d{1,2}[A-K])\b/i) || [])[1] || "";

      records.push({
        id: e.UID ? `ics-${e.UID.value}` : `${dep.date}-${flightNumber}-${origin}-${destination}`,
        date: dep.date,
        airline: AIRLINES[airlineCode] || airlineCode,
        flightNumber,
        origin,
        destination,
        departTime: hasTimes ? dep.time : "",
        arriveTime: hasTimes ? arr.time : "",
        arriveDate: hasTimes && arr.date !== dep.date ? arr.date : "",
        aircraft: "",
        seat,
        notes: "",
      });
    };

    for (const line of lines) {
      if (line === "BEGIN:VEVENT") { ev = {}; continue; }
      if (line === "END:VEVENT") { if (ev) finish(ev); ev = null; continue; }
      if (!ev) continue;
      const p = parseICSLine(line);
      if (!p) continue;
      if (p.name === "SUMMARY" || p.name === "LOCATION" || p.name === "DESCRIPTION") ev[p.name] = unescapeICS(p.value);
      else if (p.name === "DTSTART" || p.name === "DTEND" || p.name === "UID") ev[p.name] = p;
    }
    return { records, unknownAirports: [...unknownAirports], unknownAirlines: [...unknownAirlines], skipped };
  }

  // Detects the format (calendar, Flighty CSV, or generic CSV) and parses accordingly.
  function parseImport(text, knownAirportCodes, tzByCode) {
    const clean = text.replace(/^﻿/, "");
    if (/^\s*BEGIN:VCALENDAR/i.test(clean)) return parseICS(clean, knownAirportCodes, tzByCode);
    const rows = parseCSV(clean.trim());
    if (!rows.length) return { records: [], unknownAirports: [], unknownAirlines: [], skipped: 0 };
    if (rows[0].some((h) => /flighty id|gate departure/i.test(h))) {
      return { ...parseFlightyCSV(clean, knownAirportCodes), skipped: 0 };
    }
    return parseGenericCSV(rows, knownAirportCodes);
  }

  return { parseCSV, parseFlightyCSV, parseICS, parseImport };
})();
