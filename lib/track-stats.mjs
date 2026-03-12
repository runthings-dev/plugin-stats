import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

const pluginsPath = path.join(projectRoot, "plugins.json");
const statsPath = path.join(projectRoot, "stats.csv");
const headerLine =
  "date,slug,active_installs,downloaded,version,last_updated,url,rating,num_ratings,ratings_5,ratings_4,ratings_3,ratings_2,ratings_1";

const getLondonDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not build London date string");
  }

  return `${year}-${month}-${day}`;
};

const csvEscape = (value) => {
  const stringValue = String(value ?? "");

  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replaceAll('"', '""')}"`;
};

const toFiniteNumberOrEmpty = (value) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : "";
};

const buildApiUrl = (slug) => {
  const url = new URL("https://api.wordpress.org/plugins/info/1.2/");

  url.searchParams.set("action", "plugin_information");
  url.searchParams.set("request[slug]", slug);
  url.searchParams.set("request[fields][active_installs]", "1");
  url.searchParams.set("request[fields][downloaded]", "1");
  url.searchParams.set("request[fields][version]", "1");
  url.searchParams.set("request[fields][last_updated]", "1");
  url.searchParams.set("request[fields][rating]", "1");
  url.searchParams.set("request[fields][ratings]", "1");
  url.searchParams.set("request[fields][reviews]", "0");
  url.searchParams.set("request[fields][sections]", "0");
  url.searchParams.set("request[fields][versions]", "0");
  url.searchParams.set("request[fields][banners]", "0");
  url.searchParams.set("request[fields][icons]", "0");
  url.searchParams.set("request[fields][contributors]", "0");

  return url.toString();
};

const fetchPluginData = async (slug) => {
  const response = await fetch(buildApiUrl(slug), {
    headers: {
      "user-agent": "runthings-plugin-stats/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${slug}`);
  }

  const data = await response.json();

  if (!data || typeof data !== "object" || data.error) {
    throw new Error(`Invalid API response for ${slug}`);
  }

  const ratings =
    data.ratings && typeof data.ratings === "object" ? data.ratings : {};

  return {
    slug,
    activeInstalls: toFiniteNumberOrEmpty(data.active_installs),
    downloaded: toFiniteNumberOrEmpty(data.downloaded),
    version: typeof data.version === "string" ? data.version : "",
    lastUpdated: typeof data.last_updated === "string" ? data.last_updated : "",
    url: `https://wordpress.org/plugins/${slug}/`,
    rating: toFiniteNumberOrEmpty(data.rating),
    numRatings: toFiniteNumberOrEmpty(data.num_ratings),
    ratings5: toFiniteNumberOrEmpty(ratings["5"]),
    ratings4: toFiniteNumberOrEmpty(ratings["4"]),
    ratings3: toFiniteNumberOrEmpty(ratings["3"]),
    ratings2: toFiniteNumberOrEmpty(ratings["2"]),
    ratings1: toFiniteNumberOrEmpty(ratings["1"]),
  };
};

const readExistingCsv = async () => {
  try {
    return await readFile(statsPath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return `${headerLine}\n`;
    }

    throw error;
  }
};

const main = async () => {
  const today = getLondonDate();
  const pluginsRaw = await readFile(pluginsPath, "utf8");
  const slugs = JSON.parse(pluginsRaw);

  if (!Array.isArray(slugs) || slugs.length === 0) {
    throw new Error(
      "plugins.json must contain a non-empty array of plugin slugs",
    );
  }

  const uniqueSlugs = [
    ...new Set(slugs.map((slug) => String(slug).trim()).filter(Boolean)),
  ];

  const rows = [];

  for (const slug of uniqueSlugs) {
    const plugin = await fetchPluginData(slug);

    rows.push([
      today,
      plugin.slug,
      plugin.activeInstalls,
      plugin.downloaded,
      plugin.version,
      plugin.lastUpdated,
      plugin.url,
      plugin.rating,
      plugin.numRatings,
      plugin.ratings5,
      plugin.ratings4,
      plugin.ratings3,
      plugin.ratings2,
      plugin.ratings1,
    ]);
  }

  const existing = await readExistingCsv();
  const existingLines = existing
    .split("\n")
    .filter((line) => line.trim() !== "");

  const header = existingLines[0] || headerLine;
  const bodyLines = existingLines.slice(1);

  const filteredBodyLines = bodyLines.filter((line) => {
    const [date, slug] = line.split(",", 2);

    return !(date === today && uniqueSlugs.includes(slug));
  });

  const newLines = rows.map((row) => row.map(csvEscape).join(","));
  const nextContent = `${header}\n${[...filteredBodyLines, ...newLines].join("\n")}\n`;

  await writeFile(statsPath, nextContent, "utf8");

  console.log(`Wrote ${rows.length} rows for ${today}`);
};

await main();
