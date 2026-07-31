import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const registryPath = path.join(repositoryRoot, "docs", "features.json");
const readmePath = path.join(repositoryRoot, "README.md");

const markers = {
  current: {
    start: "<!-- CURRENT_FEATURES:START -->",
    end: "<!-- CURRENT_FEATURES:END -->"
  },
  roadmap: {
    start: "<!-- ROADMAP:START -->",
    end: "<!-- ROADMAP:END -->"
  }
};

const statusLabels = {
  available: "Available",
  beta: "In development",
  planned: "Planned"
};

function fail(message) {
  console.error(`[readme-feature-monitor] ${message}`);
  process.exit(1);
}

function readRegistry() {
  let registry;

  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    fail(`Unable to read ${path.relative(repositoryRoot, registryPath)}: ${error.message}`);
  }

  if (!Array.isArray(registry.categories) || registry.categories.length === 0) {
    fail("docs/features.json must contain at least one category.");
  }

  const featureNames = new Set();

  for (const category of registry.categories) {
    if (!category.name || !Array.isArray(category.features)) {
      fail("Every category needs a name and a features array.");
    }

    for (const feature of category.features) {
      if (!feature.name || !feature.summary || !feature.description) {
        fail(`Feature entries in "${category.name}" need name, summary, and description fields.`);
      }

      if (!statusLabels[feature.status]) {
        fail(`Feature "${feature.name}" has unsupported status "${feature.status}".`);
      }

      if (featureNames.has(feature.name)) {
        fail(`Feature names must be unique. Duplicate: "${feature.name}".`);
      }

      featureNames.add(feature.name);
    }
  }

  return registry;
}

function renderFeature(feature) {
  return [
    "<details>",
    `<summary><strong>${feature.name}</strong> — ${feature.summary}</summary>`,
    "",
    `**Status:** ${statusLabels[feature.status]}`,
    "",
    feature.description,
    "",
    "</details>"
  ].join("\n");
}

function featuresByStatus(registry, status) {
  return registry.categories.flatMap((category) =>
    category.features
      .filter((feature) => feature.status === status)
      .map((feature) => ({ ...feature, category: category.name }))
  );
}

function renderCurrentFeatures(registry) {
  const available = featuresByStatus(registry, "available");
  const inDevelopment = featuresByStatus(registry, "beta");
  const lines = [
    markers.current.start,
    "## Current Features",
    "",
    `Khaos Nexus currently includes **${available.length} production-ready capabilities** across the desktop platform, Discord automation, game-server operations, mobile access, and reliability tooling.`
  ];

  for (const category of registry.categories) {
    const features = category.features.filter((feature) => feature.status === "available");
    if (features.length === 0) continue;

    lines.push(
      "",
      `### ${category.name}`,
      "",
      features.map(renderFeature).join("\n\n")
    );
  }

  lines.push(
    "",
    "## In Development",
    "",
    `These **${inDevelopment.length} capabilities** are actively being built or validated and are not yet presented as fully released features.`
  );

  if (inDevelopment.length > 0) {
    lines.push("", inDevelopment.map(renderFeature).join("\n\n"));
  } else {
    lines.push("", "_No features are currently marked as in development._");
  }

  lines.push(markers.current.end);
  return lines.join("\n");
}

function renderRoadmap(registry) {
  const planned = featuresByStatus(registry, "planned");
  const lines = [
    markers.roadmap.start,
    "## Planned Roadmap",
    "",
    `The roadmap currently contains **${planned.length} planned capabilities**. Priorities may change as the desktop platform, Discord runtime, and game adapters mature.`
  ];

  if (planned.length > 0) {
    lines.push("", planned.map(renderFeature).join("\n\n"));
  } else {
    lines.push("", "_No features are currently listed on the roadmap._");
  }

  lines.push(markers.roadmap.end);
  return lines.join("\n");
}

function replaceBlock(content, marker, replacement) {
  const startIndex = content.indexOf(marker.start);
  const endIndex = content.indexOf(marker.end);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    fail(`README.md must contain ${marker.start} and ${marker.end}.`);
  }

  return (
    content.slice(0, startIndex) +
    replacement +
    content.slice(endIndex + marker.end.length)
  );
}

const registry = readRegistry();
const currentReadme = fs.readFileSync(readmePath, "utf8");
let updatedReadme = replaceBlock(
  currentReadme,
  markers.current,
  renderCurrentFeatures(registry)
);
updatedReadme = replaceBlock(
  updatedReadme,
  markers.roadmap,
  renderRoadmap(registry)
);

if (process.argv.includes("--check")) {
  if (updatedReadme !== currentReadme) {
    fail("README.md is out of sync. Run: node .github/scripts/sync-readme-features.mjs");
  }

  console.log("[readme-feature-monitor] README.md is synchronized.");
} else {
  fs.writeFileSync(readmePath, updatedReadme);
  console.log("[readme-feature-monitor] README.md current features and roadmap updated.");
}
