'use strict';

const path = require('node:path');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

const WIDTH = 1024;
const HEIGHT = 576;
const RED = '#ff1e1e';
const RED_HOT = '#ff3b2e';
const WHITE = '#f4f6f8';
const SILVER = '#c8ced6';
const MUTED = '#8d949c';
const GUNMETAL = '#a7b0b9';

let fontsReady = false;

function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(__dirname, 'fonts');
  const cinzel = GlobalFonts.registerFromPath(path.join(dir, 'Cinzel-Bold.ttf'), 'Cinzel');
  const rajdhani = GlobalFonts.registerFromPath(path.join(dir, 'Rajdhani-SemiBold.ttf'), 'Rajdhani');
  if (!cinzel || !rajdhani) throw new Error('card-fonts-missing');
  fontsReady = true;
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function diamond(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
}

function hexagon(ctx, cx, cy, radius) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function ellipsis(ctx, text, maxWidth) {
  const value = String(text ?? '');
  if (maxWidth <= 0) return '';
  if (ctx.measureText(value).width <= maxWidth) return value;
  const mark = '…';
  let end = value.length;
  while (end > 0 && ctx.measureText(`${value.slice(0, end)}${mark}`).width > maxWidth) end -= 1;
  return end === 0 ? mark : `${value.slice(0, end)}${mark}`;
}

function paintBackground(ctx) {
  ctx.fillStyle = '#070406';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const right = ctx.createRadialGradient(820, 200, 20, 840, 240, 460);
  right.addColorStop(0, 'rgba(110, 0, 16, 0.55)');
  right.addColorStop(0.45, 'rgba(48, 0, 10, 0.28)');
  right.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = right;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const left = ctx.createRadialGradient(92, 96, 8, 92, 96, 170);
  left.addColorStop(0, 'rgba(140, 0, 18, 0.35)');
  left.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, 420, 280);
  ctx.strokeStyle = 'rgba(150, 24, 32, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 48; x < WIDTH; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, HEIGHT - 18);
    ctx.stroke();
  }
  for (let y = 48; y < HEIGHT; y += 64) {
    ctx.beginPath();
    ctx.moveTo(18, y);
    ctx.lineTo(WIDTH - 18, y);
    ctx.stroke();
  }
}

function paintFrame(ctx) {
  roundRect(ctx, 8, 8, WIDTH - 16, HEIGHT - 16, 18);
  ctx.strokeStyle = RED;
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(255, 24, 24, 0.9)';
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
}

function paintAvatar(ctx, avatar) {
  const cx = 90;
  const cy = 102;
  const radius = 52;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    const scale = Math.max((radius * 2) / avatar.width, (radius * 2) / avatar.height);
    const w = avatar.width * scale;
    const h = avatar.height * scale;
    ctx.drawImage(avatar, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = '#16080b';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = RED;
    ctx.font = '46px Cinzel';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy + 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
  ctx.strokeStyle = GUNMETAL;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
  ctx.strokeStyle = RED;
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(255, 20, 20, 0.8)';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#d5dbe2';
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    diamond(ctx, cx + dx * (radius + 6), cy + dy * (radius + 6), 4);
    ctx.fill();
  }
  ctx.lineWidth = 1;
}

function paintIdentity(ctx, model) {
  const nameX = 172;
  const maxName = 560;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = WHITE;
  ctx.font = '56px Cinzel';
  ctx.letterSpacing = '0.5px';
  const nameY = model.title ? 96 : 114;
  ctx.fillText(ellipsis(ctx, model.name, maxName), nameX, nameY);
  ctx.letterSpacing = '0px';
  if (!model.title) return;
  diamond(ctx, nameX + 6, 118, 5);
  ctx.fillStyle = RED;
  ctx.fill();
  ctx.font = '16px Cinzel';
  ctx.fillStyle = RED_HOT;
  ctx.letterSpacing = '1.6px';
  ctx.fillText(ellipsis(ctx, String(model.title).toUpperCase(), maxName - 24), nameX + 18, 126);
  ctx.letterSpacing = '0px';
  ctx.font = '12px Rajdhani';
  ctx.fillStyle = MUTED;
  ctx.letterSpacing = '1.8px';
  ctx.fillText('EQUIPPED TITLE', nameX, 148);
  ctx.letterSpacing = '0px';
}

function paintRank(ctx, model) {
  const cx = 918;
  const cy = 72;
  hexagon(ctx, cx, cy, 34);
  ctx.fillStyle = '#12080b';
  ctx.fill();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(255, 30, 30, 0.75)';
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;
  hexagon(ctx, cx, cy, 26);
  ctx.strokeStyle = 'rgba(255, 60, 50, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = '22px Cinzel';
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy + 1);
  const label = model.rankUnavailable ? 'UNAVAILABLE' : String(model.rank || '').toUpperCase();
  ctx.font = '15px Rajdhani';
  ctx.letterSpacing = '1px';
  const text = ellipsis(ctx, label, 188);
  const pillW = Math.min(220, Math.max(108, ctx.measureText(text).width + 28));
  const pillX = Math.max(760, Math.min(996 - pillW, cx - pillW / 2));
  const pillY = 116;
  roundRect(ctx, pillX, pillY, pillW, 26, 13);
  ctx.fillStyle = '#e10600';
  ctx.shadowColor = 'rgba(255, 20, 20, 0.7)';
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = WHITE;
  ctx.fillText(text, pillX + pillW / 2, pillY + 14);
  ctx.letterSpacing = '0px';
  ctx.font = '11px Rajdhani';
  ctx.fillStyle = MUTED;
  ctx.letterSpacing = '2px';
  ctx.fillText('RANK', cx, 160);
  ctx.letterSpacing = '0px';
  ctx.lineWidth = 1;
}

function paintLevel(ctx, model) {
  const y = 192;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '13px Rajdhani';
  ctx.fillStyle = MUTED;
  ctx.letterSpacing = '1.8px';
  ctx.fillText('LEVEL', 28, y);
  const labelW = ctx.measureText('LEVEL').width;
  ctx.letterSpacing = '0px';
  ctx.font = '28px Rajdhani';
  ctx.fillStyle = WHITE;
  ctx.fillText(model.levelUnavailable ? '—' : String(model.level.level), 36 + labelW, y + 2);
  ctx.font = '18px Rajdhani';
  ctx.textAlign = 'right';
  ctx.fillStyle = SILVER;
  const xp = model.levelUnavailable
    ? 'unavailable'
    : `${model.level.xp} / ${model.level.next} XP`;
  ctx.fillText(xp, 996, y);
  paintBar(ctx, 28, 206, 968, 16, model.levelUnavailable ? 0 : model.level.percent);
}

function paintBar(ctx, x, y, w, h, percent) {
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = '#140c0e';
  ctx.fill();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.clip();
  const fillW = Math.max(0, Math.min(w, (Math.max(0, Math.min(100, percent)) / 100) * w));
  if (fillW > 0) {
    ctx.shadowColor = 'rgba(255, 30, 36, 0.95)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = RED;
    ctx.fillRect(x, y - 2, fillW, h + 4);
    ctx.shadowBlur = 0;
    const gradient = ctx.createLinearGradient(x, y, x + fillW, y);
    gradient.addColorStop(0, '#ff5a42');
    gradient.addColorStop(0.55, '#ff1616');
    gradient.addColorStop(1, '#ff2e24');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, fillW, h);
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 18; i += 1) {
    const tick = x + (w * i) / 18;
    ctx.beginPath();
    ctx.moveTo(tick, y + 2);
    ctx.lineTo(tick, y + h - 2);
    ctx.stroke();
  }
  ctx.restore();
}

function paintChip(ctx, x, cy, code, rowH) {
  ctx.font = '12px Rajdhani';
  ctx.letterSpacing = '0.4px';
  const text = String(code || '').slice(0, 4);
  const width = Math.max(36, Math.ceil(ctx.measureText(text).width + 14));
  const height = rowH >= 28 ? 20 : 16;
  roundRect(ctx, x, cy - height / 2, width, height, 5);
  ctx.fillStyle = 'rgba(12, 12, 16, 0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(198, 206, 214, 0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#e7ebf0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + width / 2, cy + 0.5);
  ctx.letterSpacing = '0px';
  return width;
}

function paintRows(ctx, title, rows, more, unavailable, box) {
  roundRect(ctx, box.x, box.y, box.w, box.h, 14);
  ctx.fillStyle = 'rgba(8, 8, 12, 0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(168, 42, 50, 0.72)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '14px Rajdhani';
  ctx.fillStyle = SILVER;
  ctx.letterSpacing = '1.8px';
  ctx.fillText(title, box.x + 16, box.y + 22);
  ctx.letterSpacing = '0px';
  const top = box.y + 40;
  const inner = box.h - 52;
  if (unavailable) {
    ctx.font = '16px Rajdhani';
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    ctx.fillText('unavailable', box.x + 16, top + 14);
    return;
  }
  if (!rows.length && !more) {
    ctx.font = '16px Rajdhani';
    ctx.fillStyle = '#6f767e';
    ctx.textAlign = 'left';
    ctx.fillText('None linked', box.x + 16, top + 14);
    return;
  }
  const count = rows.length + (more ? 1 : 0);
  const rowH = Math.min(34, Math.max(16, Math.floor(inner / count)));
  rows.forEach((row, index) => {
    const y = top + index * rowH + rowH / 2;
    const chipW = paintChip(ctx, box.x + 14, y, row.code, rowH);
    ctx.font = '16px Rajdhani';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = WHITE;
    const tag = ellipsis(ctx, row.tag, box.w * 0.42);
    ctx.fillText(tag, box.x + box.w - 16, y);
    const tagW = ctx.measureText(tag).width;
    const labelX = box.x + 22 + chipW;
    const labelMax = box.x + box.w - 24 - tagW - labelX;
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = '16px Rajdhani';
    ctx.fillText(ellipsis(ctx, row.label, Math.max(24, labelMax)), labelX, y);
  });
  if (more) {
    const y = top + rows.length * rowH + rowH / 2;
    ctx.textAlign = 'left';
    ctx.font = '14px Rajdhani';
    ctx.fillStyle = '#6f767e';
    ctx.fillText(`+${more} more`, box.x + 16, y);
  }
}

function paintBalances(ctx, balances, y) {
  const parts = [
    ['Coins', balances.coins],
    ['Nexus Points', balances.points],
    ['Cache tokens', balances.cacheTokens]
  ];
  ctx.font = '14px Rajdhani';
  ctx.textBaseline = 'middle';
  const chunks = parts.map(([label, value]) => {
    const text = `${label}  ${value}`;
    return { text, width: ctx.measureText(text).width };
  });
  const gap = 28;
  const total = chunks.reduce((sum, chunk) => sum + chunk.width, 0) + gap * (chunks.length - 1);
  let x = (WIDTH - total) / 2;
  chunks.forEach((chunk, index) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = SILVER;
    ctx.fillText(chunk.text, x, y);
    x += chunk.width;
    if (index < chunks.length - 1) {
      ctx.fillStyle = RED;
      ctx.fillText('·', x + 10, y);
      x += gap;
    }
  });
}

function paintFooter(ctx, mottoY) {
  const motto = 'MANY WORLDS — ONE NEXUS';
  ctx.font = '14px Cinzel';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = SILVER;
  ctx.letterSpacing = '1.2px';
  const width = ctx.measureText(motto).width;
  ctx.fillText(motto, WIDTH / 2, mottoY);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = '#d7dbe1';
  diamond(ctx, WIDTH / 2 - width / 2 - 16, mottoY - 4, 4);
  ctx.fill();
  diamond(ctx, WIDTH / 2 + width / 2 + 16, mottoY - 4, 4);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.font = '11px Rajdhani';
  ctx.fillStyle = '#7d868e';
  ctx.letterSpacing = '1.5px';
  ctx.fillText('KHAOS NEXUS', 24, HEIGHT - 18);
  ctx.letterSpacing = '0px';
}

function paintCard(ctx, model) {
  const hasBalances = Boolean(model.balances);
  paintBackground(ctx);
  paintFrame(ctx);
  paintAvatar(ctx, model.avatar || null);
  paintIdentity(ctx, model);
  paintRank(ctx, model);
  paintLevel(ctx, model);
  const panelY = 238;
  const panelH = hasBalances ? 250 : 270;
  const gap = 14;
  const panelW = (WIDTH - 48 - gap) / 2;
  paintRows(ctx, 'PLATFORMS', model.platforms || [], model.platformMore || 0, model.platformsUnavailable === true, {
    x: 24,
    y: panelY,
    w: panelW,
    h: panelH
  });
  paintRows(ctx, 'GAMES', model.games || [], model.gameMore || 0, model.gamesUnavailable === true, {
    x: 24 + panelW + gap,
    y: panelY,
    w: panelW,
    h: panelH
  });
  if (hasBalances) paintBalances(ctx, model.balances, panelY + panelH + 16);
  paintFooter(ctx, hasBalances ? 546 : 552);
}

async function drawCardPng(model, avatarBytes) {
  if (!model) throw new Error('empty-model');
  ensureFonts();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  let avatar = null;
  if (avatarBytes && avatarBytes.length) {
    try {
      avatar = await loadImage(Buffer.from(avatarBytes));
    } catch {
      avatar = null;
    }
  }
  paintCard(ctx, { ...model, avatar });
  return canvas.toBuffer('image/png');
}

module.exports = {
  WIDTH,
  HEIGHT,
  drawCardPng
};
