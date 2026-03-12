import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

const statsPath = path.join(projectRoot, "stats.csv");
const outputDir = path.join(projectRoot, "generated");

const width = 1200;
const height = 500;
const chart = new ChartJSNodeCanvas({
  width,
  height,
  backgroundColour: "white",
});

const formatInstallBucket = (value) =>
  `${new Intl.NumberFormat("en-GB").format(value)}+`;

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);

  return values;
};

const slugToTitle = (slug) =>
  slug
    .replace(/^runthings-/, "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

const sortDates = (dates) => [...dates].sort((a, b) => a.localeCompare(b));

const makeLineConfig = ({ labels, values, title }) => ({
  type: "line",
  data: {
    labels,
    datasets: [
      {
        label: title,
        data: values,
        borderWidth: 3,
        tension: 0.25,
        pointRadius: 3,
        fill: false,
      },
    ],
  },
  options: {
    responsive: false,
    animation: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: title,
        font: {
          size: 20,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  },
});

const readRows = async () => {
  const csv = await readFile(statsPath, "utf8");
  const lines = csv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("stats.csv does not contain any data rows");
  }

  const header = parseCsvLine(lines[0]);
  const dateIndex = header.indexOf("date");
  const slugIndex = header.indexOf("slug");
  const activeInstallsIndex = header.indexOf("active_installs");

  if (dateIndex === -1 || slugIndex === -1 || activeInstallsIndex === -1) {
    throw new Error(
      "stats.csv must contain date, slug, and active_installs columns",
    );
  }

  return lines
    .slice(1)
    .map(parseCsvLine)
    .map((row) => ({
      date: row[dateIndex],
      slug: row[slugIndex],
      activeInstalls: Number(row[activeInstallsIndex]),
    }))
    .filter(
      (row) => row.date && row.slug && Number.isFinite(row.activeInstalls),
    );
};

const buildOverallSeries = (rows) => {
  const totalsByDate = new Map();

  for (const row of rows) {
    const current = totalsByDate.get(row.date) ?? 0;
    totalsByDate.set(row.date, current + row.activeInstalls);
  }

  const labels = sortDates(totalsByDate.keys());
  const values = labels.map((date) => totalsByDate.get(date) ?? 0);

  return { labels, values };
};

const buildPluginSeries = (rows) => {
  const bySlug = new Map();

  for (const row of rows) {
    if (!bySlug.has(row.slug)) {
      bySlug.set(row.slug, new Map());
    }

    bySlug.get(row.slug).set(row.date, row.activeInstalls);
  }

  return [...bySlug.entries()]
    .map(([slug, valuesByDate]) => {
      const labels = sortDates(valuesByDate.keys());
      const values = labels.map((date) => valuesByDate.get(date) ?? 0);
      const latestActiveInstalls = values.at(-1) ?? 0;

      return {
        slug,
        title: slugToTitle(slug),
        url: `https://wordpress.org/plugins/${slug}/`,
        labels,
        values,
        latestActiveInstalls,
        fileName: `${slug}.png`,
      };
    })
    .sort((a, b) => {
      if (b.latestActiveInstalls !== a.latestActiveInstalls) {
        return b.latestActiveInstalls - a.latestActiveInstalls;
      }

      return a.slug.localeCompare(b.slug);
    });
};

const renderChart = async ({ labels, values, title, outputPath }) => {
  const buffer = await chart.renderToBuffer(
    makeLineConfig({ labels, values, title }),
    "image/png",
  );

  await writeFile(outputPath, buffer);
};

const main = async () => {
  await mkdir(outputDir, { recursive: true });

  const rows = await readRows();
  const overall = buildOverallSeries(rows);
  const latestOverall = overall.values.at(-1) ?? 0;
  const plugins = buildPluginSeries(rows);

  await renderChart({
    labels: overall.labels,
    values: overall.values,
    title: "All Plugins: Active Installs",
    outputPath: path.join(outputDir, "overall-active-installs.png"),
  });

  for (const plugin of plugins) {
    await renderChart({
      labels: plugin.labels,
      values: plugin.values,
      title: `${plugin.title}: Active Installs`,
      outputPath: path.join(outputDir, plugin.fileName),
    });
  }

  const markdown = `# Plugin Stats

## Overall: ${formatInstallBucket(latestOverall)} active installs

![All Plugins Active Installs](./generated/overall-active-installs.png)

## By Plugin

${plugins
  .map(
    (
      plugin,
    ) => `### ${plugin.title} — ${formatInstallBucket(plugin.latestActiveInstalls)} active installs

[View on Plugin Directory](${plugin.url})

![${plugin.title} Active Installs](./generated/${plugin.fileName})`,
  )
  .join("\n\n")}
`;

  await writeFile(path.join(projectRoot, "README.md"), markdown, "utf8");

  console.log(`Generated ${plugins.length + 1} chart images and README.md`);
};

await main();
