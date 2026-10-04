import { Router, type IRouter } from "express";

type LocationRecord = {
  value: string;
  label: string;
  level: "City" | "Municipality" | "Barangay";
  province: string;
  region: string;
  parent?: string;
};

const router: IRouter = Router();
const psgcSource = "https://raw.githubusercontent.com/Ordonia/listOfCityMunicipalityAndBarangay2025/main/resources/psgc_2025-07-31.csv";
let cachedLocations: LocationRecord[] | null = null;

router.get("/locations", async (_req, res) => {
  try {
    const directory = cachedLocations ?? await loadLocations();
    cachedLocations = directory;
    const locations = directory.filter((item) => item.level !== "Barangay");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({
      locations,
      source: "Philippine Statistics Authority PSGC, 31 July 2025",
      counts: {
        cities: locations.filter((item) => item.level === "City").length,
        municipalities: locations.filter((item) => item.level === "Municipality").length,
        barangays: directory.filter((item) => item.level === "Barangay").length,
      },
    });
  } catch (error) {
    _req.log.error({ err: error }, "Unable to load Philippine locations");
    res.status(502).json({ error: "Unable to load Philippine locations." });
  }
});

router.get("/locations/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLocaleLowerCase() : "";
  const level = typeof req.query.level === "string" ? req.query.level : "";
  const parent = typeof req.query.parent === "string" ? req.query.parent.trim().toLocaleLowerCase() : "";
  const validLevels = new Set(["City", "Municipality", "Barangay", "Locality"]);

  if (level && !validLevels.has(level)) {
    res.status(400).json({ error: "Invalid location level." });
    return;
  }

  if (query.length < 2) {
    res.json({ locations: [] });
    return;
  }

  try {
    const directory = cachedLocations ?? await loadLocations();
    cachedLocations = directory;
    const results = directory
      .filter((item) => level === "Locality"
        ? item.level === "City" || item.level === "Municipality"
        : !level || item.level === level)
      .filter((item) => !parent || item.parent?.toLocaleLowerCase() === parent)
      .filter((item) => `${item.value} ${item.label}`.toLocaleLowerCase().includes(query))
      .slice(0, 20);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ locations: results });
  } catch (error) {
    req.log.error({ err: error }, "Unable to search Philippine locations");
    res.status(502).json({ error: "Unable to search Philippine locations." });
  }
});

async function loadLocations(): Promise<LocationRecord[]> {
  const response = await fetch(psgcSource, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`PSGC source returned ${response.status}`);
  const csv = await response.text();
  const rows = csv.split(/\r?\n/).filter(Boolean).slice(1);
  let region = "";
  let province = "";
  let parent: { level: "City" | "Municipality"; value: string } | null = null;
  const locations: LocationRecord[] = [];

  for (const row of rows) {
    const fields = parseCsvRow(row);
    const name = fields[1]?.trim();
    const level = fields[3]?.trim();
    if (!name || !level) continue;

    if (level === "Reg") {
      region = name;
      province = "";
      parent = null;
      continue;
    }
    if (level === "Prov") {
      province = name;
      parent = null;
      continue;
    }
    if (level === "City" || level === "Mun") {
      const displayName = name.replace(/^City of /, "");
      const locationLevel = level === "City" ? "City" : "Municipality";
      const locationValue = province || region ? `${displayName} · ${province || region}` : displayName;
      parent = { level: locationLevel, value: locationValue };
      locations.push({
        value: locationValue,
        label: locationValue,
        level: locationLevel,
        province: province || region,
        region,
      });
      continue;
    }
    if (level !== "Bgy" || !parent) continue;

    const label = `${name} · ${parent.value}`;
    locations.push({
      value: name,
      label,
      level: "Barangay",
      province: province || region,
      region,
      parent: parent.value,
    });
  }

  if (locations.length < 1_500) {
    throw new Error(`PSGC source returned only ${locations.length} locations`);
  }
  return locations;
}

function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    const next = row[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

export default router;