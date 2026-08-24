'use strict';

const { SlashCommandBuilder } = require('discord.js');

function textOption(name, description, required = false, choices = []) {
  return { type: 'string', name, description, required, choices };
}
function intOption(name, description, required = false, min = 0, max = 3600) {
  return { type: 'integer', name, description, required, min, max };
}
function numberOption(name, description, required = false, min = null, max = null) {
  return { type: 'number', name, description, required, min, max };
}
function boolOption(name, description, required = false) {
  return { type: 'boolean', name, description, required };
}
function action(name, actionId, description, options = [], payload = null) {
  return { kind: 'action', name, actionId, description, options, payload };
}
function group(name, description, actions) {
  return { kind: 'group', name, description, actions };
}

function serverAction(name, actionId, description, options = []) {
  return action(name, actionId, description, options, (values) => ({
    ...(values.server ? { server: values.server } : {}),
    ...(values.message ? { message: values.message } : {}),
    ...(values.player ? { player: values.player, target: values.player } : {}),
    ...(values.seconds != null ? { seconds: values.seconds } : {})
  }));
}

function scheduleGroup() {
  return group('schedule', 'Manage daily Nexus schedules', [
    action('list', 'schedule-list', 'Show scheduled actions'),
    action('add', 'schedule-add', 'Add a daily scheduled action', [
      textOption('time', '24-hour time, for example 06:00', true),
      textOption('action', 'Action to run', true, [
        ['Save', 'save'], ['Restart', 'restart'], ['Broadcast', 'broadcast']
      ]),
      textOption('details', 'Optional message, target, or action input')
    ], (v) => ({ mode: 'daily', time: v.time, actionId: v.action, payload: v.details ? { input: v.details } : {} })),
    action('remove', 'schedule-remove', 'Remove a scheduled action', [
      textOption('id', 'Schedule ID shown by schedule list', true)
    ], (v) => ({ id: v.id }))
  ]);
}

const SPECS = Object.freeze([
  {
    moduleId: 'ark', command: 'ark', description: 'ARK server tools', entries: [
      serverAction('status', 'status', 'Show ARK server status', [textOption('server', 'Optional server name')]),
      serverAction('players', 'players', 'Show online players', [textOption('server', 'Optional server name')]),
      action('servers', 'servers', 'List configured ARK servers'),
      action('tame', 'taming', 'Estimate tame time and open Dododex', [
        textOption('creature', 'Creature name, for example Rex', true),
        numberOption('rate', 'Server taming multiplier, for example 3', true, 0.1, 100),
        intOption('base-minutes', 'Optional known 1x base tame time in minutes', false, 1, 10000)
      ], (v) => ({ creature: v.creature, tamingRate: v.rate, ...(v['base-minutes'] != null ? { baseMinutes: v['base-minutes'] } : {}) })),
      serverAction('save', 'save', 'Save the world', [textOption('server', 'Optional server name')]),
      serverAction('broadcast', 'broadcast', 'Send a server announcement', [textOption('message', 'Announcement text', true), textOption('server', 'Optional server name')]),
      serverAction('kick', 'kick', 'Kick a player', [textOption('player', 'Player name or ID', true), textOption('server', 'Server name when more than one is configured')]),
      serverAction('ban', 'ban', 'Ban a player', [textOption('player', 'Player name or ID', true), textOption('server', 'Server name when more than one is configured')]),
      serverAction('unban', 'unban', 'Unban a player', [textOption('player', 'Player name or ID', true), textOption('server', 'Server name when more than one is configured')]),
      serverAction('restart', 'restart', 'Restart a configured ARK server', [textOption('server', 'Server name when more than one is configured'), intOption('seconds', 'Delay before restart', false, 0, 3600)]),
      action('mods', 'mods', 'Show configured mod list'),
      action('backups', 'backups', 'Show recent backups'),
      scheduleGroup()
    ]
  },
  {
    moduleId: 'palworld', command: 'palworld', description: 'Palworld server tools', entries: [
      action('status', 'status', 'Show Palworld server status'),
      action('players', 'players', 'Show online players'),
      action('settings', 'settings', 'Show server settings'),
      action('metrics', 'metrics', 'Show server metrics'),
      action('save', 'save', 'Save the Palworld world'),
      action('broadcast', 'broadcast', 'Send a server announcement', [textOption('message', 'Announcement text', true)], (v) => ({ message: v.message })),
      action('kick', 'kick', 'Kick a player', [textOption('userid', 'Palworld user ID', true), textOption('message', 'Optional reason')], (v) => ({ userid: v.userid, ...(v.message ? { message: v.message } : {}) })),
      action('ban', 'ban', 'Ban a player', [textOption('userid', 'Palworld user ID', true), textOption('message', 'Optional reason')], (v) => ({ userid: v.userid, ...(v.message ? { message: v.message } : {}) })),
      action('unban', 'unban', 'Unban a player', [textOption('userid', 'Palworld user ID', true)], (v) => ({ userid: v.userid })),
      action('snapshot', 'snapshot', 'Show a world snapshot'),
      action('backups', 'backups', 'Show backup status and recent backups'),
      action('restart', 'restart', 'Restart through the configured host supervisor', [intOption('seconds', 'Delay before restart', false, 0, 3600), textOption('message', 'Restart message')], (v) => ({ seconds: v.seconds ?? 30, ...(v.message ? { message: v.message } : {}) })),
      action('shutdown', 'shutdown', 'Shut down the Palworld server', [intOption('seconds', 'Delay before shutdown', false, 0, 3600), textOption('message', 'Shutdown message')], (v) => ({ seconds: v.seconds ?? 30, ...(v.message ? { message: v.message } : {}) })),
      scheduleGroup()
    ]
  },
  {
    moduleId: 'minecraft', command: 'minecraft', description: 'Minecraft server tools', entries: [
      serverAction('status', 'status', 'Show Minecraft server status', [textOption('server', 'Optional server name')]),
      serverAction('players', 'players', 'Show online players', [textOption('server', 'Optional server name')]),
      action('servers', 'servers', 'List configured Minecraft servers'),
      serverAction('save', 'save', 'Save the world', [textOption('server', 'Optional server name')]),
      serverAction('broadcast', 'broadcast', 'Send a server announcement', [textOption('message', 'Announcement text', true), textOption('server', 'Optional server name')]),
      serverAction('kick', 'kick', 'Kick a player', [textOption('player', 'Player name', true), textOption('server', 'Server name when more than one is configured')]),
      serverAction('ban', 'ban', 'Ban a player', [textOption('player', 'Player name', true), textOption('server', 'Server name when more than one is configured')]),
      serverAction('pardon', 'unban', 'Pardon a player', [textOption('player', 'Player name', true), textOption('server', 'Server name when more than one is configured')]),
      serverAction('restart', 'restart', 'Restart a configured Minecraft server', [textOption('server', 'Server name when more than one is configured'), intOption('seconds', 'Delay before restart', false, 0, 3600)]),
      action('whitelist', 'whitelist', 'Show the whitelist'),
      action('modpack', 'modpack', 'Show configured modpack information'),
      action('backups', 'backups', 'Show recent backups'),
      scheduleGroup()
    ]
  },
  {
    moduleId: 'warframe', command: 'warframe', description: 'Warframe world-state and market tools', entries: [
      action('news', 'news', 'Show Warframe news'),
      action('events', 'events', 'Show active events'),
      action('alerts', 'alerts', 'Show alerts'),
      action('fissures', 'fissures', 'Show Void Fissures'),
      action('sortie', 'sortie', 'Show today’s Sortie'),
      action('arbitration', 'arbitration', 'Show Arbitration information'),
      action('nightwave', 'nightwave', 'Show Nightwave challenges'),
      action('invasions', 'invasions', 'Show invasions'),
      action('trader', 'void-trader', 'Show Void Trader status'),
      action('steelpath', 'steel-path', 'Show Steel Path information'),
      action('kuva', 'kuva', 'Show Kuva missions'),
      action('cycles', 'cycles', 'Show world cycles'),
      action('market', 'market', 'Look up an item on Warframe Market', [textOption('item', 'Item name', true)], (v) => ({ item: v.item, input: v.item })),
      action('build', 'builds', 'Get build help for a frame, weapon, or mod', [textOption('query', 'Frame, weapon, or mod', true)], (v) => ({ input: v.query, query: v.query }))
    ]
  },
  {
    moduleId: 'division2', command: 'division2', description: 'The Division 2 gear and build tools', entries: [
      action('gear', 'gear', 'Search gear, weapons, brands, sets, or talents', [textOption('query', 'What are you looking for?', true)], (v) => ({ input: v.query, query: v.query })),
      action('build', 'builds', 'Research a build', [textOption('goal', 'Build goal or keywords', true)], (v) => ({ input: v.goal, goal: v.goal })),
      action('optimize', 'optimize', 'Optimize a build goal', [textOption('goal', 'Build goal or problem', true)], (v) => ({ input: v.goal, goal: v.goal })),
      action('compare', 'compare', 'Compare two gear items', [textOption('first', 'First item', true), textOption('second', 'Second item', true)], (v) => ({ input: `${v.first}|${v.second}`, first: v.first, second: v.second })),
      action('farm', 'farming', 'Plan where to farm an item or set', [textOption('item', 'Item, brand, or gear set', true)], (v) => ({ input: v.item, item: v.item })),
      action('wishlist', 'wishlist', 'Manage your wishlist', [textOption('action', 'What to do', true, [['List', 'list'], ['Add', 'add'], ['Remove', 'remove']]), textOption('item', 'Item name when adding/removing')], (v) => ({ input: v.item ? `${v.action} ${v.item}` : v.action })),
      action('inventory', 'inventory', 'Manage your inventory vault', [textOption('action', 'What to do', true, [['List', 'list'], ['Add', 'add'], ['Remove', 'remove']]), textOption('item', 'Item name when adding/removing')], (v) => ({ input: v.item ? `${v.action} ${v.item}` : v.action })),
      action('weekly', 'weekly', 'Show weekly checklist'),
      action('lfg', 'lfg', 'Manage LFG', [textOption('action', 'What to do', true, [['List', 'list'], ['Join', 'join'], ['Leave', 'leave']]), textOption('activity', 'Activity name when joining')], (v) => ({ input: v.activity ? `${v.action} ${v.activity}` : v.action })),
      action('news', 'news', 'Show Division 2 news')
    ]
  },
  {
    moduleId: 'rust', command: 'rust', description: 'Rust server tools', entries: [
      action('status', 'status', 'Show Rust server status'),
      action('players', 'players', 'Show online players'),
      action('save', 'save', 'Save the server'),
      action('broadcast', 'broadcast', 'Send a server announcement', [textOption('message', 'Announcement text', true)], (v) => ({ message: v.message })),
      action('kick', 'kick', 'Kick a player', [textOption('player', 'Player name or Steam ID', true)], (v) => ({ player: v.player, target: v.player })),
      action('ban', 'ban', 'Ban a player', [textOption('player', 'Player name or Steam ID', true)], (v) => ({ player: v.player, target: v.player })),
      action('unban', 'unban', 'Unban a Steam ID', [textOption('steamid', 'Steam ID', true)], (v) => ({ steamId: v.steamid, target: v.steamid, input: v.steamid })),
      action('restart', 'restart', 'Restart the Rust server', [intOption('seconds', 'Delay before restart', false, 0, 3600)], (v) => ({ seconds: v.seconds ?? 60 })),
      action('backups', 'backups', 'Show recent backups'),
      scheduleGroup()
    ]
  },
  {
    moduleId: 'satisfactory', command: 'satisfactory', description: 'Satisfactory server tools', entries: [
      action('status', 'status', 'Show Satisfactory server status'),
      action('players', 'players', 'Show connected players'),
      action('save', 'save', 'Save the game', [textOption('name', 'Optional save name')], (v) => ({ saveName: v.name, input: v.name || '' })),
      action('saves', 'saves', 'Show save sessions'),
      action('options', 'server-options', 'Show server options'),
      action('advanced', 'advanced-settings', 'Show advanced settings'),
      action('load', 'load-save', 'Load a save', [textOption('name', 'Save name', true)], (v) => ({ saveName: v.name, input: v.name })),
      action('restart', 'restart', 'Restart the Satisfactory server'),
      action('backups', 'backups', 'Show recent backups'),
      scheduleGroup()
    ]
  },
  {
    moduleId: 'idleon', command: 'idleon', description: 'Legends of IdleOn tools', entries: [
      action('profile', 'profile', 'Show profile'),
      action('goals', 'goals', 'Manage goals', [textOption('action', 'What to do', true, [['List', 'list'], ['Add', 'add'], ['Done', 'done']]), textOption('value', 'Goal text or goal ID')], (v) => ({ input: v.value ? `${v.action} ${v.value}` : v.action })),
      action('build', 'builds', 'Get build help', [textOption('query', 'Class or character', true)], (v) => ({ input: v.query, query: v.query })),
      action('farm', 'farming', 'Get farming help', [textOption('target', 'What you want to farm', true)], (v) => ({ input: v.target, target: v.target })),
      action('calc', 'calculators', 'Run an IdleOn calculator', [textOption('input', 'Calculator input', true)], (v) => ({ input: v.input })),
      action('progress', 'progression', 'Show progression'),
      action('cards', 'cards', 'Show card information'),
      action('obols', 'obols', 'Show obol information'),
      action('greenstacks', 'greenstacks', 'Show Green Stack progress')
    ]
  },
  {
    moduleId: 'pokemongo', command: 'pogo', description: 'Pokémon GO community tools', entries: [
      action('panel', 'panel', 'Show the Pokémon GO operations panel'),
      action('friends', 'friends', 'Find trainers', [textOption('region', 'Vivillon region'), textOption('team', 'Team'), textOption('raidstyle', 'Raid style')], (v) => ({ region: v.region, team: v.team, raidStyle: v.raidstyle })),
      action('vivillon', 'vivillon', 'Find trainers for a Vivillon region', [textOption('region', 'Vivillon region', true)], (v) => ({ region: v.region, input: v.region })),
      action('pvp', 'pvp', 'Check a PvP team', [textOption('team', 'Team or Pokémon list', true)], (v) => ({ input: v.team, team: v.team })),
      group('raid', 'Raid tools', [
        action('list', 'raids', 'Show active raids'),
        action('create', 'raid-create', 'Create a raid', [textOption('boss', 'Raid boss', true), textOption('location', 'Location'), textOption('start', 'Start time'), textOption('end', 'End time'), boolOption('remote', 'Allow remote raiders')], (v) => ({ boss: v.boss, location: v.location, startsAt: v.start, endsAt: v.end, remoteAllowed: v.remote !== false })),
        action('rsvp', 'raid-rsvp', 'RSVP to a raid', [textOption('id', 'Raid ID', true), textOption('status', 'RSVP status', true, [['Local', 'local'], ['Remote', 'remote'], ['Maybe', 'maybe'], ['Leave', 'leave']])], (v) => ({ id: v.id, status: v.status })),
        action('cancel', 'raid-cancel', 'Cancel a raid you created', [textOption('id', 'Raid ID', true)], (v) => ({ id: v.id })),
        action('counter', 'counter', 'Get raid counter suggestions', [textOption('boss', 'Boss or typing', true)], (v) => ({ input: v.boss, boss: v.boss }))
      ]),
      group('trade', 'Trade tools', [
        action('list', 'trades', 'Show your trade list'),
        action('matches', 'trade-matches', 'Find matching trades'),
        action('add', 'trade-add', 'Add a Pokémon to your trade list', [textOption('kind', 'Want or offer', true, [['Want', 'want'], ['Offer', 'offer']]), textOption('pokemon', 'Pokémon name', true), boolOption('shiny', 'Shiny'), boolOption('lucky', 'Lucky'), textOption('notes', 'Notes')], (v) => ({ kind: v.kind, pokemon: v.pokemon, shiny: Boolean(v.shiny), lucky: Boolean(v.lucky), notes: v.notes })),
        action('remove', 'trade-remove', 'Remove a trade entry', [textOption('id', 'Trade entry ID', true)], (v) => ({ id: v.id }))
      ]),
      group('profile', 'Trainer profile tools', [
        action('view', 'profile', 'Show your trainer profile'),
        action('set', 'profile-set', 'Set your trainer profile', [textOption('name', 'Trainer name', true), textOption('team', 'Team'), intOption('level', 'Trainer level', false, 0, 80), textOption('friendcode', '12-digit friend code'), textOption('region', 'Vivillon region'), textOption('area', 'Trade area')], (v) => ({ trainerName: v.name, team: v.team, level: v.level, friendCode: v.friendcode, vivillonRegion: v.region, tradeArea: v.area }))
      ]),
      group('collection', 'Collection tools', [
        action('view', 'collection', 'Show your collection'),
        action('add', 'collection-add', 'Add a collection entry', [textOption('pokemon', 'Pokémon name', true), textOption('tags', 'Comma-separated tags'), textOption('notes', 'Notes')], (v) => ({ pokemon: v.pokemon, tags: v.tags, notes: v.notes })),
        action('remove', 'collection-remove', 'Remove a collection entry', [textOption('id', 'Collection entry ID', true)], (v) => ({ id: v.id }))
      ]),
      group('meetup', 'Meetup tools', [
        action('list', 'meetups', 'Show meetups'),
        action('create', 'meetup-create', 'Create a meetup', [textOption('name', 'Meetup name', true), textOption('location', 'Location'), textOption('start', 'Start time'), textOption('notes', 'Notes')], (v) => ({ name: v.name, location: v.location, startsAt: v.start, notes: v.notes })),
        action('rsvp', 'meetup-rsvp', 'RSVP to a meetup', [textOption('id', 'Meetup ID', true), textOption('status', 'RSVP status', true, [['Going', 'going'], ['Maybe', 'maybe'], ['Leave', 'leave']])], (v) => ({ id: v.id, status: v.status }))
      ]),
      group('showcase', 'Catch showcase tools', [
        action('list', 'showcase', 'Show recent catches'),
        action('add', 'showcase-add', 'Share a catch', [textOption('pokemon', 'Pokémon name', true), textOption('category', 'Category'), textOption('notes', 'Notes'), textOption('image', 'Image URL')], (v) => ({ pokemon: v.pokemon, category: v.category, notes: v.notes, imageUrl: v.image }))
      ]),
      group('event', 'Pokémon GO event tools', [
        action('list', 'events', 'Show current events'),
        action('add', 'event-add', 'Add an event reminder', [textOption('name', 'Event name', true), textOption('start', 'Start time'), textOption('end', 'End time'), textOption('notes', 'Notes')], (v) => ({ name: v.name, startsAt: v.start, endsAt: v.end, notes: v.notes })),
        action('remove', 'event-remove', 'Remove an event reminder', [textOption('id', 'Event ID', true)], (v) => ({ id: v.id }))
      ])
    ]
  }
]);

function addOption(sub, option) {
  if (option.type === 'integer') {
    sub.addIntegerOption((builder) => {
      builder.setName(option.name).setDescription(option.description).setRequired(option.required === true);
      if (Number.isInteger(option.min)) builder.setMinValue(option.min);
      if (Number.isInteger(option.max)) builder.setMaxValue(option.max);
      return builder;
    });
    return;
  }
  if (option.type === 'number') {
    sub.addNumberOption((builder) => {
      builder.setName(option.name).setDescription(option.description).setRequired(option.required === true);
      if (Number.isFinite(option.min)) builder.setMinValue(option.min);
      if (Number.isFinite(option.max)) builder.setMaxValue(option.max);
      return builder;
    });
    return;
  }
  if (option.type === 'boolean') {
    sub.addBooleanOption((builder) => builder.setName(option.name).setDescription(option.description).setRequired(option.required === true));
    return;
  }
  sub.addStringOption((builder) => {
    builder.setName(option.name).setDescription(option.description).setRequired(option.required === true);
    if (option.choices?.length) builder.addChoices(...option.choices.map(([name, value]) => ({ name, value })));
    return builder;
  });
}

function addAction(parent, item) {
  parent.addSubcommand((sub) => {
    sub.setName(item.name).setDescription(item.description.slice(0, 100));
    for (const option of item.options || []) addOption(sub, option);
    return sub;
  });
}

function buildCommand(spec) {
  const command = new SlashCommandBuilder().setName(spec.command).setDescription(spec.description);
  for (const entry of spec.entries) {
    if (entry.kind === 'group') {
      command.addSubcommandGroup((groupBuilder) => {
        groupBuilder.setName(entry.name).setDescription(entry.description.slice(0, 100));
        for (const item of entry.actions) addAction(groupBuilder, item);
        return groupBuilder;
      });
    } else addAction(command, entry);
  }
  return command;
}

function commandDefinitions() {
  return SPECS.map(buildCommand);
}

function commandNames() {
  return SPECS.map((spec) => spec.command);
}

function findAction(spec, groupName, subcommandName) {
  if (groupName) {
    const groupSpec = spec.entries.find((entry) => entry.kind === 'group' && entry.name === groupName);
    return groupSpec?.actions.find((entry) => entry.name === subcommandName) || null;
  }
  return spec.entries.find((entry) => entry.kind === 'action' && entry.name === subcommandName) || null;
}

function optionValue(interaction, option) {
  if (option.type === 'integer') return interaction.options.getInteger(option.name);
  if (option.type === 'number') return interaction.options.getNumber(option.name);
  if (option.type === 'boolean') return interaction.options.getBoolean(option.name);
  return interaction.options.getString(option.name);
}

function resolveFriendlyCommand(interaction) {
  const spec = SPECS.find((item) => item.command === interaction.commandName);
  if (!spec) return null;
  const groupName = interaction.options.getSubcommandGroup(false);
  const subcommandName = interaction.options.getSubcommand();
  const item = findAction(spec, groupName, subcommandName);
  if (!item) return null;
  const values = {};
  for (const option of item.options || []) {
    const value = optionValue(interaction, option);
    if (value !== null && value !== undefined && value !== '') values[option.name] = value;
  }
  const payload = item.payload ? item.payload(values) : values;
  return { moduleId: spec.moduleId, actionId: item.actionId, payload: payload || {}, command: spec.command, group: groupName || '', subcommand: subcommandName };
}

function usageForModule(moduleId) {
  const spec = SPECS.find((item) => item.moduleId === moduleId);
  if (!spec) return [];
  const lines = [];
  for (const entry of spec.entries) {
    if (entry.kind === 'group') {
      for (const item of entry.actions) lines.push(`/${spec.command} ${entry.name} ${item.name}`);
    } else lines.push(`/${spec.command} ${entry.name}`);
  }
  return lines;
}

function isFriendlyCommand(name) {
  return SPECS.some((spec) => spec.command === name);
}

module.exports = { SPECS, commandDefinitions, commandNames, isFriendlyCommand, resolveFriendlyCommand, usageForModule };
