'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const TEAM_CHOICES = [
  { name:'Mystic', value:'mystic' },
  { name:'Valor', value:'valor' },
  { name:'Instinct', value:'instinct' }
];

function dt(value) {
  if (!value) return 'Not specified';
  const ms=Date.parse(value);
  return Number.isFinite(ms) ? `<t:${Math.floor(ms/1000)}:F>` : String(value).slice(0,80);
}
function ctx(interaction, role) { return { role, actorId:String(interaction.user.id), confirmed:true }; }
function unwrap(result) {
  if (!result?.ok) throw new Error(result?.message || 'Pokémon GO backend action failed.');
  return result.data;
}
function mentions(ids=[]) { return ids.map(id=>`<@${id}>`).join(', ') || 'None yet'; }

function pogoCommand() {
  return new SlashCommandBuilder()
    .setName('pogo')
    .setDescription('Pokémon GO coordination tools from Nexus Sentinal')
    .addSubcommandGroup(g=>g.setName('profile').setDescription('Trainer profile')
      .addSubcommand(s=>s.setName('show').setDescription('Show your Pokémon GO trainer profile'))
      .addSubcommand(s=>s.setName('set').setDescription('Create or update your trainer profile')
        .addStringOption(o=>o.setName('trainer').setDescription('Pokémon GO trainer name').setRequired(true))
        .addStringOption(o=>o.setName('team').setDescription('Team').addChoices(...TEAM_CHOICES))
        .addIntegerOption(o=>o.setName('level').setDescription('Trainer level').setMinValue(1).setMaxValue(80))
        .addStringOption(o=>o.setName('friend_code').setDescription('12-digit friend code'))
        .addStringOption(o=>o.setName('raid_style').setDescription('local, remote, or both'))
        .addStringOption(o=>o.setName('vivillon').setDescription('Vivillon/postcard region'))
        .addStringOption(o=>o.setName('trade_area').setDescription('General trade area; do not post a home address'))))
    .addSubcommand(s=>s.setName('friends').setDescription('Search the trainer/friend-code directory')
      .addStringOption(o=>o.setName('team').setDescription('Filter by team').addChoices(...TEAM_CHOICES))
      .addStringOption(o=>o.setName('region').setDescription('Filter by Vivillon region'))
      .addStringOption(o=>o.setName('raid_style').setDescription('Filter by raid style')))
    .addSubcommandGroup(g=>g.setName('trade').setDescription('Trade matcher')
      .addSubcommand(s=>s.setName('add').setDescription('Add a wanted or offered Pokémon')
        .addStringOption(o=>o.setName('kind').setDescription('Want or offer').setRequired(true).addChoices({name:'Want',value:'want'},{name:'Offer',value:'offer'}))
        .addStringOption(o=>o.setName('pokemon').setDescription('Pokémon name').setRequired(true))
        .addBooleanOption(o=>o.setName('shiny').setDescription('Shiny'))
        .addBooleanOption(o=>o.setName('lucky').setDescription('Lucky trade target'))
        .addStringOption(o=>o.setName('notes').setDescription('Optional trade notes')))
      .addSubcommand(s=>s.setName('list').setDescription('Show your trade list'))
      .addSubcommand(s=>s.setName('matches').setDescription('Find matching trainers'))
      .addSubcommand(s=>s.setName('remove').setDescription('Remove one of your trade entries')
        .addStringOption(o=>o.setName('id').setDescription('Trade entry id').setRequired(true))))
    .addSubcommandGroup(g=>g.setName('raid').setDescription('Raid and Max Battle coordination')
      .addSubcommand(s=>s.setName('create').setDescription('Create a raid or Max Battle card')
        .addStringOption(o=>o.setName('boss').setDescription('Boss Pokémon').setRequired(true))
        .addStringOption(o=>o.setName('battle_type').setDescription('Raid type').addChoices(
          {name:'Raid',value:'raid'},{name:'Mega Raid',value:'mega'},{name:'Shadow Raid',value:'shadow'},
          {name:'Max Battle',value:'max'},{name:'Gigantamax',value:'gigantamax'}))
        .addStringOption(o=>o.setName('tier').setDescription('Tier, e.g. 5-star'))
        .addStringOption(o=>o.setName('location').setDescription('Gym/meeting location').setRequired(true))
        .addStringOption(o=>o.setName('starts').setDescription('Start date/time, preferably ISO or explicit local time'))
        .addStringOption(o=>o.setName('ends').setDescription('End date/time'))
        .addBooleanOption(o=>o.setName('remote').setDescription('Remote participation allowed'))
        .addStringOption(o=>o.setName('notes').setDescription('Optional notes')))
      .addSubcommand(s=>s.setName('list').setDescription('List active raids and Max Battles'))
      .addSubcommand(s=>s.setName('rsvp').setDescription('RSVP to a raid by id')
        .addStringOption(o=>o.setName('id').setDescription('Raid id').setRequired(true))
        .addStringOption(o=>o.setName('status').setDescription('RSVP status').setRequired(true).addChoices(
          {name:'Local',value:'local'},{name:'Remote',value:'remote'},{name:'Maybe',value:'maybe'},{name:'Leave',value:'leave'})))
      .addSubcommand(s=>s.setName('cancel').setDescription('Cancel a raid you created')
        .addStringOption(o=>o.setName('id').setDescription('Raid id').setRequired(true))))
    .addSubcommand(s=>s.setName('vivillon').setDescription('Find trainers from a Vivillon region')
      .addStringOption(o=>o.setName('region').setDescription('Vivillon region').setRequired(true)))
    .addSubcommandGroup(g=>g.setName('collection').setDescription('Personal collection tracker')
      .addSubcommand(s=>s.setName('add').setDescription('Track a Pokémon')
        .addStringOption(o=>o.setName('pokemon').setDescription('Pokémon name').setRequired(true))
        .addStringOption(o=>o.setName('tags').setDescription('Comma-separated tags: shiny,hundo,lucky,shadow,etc.'))
        .addStringOption(o=>o.setName('notes').setDescription('Optional notes')))
      .addSubcommand(s=>s.setName('list').setDescription('Show your tracked collection'))
      .addSubcommand(s=>s.setName('remove').setDescription('Remove a collection entry')
        .addStringOption(o=>o.setName('id').setDescription('Collection entry id').setRequired(true))))
    .addSubcommandGroup(g=>g.setName('showcase').setDescription('Catch showcase')
      .addSubcommand(s=>s.setName('add').setDescription('Post a catch to the showcase')
        .addStringOption(o=>o.setName('pokemon').setDescription('Pokémon name').setRequired(true))
        .addStringOption(o=>o.setName('category').setDescription('shiny, hundo, shundo, nundo, XXL, etc.'))
        .addStringOption(o=>o.setName('image').setDescription('Optional image URL'))
        .addStringOption(o=>o.setName('notes').setDescription('Optional notes')))
      .addSubcommand(s=>s.setName('list').setDescription('Show recent community catches')))
    .addSubcommandGroup(g=>g.setName('meetup').setDescription('Community meetup coordination')
      .addSubcommand(s=>s.setName('create').setDescription('Create a meetup card')
        .addStringOption(o=>o.setName('name').setDescription('Meetup name').setRequired(true))
        .addStringOption(o=>o.setName('location').setDescription('Public meeting location').setRequired(true))
        .addStringOption(o=>o.setName('starts').setDescription('Start date/time'))
        .addStringOption(o=>o.setName('campfire').setDescription('Optional Campfire meetup link'))
        .addStringOption(o=>o.setName('notes').setDescription('Optional notes')))
      .addSubcommand(s=>s.setName('list').setDescription('List upcoming meetups'))
      .addSubcommand(s=>s.setName('rsvp').setDescription('Join or leave a meetup')
        .addStringOption(o=>o.setName('id').setDescription('Meetup id').setRequired(true))
        .addBooleanOption(o=>o.setName('going').setDescription('Going?').setRequired(true))))
    .addSubcommandGroup(g=>g.setName('event').setDescription('Pokémon GO event calendar')
      .addSubcommand(s=>s.setName('list').setDescription('Show tracked Pokémon GO events'))
      .addSubcommand(s=>s.setName('add').setDescription('Add an event reminder (owner)')
        .addStringOption(o=>o.setName('name').setDescription('Event name').setRequired(true))
        .addStringOption(o=>o.setName('starts').setDescription('Start date/time'))
        .addStringOption(o=>o.setName('ends').setDescription('End date/time'))
        .addStringOption(o=>o.setName('notes').setDescription('Notes')))
      .addSubcommand(s=>s.setName('remove').setDescription('Remove an event reminder (owner)')
        .addStringOption(o=>o.setName('id').setDescription('Event id').setRequired(true))))
    .addSubcommand(s=>s.setName('counter').setDescription('Calculate raid boss type weaknesses')
      .addStringOption(o=>o.setName('boss').setDescription('Boss name').setRequired(true))
      .addStringOption(o=>o.setName('types').setDescription('Boss type(s), comma-separated').setRequired(true)))
    .addSubcommand(s=>s.setName('pvp').setDescription('Check a 3-Pokémon team for shared type weaknesses')
      .addStringOption(o=>o.setName('league').setDescription('PvP league').addChoices(
        {name:'Great',value:'great'},{name:'Ultra',value:'ultra'},{name:'Master',value:'master'}))
      .addStringOption(o=>o.setName('team').setDescription('Format: Azumarill:water/fairy, Skarmory:steel/flying, ...').setRequired(true)))
    .addSubcommand(s=>s.setName('panel').setDescription('Post the Pokémon GO Operations Panel'));
}

function raidEmbed(raid) {
  return {
    color:0xE31B23,
    title:`⚔️ ${raid.boss} • ${raid.battleType || 'raid'}`,
    description:[
      raid.tier ? `**Tier:** ${raid.tier}` : '',
      `**Location:** ${raid.location || 'Not specified'}`,
      `**Starts:** ${dt(raid.startsAt)}`,
      raid.endsAt ? `**Ends:** ${dt(raid.endsAt)}` : '',
      `**Remote:** ${raid.remoteAllowed ? 'Allowed' : 'Local only'}`,
      raid.notes ? `**Notes:** ${raid.notes}` : ''
    ].filter(Boolean).join('\n'),
    fields:[
      { name:`📍 Local (${raid.attendees?.local?.length||0})`, value:mentions(raid.attendees?.local), inline:true },
      { name:`🌐 Remote (${raid.attendees?.remote?.length||0})`, value:mentions(raid.attendees?.remote), inline:true },
      { name:`❔ Maybe (${raid.attendees?.maybe?.length||0})`, value:mentions(raid.attendees?.maybe), inline:true }
    ],
    footer:{ text:`Raid ID: ${raid.id} • Nexus Sentinal Pokémon GO` }
  };
}
function raidButtons(raid) {
  return [{ type:1, components:[
    { type:2, style:3, label:'I’m Going', custom_id:`pogo:raid:${raid.id}:local` },
    { type:2, style:1, label:'Remote', custom_id:`pogo:raid:${raid.id}:remote`, disabled:!raid.remoteAllowed },
    { type:2, style:2, label:'Maybe', custom_id:`pogo:raid:${raid.id}:maybe` },
    { type:2, style:4, label:'Withdraw', custom_id:`pogo:raid:${raid.id}:leave` }
  ] }];
}
function meetupEmbed(m) {
  return {
    color:0xB00020,
    title:`📅 ${m.name}`,
    description:[
      `**Location:** ${m.location || 'Not specified'}`,
      `**Starts:** ${dt(m.startsAt)}`,
      `**Going:** ${m.attendees?.length||0}`,
      m.campfireUrl ? `**Campfire:** ${m.campfireUrl}` : '',
      m.notes ? `**Notes:** ${m.notes}` : ''
    ].filter(Boolean).join('\n'),
    footer:{ text:`Meetup ID: ${m.id}` }
  };
}
function panelPayload() {
  return {
    embeds:[{
      color:0xE31B23,
      title:'⚡ KHAOS NEXUS — POKÉMON GO',
      description:'Sentinal coordinates Pokémon GO through Discord without logging into or automating the game client.',
      fields:[
        {name:'⚔️ Operations',value:'Raids • Max Battles • Meetups • Events',inline:true},
        {name:'🧑‍🤝‍🧑 Community',value:'Trainer Profiles • Friend Codes • Trades • Vivillon',inline:true},
        {name:'🧠 Tools',value:'Counters • PvP • Collection • Catch Showcase',inline:true}
      ],
      footer:{text:'Use /pogo for full commands • No Pokémon GO credentials required'}
    }],
    components:[{type:1,components:[
      {type:2,style:4,label:'Raids',custom_id:'pogo:panel:raids'},
      {type:2,style:2,label:'Trainers',custom_id:'pogo:panel:trainers'},
      {type:2,style:2,label:'Trades',custom_id:'pogo:panel:trades'},
      {type:2,style:2,label:'Vivillon',custom_id:'pogo:panel:vivillon'},
      {type:2,style:1,label:'More',custom_id:'pogo:panel:more'}
    ]}]
  };
}

async function invoke(backend, interaction, role, action, payload={}) {
  return unwrap(await backend.invoke('pokemongo', action, payload, ctx(interaction, role)));
}

async function handlePokemonGoCommand(interaction, { backend, roleFor }) {
  const group=interaction.options.getSubcommandGroup(false);
  const sub=interaction.options.getSubcommand();
  const role=await roleFor(interaction);
  const publicAction=(group==='raid' && sub==='create') || (group==='meetup' && sub==='create') || (group==='showcase' && sub==='add') || (!group && sub==='panel');
  await interaction.deferReply(publicAction ? {} : { flags:MessageFlags.Ephemeral });

  if (group==='profile' && sub==='show') {
    const d=await invoke(backend,interaction,role,'profile');
    if(!d.profile) return interaction.editReply('No Pokémon GO profile yet. Use `/pogo profile set`.');
    const p=d.profile;
    return interaction.editReply(`**${p.trainerName}** • ${p.team||'no team'} • Lv ${p.level||'?'}\nFriend code: ${p.friendCode||'not shared'}\nVivillon: ${p.vivillonRegion||'not set'}\nRaid style: ${p.raidStyle||'not set'}\nTrade area: ${p.tradeArea||'not set'}`);
  }
  if (group==='profile' && sub==='set') {
    const d=await invoke(backend,interaction,role,'profile-set',{
      trainerName:interaction.options.getString('trainer',true), team:interaction.options.getString('team'),
      level:interaction.options.getInteger('level'), friendCode:interaction.options.getString('friend_code'),
      raidStyle:interaction.options.getString('raid_style'), vivillonRegion:interaction.options.getString('vivillon'),
      tradeArea:interaction.options.getString('trade_area')
    });
    return interaction.editReply(`✅ Pokémon GO profile saved for **${d.trainerName}**.`);
  }
  if (!group && sub==='friends') {
    const d=await invoke(backend,interaction,role,'friends',{team:interaction.options.getString('team'),region:interaction.options.getString('region'),raidStyle:interaction.options.getString('raid_style')});
    const lines=d.profiles.map(p=>`• **${p.trainerName}** • ${p.team||'—'} • ${p.vivillonRegion||'no region'} • ${p.friendCode||'friend code private/not set'}`);
    return interaction.editReply(lines.join('\n').slice(0,1900)||'No matching trainers found.');
  }
  if (group==='trade' && sub==='add') {
    const d=await invoke(backend,interaction,role,'trade-add',{kind:interaction.options.getString('kind',true),pokemon:interaction.options.getString('pokemon',true),shiny:interaction.options.getBoolean('shiny'),lucky:interaction.options.getBoolean('lucky'),notes:interaction.options.getString('notes')});
    return interaction.editReply(`✅ Trade entry **${d.id}** added: ${d.kind} **${d.pokemon}**.`);
  }
  if (group==='trade' && sub==='list') {
    const d=await invoke(backend,interaction,role,'trades');
    return interaction.editReply(d.trades.map(t=>`• \`${t.id}\` **${t.kind.toUpperCase()}** ${t.pokemon}${t.shiny?' ✨':''}${t.lucky?' 🍀':''}`).join('\n').slice(0,1900)||'Your trade list is empty.');
  }
  if (group==='trade' && sub==='matches') {
    const d=await invoke(backend,interaction,role,'trade-matches');
    const lines=d.matches.map(m=>`• ${m.trainer?.trainerName||`<@${m.offer.discordId}>`} offers **${m.offer.pokemon}**${m.reciprocal?` and wants **${m.reciprocal.pokemon}** from you`:''}`);
    return interaction.editReply(lines.join('\n').slice(0,1900)||'No trade matches found yet.');
  }
  if (group==='trade' && sub==='remove') {
    await invoke(backend,interaction,role,'trade-remove',{id:interaction.options.getString('id',true)});
    return interaction.editReply('✅ Trade entry removed.');
  }
  if (group==='raid' && sub==='create') {
    const d=await invoke(backend,interaction,role,'raid-create',{
      boss:interaction.options.getString('boss',true), battleType:interaction.options.getString('battle_type')||'raid',
      tier:interaction.options.getString('tier'), location:interaction.options.getString('location',true),
      startsAt:interaction.options.getString('starts'), endsAt:interaction.options.getString('ends'),
      remoteAllowed:interaction.options.getBoolean('remote') ?? true, notes:interaction.options.getString('notes')
    });
    return interaction.editReply({embeds:[raidEmbed(d)],components:raidButtons(d)});
  }
  if (group==='raid' && sub==='list') {
    const d=await invoke(backend,interaction,role,'raids');
    const lines=d.raids.map(r=>`• \`${r.id}\` **${r.boss}** • ${r.location||'—'} • ${r.startsAt||'time not set'} • ${r.attendees.local.length+r.attendees.remote.length} going`);
    return interaction.editReply(lines.join('\n').slice(0,1900)||'No active raids are tracked.');
  }
  if (group==='raid' && sub==='rsvp') {
    const d=await invoke(backend,interaction,role,'raid-rsvp',{id:interaction.options.getString('id',true),status:interaction.options.getString('status',true)});
    return interaction.editReply(`✅ RSVP updated for **${d.boss}**.`);
  }
  if (group==='raid' && sub==='cancel') {
    const d=await invoke(backend,interaction,role,'raid-cancel',{id:interaction.options.getString('id',true)});
    return interaction.editReply(`✅ Raid **${d.boss}** cancelled.`);
  }
  if (!group && sub==='vivillon') {
    const d=await invoke(backend,interaction,role,'vivillon',{region:interaction.options.getString('region',true)});
    const lines=d.profiles.map(p=>`• **${p.trainerName}** • Friend code: ${p.friendCode}`);
    return interaction.editReply(`**🦋 ${d.region} Vivillon trainers**\n${lines.join('\n')||'No trainers registered for this region yet.'}`);
  }
  if (group==='collection' && sub==='add') {
    const d=await invoke(backend,interaction,role,'collection-add',{pokemon:interaction.options.getString('pokemon',true),tags:interaction.options.getString('tags'),notes:interaction.options.getString('notes')});
    return interaction.editReply(`✅ Added **${d.pokemon}** to your collection as \`${d.id}\`.`);
  }
  if (group==='collection' && sub==='list') {
    const d=await invoke(backend,interaction,role,'collection');
    return interaction.editReply(d.collection.map(e=>`• \`${e.id}\` **${e.pokemon}** ${e.tags?.length?`[${e.tags.join(', ')}]`:''}`).join('\n').slice(0,1900)||'Your tracked collection is empty.');
  }
  if (group==='collection' && sub==='remove') {
    await invoke(backend,interaction,role,'collection-remove',{id:interaction.options.getString('id',true)});
    return interaction.editReply('✅ Collection entry removed.');
  }
  if (group==='showcase' && sub==='add') {
    const d=await invoke(backend,interaction,role,'showcase-add',{pokemon:interaction.options.getString('pokemon',true),category:interaction.options.getString('category'),imageUrl:interaction.options.getString('image'),notes:interaction.options.getString('notes')});
    return interaction.editReply({embeds:[{color:0xFFD54F,title:`🏆 ${d.category.toUpperCase()} • ${d.pokemon}`,description:d.notes||`Shared by <@${d.discordId}>`,image:d.imageUrl?{url:d.imageUrl}:undefined,footer:{text:`Showcase ID: ${d.id}`}}]});
  }
  if (group==='showcase' && sub==='list') {
    const d=await invoke(backend,interaction,role,'showcase',{limit:15});
    return interaction.editReply(d.entries.map(e=>`• **${e.pokemon}** • ${e.category} • <@${e.discordId}>`).join('\n').slice(0,1900)||'No catches have been showcased yet.');
  }
  if (group==='meetup' && sub==='create') {
    const d=await invoke(backend,interaction,role,'meetup-create',{name:interaction.options.getString('name',true),location:interaction.options.getString('location',true),startsAt:interaction.options.getString('starts'),campfireUrl:interaction.options.getString('campfire'),notes:interaction.options.getString('notes')});
    return interaction.editReply({embeds:[meetupEmbed(d)]});
  }
  if (group==='meetup' && sub==='list') {
    const d=await invoke(backend,interaction,role,'meetups');
    return interaction.editReply(d.meetups.map(m=>`• \`${m.id}\` **${m.name}** • ${m.location} • ${m.startsAt||'time not set'} • ${m.attendees.length} going`).join('\n').slice(0,1900)||'No upcoming meetups are tracked.');
  }
  if (group==='meetup' && sub==='rsvp') {
    const d=await invoke(backend,interaction,role,'meetup-rsvp',{id:interaction.options.getString('id',true),going:interaction.options.getBoolean('going',true)});
    return interaction.editReply(`✅ Meetup RSVP updated for **${d.name}**.`);
  }
  if (group==='event' && sub==='list') {
    const d=await invoke(backend,interaction,role,'events');
    const lines=d.events.map(e=>`• \`${e.id}\` **${e.name}** • ${e.startsAt||'start not set'} → ${e.endsAt||'end not set'}`);
    return interaction.editReply(`${lines.join('\n')||'No tracked event reminders yet.'}\n\nOfficial news: ${d.officialNewsUrl}`);
  }
  if (group==='event' && sub==='add') {
    if(role!=='owner') throw new Error('Adding shared event reminders requires Nexus owner access.');
    const d=await invoke(backend,interaction,role,'event-add',{name:interaction.options.getString('name',true),startsAt:interaction.options.getString('starts'),endsAt:interaction.options.getString('ends'),notes:interaction.options.getString('notes')});
    return interaction.editReply(`✅ Event **${d.name}** added as \`${d.id}\`.`);
  }
  if (group==='event' && sub==='remove') {
    if(role!=='owner') throw new Error('Removing shared event reminders requires Nexus owner access.');
    await invoke(backend,interaction,role,'event-remove',{id:interaction.options.getString('id',true)});
    return interaction.editReply('✅ Event reminder removed.');
  }
  if (!group && sub==='counter') {
    const d=await invoke(backend,interaction,role,'counter',{boss:interaction.options.getString('boss',true),types:interaction.options.getString('types',true)});
    const lines=d.recommendations.map(r=>`• **${r.type}** — ${r.examples.join(', ')||'use your strongest matching attackers'}`);
    return interaction.editReply(`**⚔️ ${d.boss} counter guide**\nBoss typing: ${d.types.join(' / ')}\nWeak to: ${d.weaknesses.map(w=>`${w.type}${w.doublePressure?' ★':''}`).join(', ')}\n\n${lines.join('\n')}\n\n_${d.note}_`);
  }
  if (!group && sub==='pvp') {
    const d=await invoke(backend,interaction,role,'pvp',{league:interaction.options.getString('league')||'great',team:interaction.options.getString('team',true)});
    const lines=d.team.map(p=>`• **${p.name}** (${p.types.join('/')||'typing missing'}) — weak: ${p.weaknesses.join(', ')||'unknown'}`);
    return interaction.editReply(`**⚔️ ${d.league.toUpperCase()} League team check**\n${lines.join('\n')}\n\n${d.assessment}`);
  }
  if (!group && sub==='panel') return interaction.editReply(panelPayload());
  throw new Error('Unknown Pokémon GO command.');
}

async function handlePokemonGoButton(interaction, { backend, roleFor }) {
  const raid=/^pogo:raid:(raid-[a-f0-9]{8}):(local|remote|maybe|leave)$/.exec(interaction.customId);
  if(raid) {
    const role=await roleFor(interaction);
    await interaction.deferUpdate();
    const d=await invoke(backend,interaction,role,'raid-rsvp',{id:raid[1],status:raid[2]});
    return interaction.editReply({embeds:[raidEmbed(d)],components:raidButtons(d)});
  }
  const panel=/^pogo:panel:(raids|trainers|trades|vivillon|more)$/.exec(interaction.customId);
  if(panel) {
    const help={
      raids:'Use `/pogo raid create`, `/pogo raid list`, or the RSVP buttons on raid cards.',
      trainers:'Use `/pogo profile set`, `/pogo profile show`, and `/pogo friends`.',
      trades:'Use `/pogo trade add`, `/pogo trade list`, and `/pogo trade matches`.',
      vivillon:'Set your region with `/pogo profile set`, then search with `/pogo vivillon`.',
      more:'Use `/pogo counter`, `/pogo pvp`, `/pogo collection`, `/pogo showcase`, `/pogo meetup`, and `/pogo event`.'
    };
    return interaction.reply({content:help[panel[1]],flags:MessageFlags.Ephemeral});
  }
  return false;
}

module.exports = { pogoCommand, handlePokemonGoCommand, handlePokemonGoButton, raidEmbed, panelPayload };
