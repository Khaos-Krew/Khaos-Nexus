'use strict';

const fs = require('node:fs');
const path = require('node:path');

function calendarPath(dir) {
  return path.join(dir, 'cephalon-event-calendar.json');
}

function emptyCalendar() {
  return { title: '', when: '', note: '', updatedBy: '', updatedAt: '', messageId: '' };
}

class EventCalendarStore {
  constructor(dir) {
    this.dir = dir;
    this.file = calendarPath(dir);
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return emptyCalendar();
      return {
        title: String(parsed.title || '').slice(0, 120),
        when: String(parsed.when || '').slice(0, 80),
        note: String(parsed.note || '').slice(0, 500),
        updatedBy: String(parsed.updatedBy || '').replace(/\D/g, '').slice(0, 20),
        updatedAt: String(parsed.updatedAt || ''),
        messageId: String(parsed.messageId || '').replace(/\D/g, '').slice(0, 20)
      };
    } catch {
      return emptyCalendar();
    }
  }

  write(entry) {
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = {
      title: String(entry.title || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120),
      when: String(entry.when || '').replace(/[\r\n]/g, ' ').trim().slice(0, 80),
      note: String(entry.note || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500),
      updatedBy: String(entry.updatedBy || '').replace(/\D/g, '').slice(0, 20),
      updatedAt: new Date().toISOString(),
      messageId: String(entry.messageId || '').replace(/\D/g, '').slice(0, 20)
    };
    fs.writeFileSync(this.file, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return safe;
  }

  clear(actorId) {
    return this.write({ title: '', when: '', note: '', updatedBy: actorId, messageId: '' });
  }
}

function calendarEmbed(entry) {
  if (!entry?.title) {
    return { title: 'Warframe event calendar', description: 'No event is pinned. Staff can set one with `/calendar set`.', fields: [] };
  }
  return {
    title: entry.title.slice(0, 256),
    description: [entry.when ? `**When**\n${entry.when}` : '', entry.note ? `**Note**\n${entry.note}` : ''].filter(Boolean).join('\n\n').slice(0, 4000) || 'Pinned event.',
    footer: { text: 'Cephalon Nexus • staff-refreshable event pin' }
  };
}

module.exports = { EventCalendarStore, calendarEmbed, emptyCalendar };
