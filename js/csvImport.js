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

  return { parseCSV, parseFlightyCSV };
})();
