// Maps ISO2 country codes (as used in airports.js) to their continent.
const CONTINENTS = {
  IN: "Asia", AE: "Asia", QA: "Asia", SA: "Asia", BH: "Asia", OM: "Asia", KW: "Asia", JO: "Asia", IL: "Asia",
  SG: "Asia", MY: "Asia", TH: "Asia", ID: "Asia", PH: "Asia", VN: "Asia", HK: "Asia", TW: "Asia", KR: "Asia",
  JP: "Asia", CN: "Asia", NP: "Asia", BD: "Asia", LK: "Asia", MV: "Asia", TR: "Asia",

  GB: "Europe", FR: "Europe", NL: "Europe", DE: "Europe", CH: "Europe", IT: "Europe", ES: "Europe", PT: "Europe",
  AT: "Europe", GR: "Europe", DK: "Europe", SE: "Europe", NO: "Europe", FI: "Europe", IE: "Europe", PL: "Europe",
  CZ: "Europe", HU: "Europe", BE: "Europe",

  US: "North America", CA: "North America",

  BR: "South America", AR: "South America", CL: "South America", CO: "South America", PE: "South America",

  AU: "Oceania", NZ: "Oceania",

  EG: "Africa", ZA: "Africa", KE: "Africa", ET: "Africa", NG: "Africa", MU: "Africa", SC: "Africa",
};

const ALL_CONTINENTS = ["Africa", "Antarctica", "Asia", "Europe", "North America", "Oceania", "South America"];
const CONTINENT_ICONS = {
  Africa: "🌍",
  Antarctica: "🧊",
  Asia: "🌏",
  Europe: "🌍",
  "North America": "🌎",
  Oceania: "🏝️",
  "South America": "🌎",
};
