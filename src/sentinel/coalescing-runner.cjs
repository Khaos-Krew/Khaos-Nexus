'use strict';

function cleanReason(value) {
  return String(value || 'event').trim() || 'event';
}

function joinedReason(reasons) {
  const values = [...reasons];
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  return `queued:${values.join('+')}`;
}

function createCoalescingRunner(worker, options = {}) {
  if (typeof worker !== 'function') throw new TypeError('worker must be a function');
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  let activePromise = null;
  const pendingReasons = new Set();

  async function drain(initialReason) {
    let reason = cleanReason(initialReason);
    while (reason) {
      try {
        await worker(reason);
      } catch (error) {
        onError(error, reason);
      }
      reason = joinedReason(pendingReasons);
      pendingReasons.clear();
    }
  }

  function request(reason = 'event') {
    const normalized = cleanReason(reason);
    if (activePromise) {
      pendingReasons.add(normalized);
      return activePromise;
    }

    activePromise = drain(normalized).finally(() => {
      activePromise = null;
    });
    return activePromise;
  }

  function isRunning() {
    return Boolean(activePromise);
  }

  function pending() {
    return [...pendingReasons];
  }

  return { request, isRunning, pending };
}

module.exports = { cleanReason, joinedReason, createCoalescingRunner };
