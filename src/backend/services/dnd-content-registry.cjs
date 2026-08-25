'use strict';

const CONTENT_SCHEMA_VERSION = 1;
const CORE_SOURCE_ID = 'nexus-open-core@1';
const SHATTERED_REALMS_SOURCE_ID = 'khaos-shattered-realms@1';

const SOURCES = Object.freeze([
  Object.freeze({
    id: CORE_SOURCE_ID,
    name: 'Nexus Open Rules Core',
    version: '1.0.0',
    kind: 'open-reference',
    license: 'CC-BY-4.0-compatible identifiers and original Nexus summaries only',
    provenance: 'Repository-authored compatibility layer; no protected commercial rules text is bundled.',
    enabledByDefault: true
  }),
  Object.freeze({
    id: SHATTERED_REALMS_SOURCE_ID,
    name: 'Khaos Nexus: Codex of the Shattered Realms',
    version: '1.0.0-draft',
    kind: 'nexus-homebrew',
    license: 'Khaos Nexus original content',
    provenance: 'Separately identified Nexus homebrew; entries require explicit approval before campaign enablement.',
    enabledByDefault: false
  })
]);

const CONTENT = Object.freeze([
  Object.freeze({ id: 'species:human@1', type: 'species', name: 'Human', sourceId: CORE_SOURCE_ID, version: 1, status: 'reference', summary: 'Adaptable adventurer ancestry entry.' }),
  Object.freeze({ id: 'class:fighter@1', type: 'class', name: 'Fighter', sourceId: CORE_SOURCE_ID, version: 1, status: 'reference', summary: 'Martial character progression entry.' }),
  Object.freeze({ id: 'background:acolyte@1', type: 'background', name: 'Acolyte', sourceId: CORE_SOURCE_ID, version: 1, status: 'reference', summary: 'Faith-centered background entry.' }),
  Object.freeze({ id: 'equipment:longsword@1', type: 'equipment', name: 'Longsword', sourceId: CORE_SOURCE_ID, version: 1, status: 'reference', summary: 'Versatile martial melee weapon entry.' })
]);

function clean(value, max = 200) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

class DndContentRegistry {
  constructor(options = {}) {
    this.sources = [...(options.sources || SOURCES)].map((item) => Object.freeze({ ...item }));
    this.content = [...(options.content || CONTENT)].map((item) => Object.freeze({ ...item }));
  }

  manifest() {
    return { schemaVersion: CONTENT_SCHEMA_VERSION, sources: this.sources.map((item) => ({ ...item })), contentCount: this.content.length };
  }

  list(options = {}) {
    const sourceIds = new Set((options.sourceIds || []).map(String));
    const type = clean(options.type, 80);
    return this.content.filter((item) => (!sourceIds.size || sourceIds.has(item.sourceId)) && (!type || item.type === type)).map((item) => ({ ...item }));
  }

  get(id) {
    const item = this.content.find((entry) => entry.id === String(id || ''));
    return item ? { ...item } : null;
  }
}

module.exports = { CONTENT, CONTENT_SCHEMA_VERSION, CORE_SOURCE_ID, DndContentRegistry, SHATTERED_REALMS_SOURCE_ID, SOURCES };
