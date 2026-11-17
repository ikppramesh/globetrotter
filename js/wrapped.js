// Travel Wrapped share card: draws a yearly summary onto a canvas so it can be
// downloaded or shared as a PNG. Drawing only; app.js computes the numbers and
// passes them in as preformatted strings:
//   { year, flightCount, distance, flightTime, countries, continents,
//     topAirline, favouriteRoute, longestFlight, busiestMonth, footer }
const WrappedUtils = (() => {
  const WIDTH = 1080;
  const HEIGHT = 1350;
  const PAD = 80;
  const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const COLORS = {
    navy: "#16205c",
    ink: "#1b1e2b",
    orange: "#e0762c",
    paper: "#f4f1ea",
    soft: "#b9bfd9",
  };

  // Truncates text with an ellipsis so it fits within maxWidth. Expects ctx.font to be set.
  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTile(ctx, x, y, w, h, value, label) {
    roundRect(ctx, x, y, w, h, 28);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.fillStyle = COLORS.paper;
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText(fitText(ctx, value, w - 56), x + 28, y + 80);
    ctx.fillStyle = COLORS.soft;
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(label, x + 28, y + 122);
  }

  function drawRow(ctx, y, label, value) {
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.soft;
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText(label, PAD, y);

    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.paper;
    ctx.font = `700 38px ${FONT}`;
    ctx.fillText(fitText(ctx, value, WIDTH - PAD * 2 - 320), WIDTH - PAD, y);
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(PAD, y + 26, WIDTH - PAD * 2, 2);
  }

  function drawCard(canvas, s) {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, COLORS.navy);
    bg.addColorStop(1, COLORS.ink);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const glow = ctx.createRadialGradient(WIDTH - 120, 120, 0, WIDTH - 120, 120, 620);
    glow.addColorStop(0, "rgba(224,118,44,0.35)");
    glow.addColorStop(1, "rgba(224,118,44,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = COLORS.soft;
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText("✈ GLOBETROTTER", PAD, 150);

    ctx.fillStyle = COLORS.paper;
    ctx.font = `700 96px ${FONT}`;
    ctx.fillText("Travel Wrapped", PAD, 290);

    ctx.fillStyle = COLORS.orange;
    ctx.font = `700 210px ${FONT}`;
    ctx.fillText(String(s.year), PAD, 480);

    ctx.fillStyle = COLORS.paper;
    ctx.font = `700 150px ${FONT}`;
    ctx.fillText(String(s.flightCount), PAD, 630);
    ctx.fillStyle = COLORS.soft;
    ctx.font = `500 44px ${FONT}`;
    ctx.fillText(s.flightCount === 1 ? "flight taken" : "flights taken", PAD, 690);

    const tileW = (WIDTH - PAD * 2 - 24) / 2;
    const tiles = [
      [s.distance, "distance flown"],
      [s.flightTime, "in the air"],
      [s.countries, "countries"],
      [s.continents, "continents"],
    ];
    tiles.forEach(([value, label], i) => {
      const x = PAD + (i % 2) * (tileW + 24);
      const y = 720 + Math.floor(i / 2) * (140 + 24);
      drawTile(ctx, x, y, tileW, 140, value, label);
    });

    drawRow(ctx, 1080, "Top airline", s.topAirline);
    drawRow(ctx, 1140, "Favourite route", s.favouriteRoute);
    drawRow(ctx, 1200, "Longest flight", s.longestFlight);
    drawRow(ctx, 1260, "Busiest month", s.busiestMonth);

    ctx.fillStyle = COLORS.soft;
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(fitText(ctx, s.footer, WIDTH - PAD * 2), PAD, HEIGHT - 38);
  }

  return { WIDTH, HEIGHT, drawCard };
})();
