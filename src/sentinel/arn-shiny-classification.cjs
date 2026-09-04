'use strict';

// ARN classification is behavior-based, never color-rarity based.
// Sources of truth are the Shiny! Dinos Ascended official abilities page and
// first-party CurseForge changelogs. Unknown/color-only names remain WATCH.
const SHINY_ABILITIES = Object.freeze({
  Enraged: { threat: 'KAIJU', rank: 100, kind: 'DANGEROUS', tags: ['untameable', 'combat', 'alpha-like'], note: 'Extreme combat threat; Enraged remains ARN KAIJU.' },
  Radioactive: { threat: 'DANGER', rank: 80, kind: 'DANGEROUS', tags: ['radiation', 'proximity'], note: 'Emits dangerous radiation; approach with protection.' },
  Nightmare: { threat: 'DANGER', rank: 75, kind: 'DANGEROUS', tags: ['fear', 'vision', 'cold'], note: 'Can inflict fear/near-blindness and chills its surroundings.' },
  Burning: { threat: 'DANGER', rank: 70, kind: 'DANGEROUS', tags: ['fire', 'aoe', 'combat'], note: 'Fire/lava resistant with an explosive fire attack.' },
  Taser: { threat: 'DANGER', rank: 70, kind: 'DANGEROUS', tags: ['electric', 'stun', 'combat'], note: 'Can shock and stun attackers.' },
  Psychotropic: { threat: 'CAUTION', rank: 60, kind: 'SPECIAL', tags: ['hallucination', 'bite'], note: 'Contact/bites can cause hazardous psychotropic effects.' },
  Dazzling: { threat: 'CAUTION', rank: 55, kind: 'SPECIAL', tags: ['blind', 'radiation-immune'], note: 'Can temporarily blind attackers.' },
  Filthy: { threat: 'CAUTION', rank: 50, kind: 'SPECIAL', tags: ['proximity', 'stench'], note: 'Overwhelming stench harms nearby players until cleaned.' },
  Colossal: { threat: 'CAUTION', rank: 45, kind: 'SPECIAL', tags: ['health', 'melee', 'size'], note: 'Larger with increased health and melee capability.' },
  Frozen: { threat: 'WATCH', rank: 30, kind: 'SPECIAL', tags: ['resistance', 'cold'], note: 'Defensive ice ability; resistant to most damage but vulnerable to fire.' },
  Skeletal: { threat: 'WATCH', rank: 30, kind: 'SPECIAL', tags: ['ranged-resistance'], note: 'Reduced ranged damage and skeletal physiology.' },
  Shinobi: { threat: 'WATCH', rank: 25, kind: 'SPECIAL', tags: ['stealth'], note: 'Reduced wild-dino aggro range.' },
  Spectral: { threat: 'WATCH', rank: 25, kind: 'SPECIAL', tags: ['incorporeal', 'silent'], note: 'Ghost-like movement and incorporeal properties.' },
  Holographic: { threat: 'WATCH', rank: 25, kind: 'SPECIAL', tags: ['detection'], note: 'Provides threat and valuable-dino detection to its rider.' },
  Lunar: { threat: 'WATCH', rank: 20, kind: 'SPECIAL', tags: ['low-gravity'], note: 'Low-gravity movement ability.' },
  Pygmy: { threat: 'WATCH', rank: 20, kind: 'SPECIAL', tags: ['small', 'speed'], note: 'Smaller and somewhat faster.' },
  Rubber: { threat: 'WATCH', rank: 20, kind: 'SPECIAL', tags: ['bounce', 'fall-damage'], note: 'Bounces and avoids fall damage.' },
  Endurant: { threat: 'WATCH', rank: 20, kind: 'SPECIAL', tags: ['stamina'], note: 'Can sprint without normal stamina drain.' },
  Fathomless: { threat: 'WATCH', rank: 20, kind: 'SPECIAL', tags: ['weight'], note: 'Substantially reduces carried inventory weight.' },
  Bolstering: { threat: 'WATCH', rank: 15, kind: 'SPECIAL', tags: ['shoulder', 'weight'], note: 'Shoulder-pet inventory weight utility.' },
  Hydrating: { threat: 'WATCH', rank: 15, kind: 'SPECIAL', tags: ['shoulder', 'water'], note: 'Shoulder-pet water-consumption utility.' },
  Invigorating: { threat: 'WATCH', rank: 15, kind: 'SPECIAL', tags: ['shoulder', 'stamina'], note: 'Shoulder-pet stamina regeneration utility.' },
  Obscured: { threat: 'WATCH', rank: 15, kind: 'SPECIAL', tags: ['shoulder', 'stealth'], note: 'Shoulder-pet stealth/aggro reduction utility.' },
  Obscure: { threat: 'WATCH', rank: 15, kind: 'SPECIAL', tags: ['shoulder', 'stealth'], note: 'INI token/alias for Obscured.' },
  Pyrethrous: { threat: 'WATCH', rank: 15, kind: 'SPECIAL', tags: ['shoulder', 'insect-repellent'], note: 'Shoulder-pet natural pesticide utility.' },
  Revitalizing: { threat: 'WATCH', rank: 15, kind: 'SPECIAL', tags: ['shoulder', 'health'], note: 'Shoulder-pet health regeneration utility.' },
  Serene: { threat: 'WATCH', rank: 15, kind: 'SPECIAL', tags: ['shoulder', 'crafting'], note: 'Shoulder-pet crafting utility.' }
});

const TOKENS = Object.freeze(Object.keys(SHINY_ABILITIES).sort((a, b) => b.length - a.length));

function extractAbilityTraits(dinoName) {
  const name = String(dinoName || '');
  const found = [];
  for (const token of TOKENS) {
    const rx = new RegExp(`(?:^|\\s)${token.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
    if (rx.test(name) && !found.some((x) => x.toLowerCase() === token.toLowerCase())) found.push(token);
  }
  return found;
}

function classifyShiny(dinoName) {
  const traits = extractAbilityTraits(dinoName);
  if (!traits.length) return { level: 'WATCH', rank: 10, kind: 'COLOR_OR_UNKNOWN', traits: [], tags: [], note: 'No documented ability token detected; color/appearance names do not create ARN rarity or threat tiers.' };
  const records = traits.map((trait) => ({ trait, ...SHINY_ABILITIES[trait] })).sort((a, b) => b.rank - a.rank);
  const primary = records[0];
  return {
    level: primary.threat,
    rank: primary.rank,
    kind: primary.kind,
    traits,
    tags: [...new Set(records.flatMap((record) => record.tags))],
    note: primary.note
  };
}

module.exports = { SHINY_ABILITIES, extractAbilityTraits, classifyShiny };
