import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const registryPath = path.join(repositoryRoot, "docs", "features.json");
const readmePath = path.join(repositoryRoot, "README.md");
const startMarker = "<!-- FEATURES:START -->";
const endMarker = "<!-- FEATURES:END -->";

const statusDisplay = {
  available: { icon: "✅", label: "Available" },
  beta: { icon: "🧪", label: "In development" },
  planned: { icon: "🌘", label: "Planned" }
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

  for (const category of registry.categories) {
    if (!category.name || !Array.isArray(category.features)) {
      fail("Every category needs a name and a features array.");
    }

    for (const feature of category.features) {
      if (!feature.name || !feature.summary || !feature.description) {
        fail(`Feature entries in "${category.name}" need name, summary, and description fields.`);
      }
      if (!statusDisplay[feature.status]) {
        fail(`Feature "${feature.name}" has unsupported status "${feature.status}".`);
      }
    }
  }

  return registry;
}

function renderFeature(feature) {
  const status = statusDisplay[feature.status];
  return [
    "<details>",
    `<summary><strong>${status.icon} ${feature.name}</strong> — ${feature.summary}</summary>`,
    "",
    `**Status:** ${status.label}`,
    "",
    feature.description,
    "",
    "</details>"
  ].join("\n");
}

function renderRegistry(registry) {
  const counts = { available: 0, beta: 0, planned: 0 };
  for (const category of registry.categories) {
    for (const feature of category.features) counts[feature.status] += 1;
  }

  const sections = [
    "### Nexus feature status",
    "",
    `**${counts.available} available** · **${counts.beta} in development** · **${counts.planned} planned**`,
    "",
    "> The sections below are generated from [`docs/features.json`](docs/features.json). Edit the registry—not this block—when a feature is added, changes status, or enters the roadmap."
  ];

  for (const category of registry.categories) {
    sections.push("", `## ${category.icon || "◆"} ${category.name}`, "");
    sections.push(category.features.map(renderFeature).join("\n\n"));
  }

  return sections.join("\n");
}

const registry = readRegistry();
const currentReadme = fs.readFileSync(readmePath, "utf8");
const startIndex = currentReadme.indexOf(startMarker);
const endIndex = currentReadme.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  fail(`README.md must contain ${startMarker} and ${endMarker}.`);
}

const generatedBlock = `${startMarker}\n${renderRegistry(registry)}\n${endMarker}`;
const updatedReadme =
  currentReadme.slice(0, startIndex) +
  generatedBlock +
  currentReadme.slice(endIndex + endMarker.length);

if (process.argv.includes("--check")) {
  if (updatedReadme !== currentReadme) {
    fail("README.md is out of sync. Run: node .github/scripts/sync-readme-features.mjs");
  }
  console.log("[readme-feature-monitor] README.md is synchronized.");
} else {
  fs.writeFileSync(readmePath, updatedReadme);
  console.log("[readme-feature-monitor] README.md feature sections updated.");
}
