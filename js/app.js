// Globetrotter app: state, map, flight log, passport card, live clocks.
(() => {
  const STORAGE_FLIGHTS = "globetrotter_flights";
  const STORAGE_SETTINGS = "globetrotter_settings";

  let airports = loadAllAirports();
  const airportByCode = () => Object.fromEntries(airports.map((a) => [a.code, a]));

  const defaultSettings = {
    homeCode: "HYD",
    firstUse: new Date().toISOString().slice(0, 10),
  };

  function loadSettings() {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || "{}") };
    } catch (e) {
      return { ...defaultSettings };
    }
  }
  function saveSettings(s) {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(s));
  }

  function loadFlights() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_FLIGHTS) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveFlights(flights) {
    localStorage.setItem(STORAGE_FLIGHTS, JSON.stringify(flights));
  }

  let settings = loadSettings();
  if (!localStorage.getItem(STORAGE_SETTINGS)) saveSettings(settings);
  let flights = loadFlights();

  // First-ever open with no saved flights: seed from the bundled Flighty export
  // so the app isn't empty. Runs once (tracked separately from `flights` so
  // deliberately deleting all flights later doesn't bring the seed back).
  if (!flights.length && !localStorage.getItem("globetrotter_seeded") && typeof SEED_FLIGHTS !== "undefined") {
    flights = SEED_FLIGHTS.map((f) => ({ ...f }));
    saveFlights(flights);
  }
  localStorage.setItem("globetrotter_seeded", "1");

  // One-time data fix for browsers seeded before the Kedarnath correction: the
  // original export had a bogus DED->NNS row (wrong airline/route for what was
  // actually a Phata-Kedarnath helicopter round trip). Runs once, then leaves
  // whatever the user does afterward (deletions included) alone.
  (function migrateKedarnath() {
    const MIGRATION_KEY = "globetrotter_migrated_kedarnath_v1";
    if (localStorage.getItem(MIGRATION_KEY)) return;
    let changed = false;

    const badIndex = flights.findIndex((f) => f.origin === "DED" && f.destination === "NNS");
    if (badIndex !== -1) {
      flights.splice(badIndex, 1);
      changed = true;
    }

    const kedarnathNote = "Kedarnath yatra heli service. Date is approximate — edit if you remember the exact day.";
    if (!flights.some((f) => f.origin === "PHT" && f.destination === "KDN")) {
      flights.push({
        id: "seed-kedarnath-outbound", date: "2012-05-15", airline: "Pawan Hans", flightNumber: "",
        origin: "PHT", destination: "KDN", departTime: "", arriveTime: "", arriveDate: "",
        aircraft: "Helicopter", seat: "", notes: kedarnathNote,
      });
      changed = true;
    }
    if (!flights.some((f) => f.origin === "KDN" && f.destination === "PHT")) {
      flights.push({
        id: "seed-kedarnath-return", date: "2012-05-15", airline: "Pawan Hans", flightNumber: "",
        origin: "KDN", destination: "PHT", departTime: "", arriveTime: "", arriveDate: "",
        aircraft: "Helicopter", seat: "", notes: kedarnathNote,
      });
      changed = true;
    }

    if (changed) saveFlights(flights);
    localStorage.setItem(MIGRATION_KEY, "1");
  })();

  let editingId = null;

  // ---------- Map setup ----------
  const map = L.map("map", {
    worldCopyJump: true,
    zoomControl: true,
    minZoom: 2,
    maxBoundsViscosity: 0.6,
  }).setView([20, 30], 2);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
      maxZoom: 18,
    }
  ).addTo(map);

  const nightLayer = L.polygon([], {
    stroke: false,
    fillColor: "#0b1030",
    fillOpacity: 0.38,
    interactive: false,
  }).addTo(map);

  function updateTerminator() {
    const poly = GeoUtils.nightPolygon(new Date());
    nightLayer.setLatLngs(poly);
  }

  const routesLayer = L.layerGroup().addTo(map);
  const airportsLayer = L.layerGroup().addTo(map);

  function airportPopupHtml(airport) {
    const flag = GeoUtils.countryFlagEmoji(airport.country);
    return `<div class="map-popup">
      <div class="map-popup-code">${airport.code} ${flag}</div>
      <div class="map-popup-name">${airport.name}</div>
      <div class="map-popup-city">${airport.city}</div>
      <div class="map-popup-time" data-tz="${airport.tz}">--:--</div>
    </div>`;
  }

  function renderMap() {
    routesLayer.clearLayers();
    airportsLayer.clearLayers();
    const byCode = airportByCode();
    const visited = new Set();

    flights.forEach((f) => {
      const o = byCode[f.origin];
      const d = byCode[f.destination];
      if (!o || !d) return;
      visited.add(o.code);
      visited.add(d.code);
      const segments = GeoUtils.greatCirclePath(o.lat, o.lon, d.lat, d.lon, 80);
      segments.forEach((seg) => {
        L.polyline(seg, {
          color: "#e0762c",
          weight: 2,
          opacity: 0.85,
          smoothFactor: 1,
        }).addTo(routesLayer);
      });
    });

    visited.forEach((code) => {
      const a = byCode[code];
      if (!a) return;
      const isHome = code === settings.homeCode;
      const marker = L.circleMarker([a.lat, a.lon], {
        radius: isHome ? 7 : 5,
        color: isHome ? "#1c3faa" : "#b91c1c",
        weight: isHome ? 2 : 1.5,
        fillColor: isHome ? "#3b62e0" : "#e04b4b",
        fillOpacity: 0.9,
      }).addTo(airportsLayer);
      marker.bindPopup(airportPopupHtml(a));
      marker.on("popupopen", () => {
        const el = document.querySelector(`.map-popup-time[data-tz="${a.tz}"]`);
        if (el) tickPopup(el, a.tz);
      });
    });
  }

  let popupInterval = null;
  function tickPopup(el, tz) {
    clearInterval(popupInterval);
    const update = () => {
      el.textContent = GeoUtils.formatInZone(new Date(), tz, {
        hour: "2-digit", minute: "2-digit", hourCycle: "h12",
      }) + (GeoUtils.isDaytime(new Date(), tz) ? " ☀️" : " 🌙");
    };
    update();
    popupInterval = setInterval(update, 1000 * 15);
  }

  // ---------- Stats & Passport card ----------
  function computeStats() {
    const byCode = airportByCode();
    const airportSet = new Set();
    const airlineSet = new Set();
    const countrySet = new Set();
    let totalKm = 0;
    let totalMinutes = 0;

    flights.forEach((f) => {
      const o = byCode[f.origin];
      const d = byCode[f.destination];
      if (o) { airportSet.add(o.code); countrySet.add(o.country); }
      if (d) { airportSet.add(d.code); countrySet.add(d.country); }
      if (f.airline) airlineSet.add(f.airline.trim());
      if (o && d) totalKm += GeoUtils.haversineKm(o.lat, o.lon, d.lat, d.lon);
      totalMinutes += flightDurationMinutes(f);
    });

    const dates = flights.map((f) => f.date).filter(Boolean).sort();
    const memberSince = dates.length ? dates[0] : settings.firstUse;

    return {
      flightCount: flights.length,
      distanceKm: Math.round(totalKm),
      totalMinutes: Math.round(totalMinutes),
      airportCount: airportSet.size,
      airlineCount: airlineSet.size,
      countries: [...countrySet],
      memberSince,
    };
  }

  function flightDurationMinutes(f) {
    if (f.departTime && f.arriveTime) {
      const byCode = airportByCode();
      const o = byCode[f.origin];
      const d = byCode[f.destination];
      if (o && d && f.date) {
        const depUtc = GeoUtils.zonedTimeToUtc(f.date, f.departTime, o.tz);
        let arriveDate = f.arriveDate || f.date;
        const arrUtc = GeoUtils.zonedTimeToUtc(arriveDate, f.arriveTime, d.tz);
        let diffMin = (arrUtc - depUtc) / 60000;
        if (diffMin < 0) diffMin += 24 * 60; // guard against bad input
        return diffMin;
      }
    }
    if (f.durationMinutes) return Number(f.durationMinutes);
    // Fallback estimate: distance / 800kmh + 30min overhead
    const byCode = airportByCode();
    const o = byCode[f.origin];
    const d = byCode[f.destination];
    if (o && d) {
      const km = GeoUtils.haversineKm(o.lat, o.lon, d.lat, d.lon);
      return (km / 800) * 60 + 30;
    }
    return 0;
  }

  function formatDuration(totalMinutes) {
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    const mins = Math.round(totalMinutes % 60);
    return `${hours}h ${mins}m`;
  }

  function formatDateLong(dateStr) {
    if (!dateStr) return "--";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).toUpperCase();
  }

  // Animates a number counting up from 0 to `target`, respecting reduced-motion.
  function animateCountUp(el, target, { duration = 900, format = (n) => Math.round(n).toString() } = {}) {
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { el.textContent = format(target); return; }
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(target * eased);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = format(target);
    }
    requestAnimationFrame(tick);
  }

  function renderPassport() {
    const stats = computeStats();
    const byCode = airportByCode();
    const home = byCode[settings.homeCode];

    animateCountUp(document.getElementById("stat-flights"), stats.flightCount);
    animateCountUp(document.getElementById("stat-distance"), stats.distanceKm, { format: (n) => Math.round(n).toLocaleString("en-IN") });
    document.getElementById("stat-time").textContent = formatDuration(stats.totalMinutes);
    animateCountUp(document.getElementById("stat-airports"), stats.airportCount);
    animateCountUp(document.getElementById("stat-airlines"), stats.airlineCount);
    document.getElementById("place-of-issue").textContent = home ? home.code : settings.homeCode;
    document.getElementById("date-of-issue").textContent = formatDateLong(settings.firstUse);
    document.getElementById("member-since").textContent = formatDateLong(stats.memberSince);

    const flagsRow = document.getElementById("flags-row");
    flagsRow.innerHTML = stats.countries
      .map((c) => `<span title="${c}">${GeoUtils.countryFlagEmoji(c)}</span>`)
      .join("");

    const mrz1 = `ALLTIME<<<<MEMBER${stats.memberSince.replace(/-/g, "")}<<@GLOBETROTTER<<<<<<<<<<<<<<<<<`;
    const mrz2 = `ISSUED${settings.firstUse.replace(/-/g, "")}${(home ? home.code : "").padEnd(3, "<")}<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`;
    document.getElementById("mrz-1").textContent = mrz1.slice(0, 44);
    document.getElementById("mrz-2").textContent = mrz2.slice(0, 44);
  }

  // ---------- Dashboard ----------
  function aircraftManufacturer(str) {
    if (!str) return "Unknown";
    if (/boeing/i.test(str)) return "Boeing";
    if (/airbus/i.test(str)) return "Airbus";
    return "Other";
  }

  function computeDashboard() {
    const byCode = airportByCode();
    const yearCounts = {};
    const airlineCounts = {};
    const manufacturerCounts = { Boeing: 0, Airbus: 0, Other: 0, Unknown: 0 };
    let domestic = 0, international = 0;
    const routeCounts = {};
    let longest = null;
    let shortest = null;

    flights.forEach((f) => {
      const year = (f.date || "").slice(0, 4);
      if (year) yearCounts[year] = (yearCounts[year] || 0) + 1;
      if (f.airline) airlineCounts[f.airline] = (airlineCounts[f.airline] || 0) + 1;
      manufacturerCounts[aircraftManufacturer(f.aircraft)]++;

      const o = byCode[f.origin];
      const d = byCode[f.destination];
      if (o && d) {
        if (o.country === d.country) domestic++; else international++;
        const km = GeoUtils.haversineKm(o.lat, o.lon, d.lat, d.lon);
        const key = [f.origin, f.destination].sort().join("-");
        if (!routeCounts[key]) routeCounts[key] = { label: `${f.origin} ↔ ${f.destination}`, count: 0, km };
        routeCounts[key].count++;
        if (!longest || km > longest.km) longest = { km, label: `${f.origin} → ${f.destination}` };
        if (!shortest || km < shortest.km) shortest = { km, label: `${f.origin} → ${f.destination}` };
      }
    });

    let busiestYear = "--";
    let busiestYearCount = 0;
    Object.entries(yearCounts).forEach(([y, c]) => {
      if (c > busiestYearCount) { busiestYear = y; busiestYearCount = c; }
    });

    return { yearCounts, airlineCounts, manufacturerCounts, domestic, international, routeCounts, longest, shortest, busiestYear, busiestYearCount };
  }

  function kpiTile(label, value) {
    const el = document.createElement("div");
    el.className = "pstat";
    el.innerHTML = `<div class="pstat-label">${label}</div><div class="pstat-value">${value}</div>`;
    return el;
  }

  function kpiTileAnimated(label, target, format) {
    const el = document.createElement("div");
    el.className = "pstat";
    el.innerHTML = `<div class="pstat-label">${label}</div><div class="pstat-value"></div>`;
    animateCountUp(el.querySelector(".pstat-value"), target, format ? { format } : {});
    return el;
  }

  function renderBarList(containerEl, items, colorVar) {
    containerEl.innerHTML = "";
    if (!items.length) {
      containerEl.innerHTML = `<div class="empty-state">No data yet.</div>`;
      return;
    }
    const max = Math.max(...items.map((i) => i.value));
    const fills = [];
    items.forEach((item, i) => {
      const pct = max ? Math.round((item.value / max) * 100) : 0;
      const row = document.createElement("div");
      row.className = "bar-row";
      row.title = `${item.label}: ${item.value}`;
      row.innerHTML = `
        <div class="bar-label">${item.label}</div>
        <div class="bar-track"><div class="bar-fill" style="background:var(${colorVar}); transition-delay:${i * 60}ms"></div></div>
        <div class="bar-value">${item.value}</div>`;
      containerEl.appendChild(row);
      fills.push({ el: row.querySelector(".bar-fill"), pct });
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fills.forEach(({ el, pct }) => { el.style.width = `${pct}%`; });
    }));
  }

  function renderStackedBar(barEl, legendEl, segments) {
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    barEl.innerHTML = "";
    legendEl.innerHTML = "";
    if (!total) {
      barEl.innerHTML = `<div class="empty-state">No data yet.</div>`;
      return;
    }
    const segEls = [];
    segments.filter((s) => s.value > 0).forEach((s, i) => {
      const pct = (s.value / total) * 100;
      const seg = document.createElement("div");
      seg.className = "stacked-segment";
      seg.style.background = s.color;
      seg.style.transitionDelay = `${i * 80}ms`;
      seg.title = `${s.label}: ${s.value} (${Math.round(pct)}%)`;
      barEl.appendChild(seg);
      segEls.push({ el: seg, pct });

      const legendItem = document.createElement("div");
      legendItem.className = "legend-item";
      legendItem.innerHTML = `<span class="legend-swatch" style="background:${s.color}"></span>${s.label} · ${s.value}`;
      legendEl.appendChild(legendItem);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      segEls.forEach(({ el, pct }) => { el.style.width = `${pct}%`; });
    }));
  }

  function renderContinents(stats) {
    const visited = new Set(stats.countries.map((c) => CONTINENTS[c]).filter(Boolean));
    const grid = document.getElementById("continents-grid");
    grid.innerHTML = ALL_CONTINENTS.map((name, i) => {
      const isVisited = visited.has(name);
      return `<div class="continent-chip ${isVisited ? "visited" : ""}" style="--i:${i}">
        <span class="continent-icon">${CONTINENT_ICONS[name]}</span>
        <span>${name}</span>
      </div>`;
    }).join("");
    return visited;
  }

  function renderDashboard() {
    const dash = computeDashboard();
    const stats = computeStats();

    const continentsVisited = renderContinents(stats);

    const kpiRow = document.getElementById("kpi-row");
    kpiRow.innerHTML = "";
    kpiRow.appendChild(kpiTileAnimated("Countries visited", stats.countries.length));
    kpiRow.appendChild(kpiTileAnimated("Continents covered", continentsVisited.size, (n) => `${Math.round(n)} of 7`));
    kpiRow.appendChild(kpiTileAnimated("Domestic flights", dash.domestic));
    kpiRow.appendChild(kpiTileAnimated("International flights", dash.international));
    kpiRow.appendChild(kpiTile("Longest flight", dash.longest ? `${Math.round(dash.longest.km).toLocaleString("en-IN")} km` : "--"));
    kpiRow.appendChild(kpiTile("Shortest flight", dash.shortest ? `${Math.round(dash.shortest.km).toLocaleString("en-IN")} km` : "--"));
    kpiRow.appendChild(kpiTile("Busiest year", dash.busiestYear !== "--" ? `${dash.busiestYear} (${dash.busiestYearCount})` : "--"));

    const years = Object.entries(dash.yearCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));
    renderBarList(document.getElementById("chart-years"), years, "--series-1");

    const airlines = Object.entries(dash.airlineCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, value]) => ({ label, value }));
    renderBarList(document.getElementById("chart-airlines"), airlines, "--series-1");

    renderStackedBar(
      document.getElementById("chart-aircraft"),
      document.getElementById("legend-aircraft"),
      [
        { label: "Boeing", value: dash.manufacturerCounts.Boeing, color: "var(--series-1)" },
        { label: "Airbus", value: dash.manufacturerCounts.Airbus, color: "var(--series-2)" },
        { label: "Other", value: dash.manufacturerCounts.Other, color: "var(--series-3)" },
        { label: "Not logged", value: dash.manufacturerCounts.Unknown, color: "var(--series-muted)" },
      ]
    );

    renderStackedBar(
      document.getElementById("chart-domestic"),
      document.getElementById("legend-domestic"),
      [
        { label: "Domestic", value: dash.domestic, color: "var(--series-1)" },
        { label: "International", value: dash.international, color: "var(--series-2)" },
      ]
    );

    const routesBody = document.getElementById("routes-table-body");
    const topRoutes = Object.values(dash.routeCounts).sort((a, b) => b.count - a.count).slice(0, 8);
    if (!topRoutes.length) {
      routesBody.innerHTML = `<tr><td colspan="3" class="empty-state">No data yet.</td></tr>`;
    } else {
      routesBody.innerHTML = topRoutes.map((r) => `
        <tr><td>${r.label}</td><td>${r.count}</td><td>${Math.round(r.km).toLocaleString("en-IN")} km</td></tr>
      `).join("");
    }
  }

  // ---------- Clocks ----------
  function renderClocks() {
    const byCode = airportByCode();
    const home = byCode[settings.homeCode];
    if (!home) return;

    function updateHome() {
      const now = new Date();
      const isDay = GeoUtils.isDaytime(now, home.tz);
      document.getElementById("home-time").textContent = GeoUtils.formatInZone(now, home.tz, {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      });
      document.getElementById("home-date").textContent = GeoUtils.formatInZone(now, home.tz, {
        weekday: "long", day: "numeric", month: "long",
      });
      document.getElementById("home-icon").textContent = isDay ? "☀️" : "🌙";
      document.getElementById("home-label").textContent = `${home.city} (${home.code})`;
      document.getElementById("home-clock").classList.toggle("is-day", isDay);
      document.getElementById("home-clock").classList.toggle("is-night", !isDay);
    }
    updateHome();
    setInterval(updateHome, 1000);

    // Strip of clocks for all visited airports (excluding home).
    const byCodeVisited = new Map();
    flights.forEach((f) => {
      [f.origin, f.destination].forEach((code) => {
        if (code && code !== settings.homeCode && byCode[code]) byCodeVisited.set(code, byCode[code]);
      });
    });

    const strip = document.getElementById("clock-strip");
    strip.innerHTML = "";
    [...byCodeVisited.values()].forEach((a) => {
      const card = document.createElement("div");
      card.className = "clock-card";
      card.innerHTML = `<div class="clock-card-code">${a.code}</div>
        <div class="clock-card-time">--:--</div>
        <div class="clock-card-city">${a.city}</div>`;
      strip.appendChild(card);
      const timeEl = card.querySelector(".clock-card-time");
      const tick = () => {
        const now = new Date();
        const isDay = GeoUtils.isDaytime(now, a.tz);
        const icon = isDay ? "☀️" : "🌙";
        timeEl.textContent = GeoUtils.formatInZone(now, a.tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) + " " + icon;
        card.classList.toggle("is-day", isDay);
        card.classList.toggle("is-night", !isDay);
      };
      tick();
      setInterval(tick, 1000 * 30);
    });
  }

  // ---------- Flight list ----------
  function renderFlightList() {
    const byCode = airportByCode();
    const listEl = document.getElementById("flight-list");
    if (!flights.length) {
      listEl.innerHTML = `<div class="empty-state">No flights logged yet. Click "Add Flight" to start building your passport.</div>`;
      return;
    }
    const sorted = [...flights].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    listEl.innerHTML = sorted.map((f, i) => {
      const o = byCode[f.origin];
      const d = byCode[f.destination];
      const km = o && d ? Math.round(GeoUtils.haversineKm(o.lat, o.lon, d.lat, d.lon)) : 0;
      const dur = formatDuration(flightDurationMinutes(f));
      return `<div class="flight-row" data-id="${f.id}" style="--row-i:${i}">
        <div class="flight-row-date">${formatDateLong(f.date)}</div>
        <div class="flight-row-route">
          <span class="route-code">${f.origin}</span>
          <span class="route-arrow">→</span>
          <span class="route-code">${f.destination}</span>
        </div>
        <div class="flight-row-meta">
          <span>${f.airline || "—"} ${f.flightNumber || ""}</span>
          <span>${km.toLocaleString("en-IN")} km</span>
          <span>${dur}</span>
        </div>
        <div class="flight-row-actions">
          <button class="icon-btn edit-flight" title="Edit">✎</button>
          <button class="icon-btn delete-flight" title="Delete">✕</button>
        </div>
      </div>`;
    }).join("");

    listEl.querySelectorAll(".edit-flight").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.closest(".flight-row").dataset.id;
        openFlightForm(flights.find((f) => f.id === id));
      });
    });
    listEl.querySelectorAll(".delete-flight").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.closest(".flight-row").dataset.id;
        if (confirm("Delete this flight?")) {
          flights = flights.filter((f) => f.id !== id);
          saveFlights(flights);
          renderAll();
        }
      });
    });
  }

  // ---------- Add/Edit Flight form ----------
  const dialog = document.getElementById("flight-dialog");
  const form = document.getElementById("flight-form");

  function populateAirportDatalist() {
    const dl = document.getElementById("airport-list");
    dl.innerHTML = airports
      .map((a) => `<option value="${a.code}">${a.city} — ${a.name}</option>`)
      .join("");
  }

  function openFlightForm(flight) {
    editingId = flight ? flight.id : null;
    form.reset();
    document.getElementById("dialog-title").textContent = flight ? "Edit Flight" : "Add Flight";
    if (flight) {
      form.date.value = flight.date || "";
      form.airline.value = flight.airline || "";
      form.flightNumber.value = flight.flightNumber || "";
      form.origin.value = flight.origin || "";
      form.destination.value = flight.destination || "";
      form.departTime.value = flight.departTime || "";
      form.arriveTime.value = flight.arriveTime || "";
      form.arriveDate.value = flight.arriveDate || "";
      form.aircraft.value = flight.aircraft || "";
      form.seat.value = flight.seat || "";
      form.notes.value = flight.notes || "";
    } else {
      form.date.value = new Date().toISOString().slice(0, 10);
    }
    dialog.showModal();
  }

  document.getElementById("add-flight-btn").addEventListener("click", () => openFlightForm(null));
  document.getElementById("cancel-dialog").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const byCode = airportByCode();
    const origin = form.origin.value.trim().toUpperCase();
    const destination = form.destination.value.trim().toUpperCase();
    if (!byCode[origin] || !byCode[destination]) {
      alert("Please choose valid airport codes from the suggestion list (or add a custom airport in Settings).");
      return;
    }
    const record = {
      id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      date: form.date.value,
      airline: form.airline.value.trim(),
      flightNumber: form.flightNumber.value.trim(),
      origin,
      destination,
      departTime: form.departTime.value,
      arriveTime: form.arriveTime.value,
      arriveDate: form.arriveDate.value,
      aircraft: form.aircraft.value.trim(),
      seat: form.seat.value.trim(),
      notes: form.notes.value.trim(),
    };
    if (editingId) {
      flights = flights.map((f) => (f.id === editingId ? record : f));
    } else {
      flights.push(record);
    }
    saveFlights(flights);
    dialog.close();
    renderAll();
  });

  // ---------- Settings ----------
  const settingsDialog = document.getElementById("settings-dialog");
  document.getElementById("settings-btn").addEventListener("click", () => {
    document.getElementById("home-airport-input").value = settings.homeCode;
    settingsDialog.showModal();
  });
  document.getElementById("cancel-settings").addEventListener("click", () => settingsDialog.close());

  document.getElementById("settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = document.getElementById("home-airport-input").value.trim().toUpperCase();
    if (!airportByCode()[code]) {
      alert("Unknown airport code. Add it as a custom airport first.");
      return;
    }
    settings.homeCode = code;
    saveSettings(settings);
    settingsDialog.close();
    renderAll();
  });

  document.getElementById("custom-airport-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const code = f.code.value.trim().toUpperCase();
    if (!code) return;
    addCustomAirport({
      code,
      name: f.name.value.trim() || code,
      city: f.city.value.trim() || code,
      country: f.country.value.trim().toUpperCase() || "XX",
      lat: parseFloat(f.lat.value),
      lon: parseFloat(f.lon.value),
      tz: f.tz.value.trim() || "UTC",
    });
    airports = loadAllAirports();
    populateAirportDatalist();
    f.reset();
    alert(`Added ${code} to your airport list.`);
  });

  // ---------- Export / Import ----------
  document.getElementById("export-btn").addEventListener("click", () => {
    const data = { flights, settings, customAirports: JSON.parse(localStorage.getItem("globetrotter_custom_airports") || "[]") };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `globetrotter-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("csv-import-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const known = new Set(airports.map((a) => a.code));
        const { records, unknownAirports, unknownAirlines } = CSVUtils.parseFlightyCSV(reader.result, known);
        const byId = new Map(flights.map((f) => [f.id, f]));
        let added = 0, updated = 0;
        records.forEach((rec) => {
          if (byId.has(rec.id)) updated++; else added++;
          byId.set(rec.id, rec);
        });
        flights = [...byId.values()];
        saveFlights(flights);
        settingsDialog.close();
        renderAll();

        let msg = `Imported ${records.length} flights (${added} new, ${updated} updated).`;
        if (unknownAirports.length) {
          msg += `\n\nThese airport codes aren't in the database yet, so those legs won't show on the map or count toward stats until you add them in Settings: ${unknownAirports.join(", ")}.`;
        }
        if (unknownAirlines.length) {
          msg += `\n\nThese airline codes aren't recognized, so they're shown as-is: ${unknownAirlines.join(", ")}.`;
        }
        alert(msg);
      } catch (err) {
        alert("Could not parse that CSV: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("import-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.flights) { flights = data.flights; saveFlights(flights); }
        if (data.settings) { settings = { ...settings, ...data.settings }; saveSettings(settings); }
        if (data.customAirports) {
          localStorage.setItem("globetrotter_custom_airports", JSON.stringify(data.customAirports));
          airports = loadAllAirports();
          populateAirportDatalist();
        }
        renderAll();
        alert("Import complete.");
      } catch (err) {
        alert("Could not read that file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ---------- Render orchestration ----------
  function renderAll() {
    renderMap();
    renderPassport();
    renderDashboard();
    renderClocks();
    renderFlightList();
  }

  // ---------- Motion: scroll reveal + boarding-pass tilt ----------
  function setupScrollReveal() {
    const targets = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    targets.forEach((el) => observer.observe(el));
  }

  function setupBoardingPassTilt() {
    const card = document.getElementById("boarding-pass");
    if (!card) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const MAX_DEG = 5;
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.setProperty("--tilt-y", `${px * MAX_DEG * 2}deg`);
      card.style.setProperty("--tilt-x", `${-py * MAX_DEG * 2}deg`);
    });
    card.addEventListener("mouseleave", () => {
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
    });
  }

  populateAirportDatalist();
  updateTerminator();
  setInterval(updateTerminator, 1000 * 60);
  renderAll();
  setupScrollReveal();
  setupBoardingPassTilt();
})();
