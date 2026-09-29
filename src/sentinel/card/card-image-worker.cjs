'use strict';

const { parentPort } = require('node:worker_threads');
const { drawCardPng } = require('./card-image-draw.cjs');

parentPort.on('message', async (message) => {
  try {
    const png = await drawCardPng(message.model, message.avatar || null);
    parentPort.postMessage({ id: message.id, ok: true, png });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: String(error?.message || error).slice(0, 180)
    });
  }
});
