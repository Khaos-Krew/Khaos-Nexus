'use strict';

const BUSY_UPDATE_STATES = Object.freeze(new Set(['checking', 'downloading', 'installing']));

async function runUpdateFlow(service) {
  if (!service || typeof service.getState !== 'function') {
    throw new Error('The Khaos Nexus update service is unavailable.');
  }

  let state = service.getState();
  if (BUSY_UPDATE_STATES.has(state.status)) {
    throw new Error('An update operation is already in progress.');
  }

  if (!['available', 'downloaded'].includes(state.status)) {
    if (typeof service.check !== 'function') throw new Error('The update service cannot check for releases.');
    state = await service.check();
  }

  if (state.status === 'current') return state;
  if (state.status === 'development') {
    throw new Error('In-app updates are only available in packaged Khaos Nexus builds.');
  }

  if (state.status === 'available') {
    if (typeof service.download !== 'function') throw new Error('The update service cannot download releases.');
    await service.download();
    state = service.getState();
  }

  if (state.status === 'downloaded') {
    if (typeof service.install !== 'function') throw new Error('The update service cannot install releases.');
    return service.install();
  }

  if (state.status === 'installing') return state;
  if (state.status === 'error') throw new Error(state.error || 'The update operation failed.');
  throw new Error(`The update could not continue from state '${state.status || 'unknown'}'.`);
}

module.exports = { BUSY_UPDATE_STATES, runUpdateFlow };
