'use strict';

const ADMIN_WALLET_PATHS = Object.freeze(['/wallet/admin-credit', '/wallet/admin-spend']);

function registerAdminWalletDrainPaths(drainMutationPaths) {
  for (const path of ADMIN_WALLET_PATHS) drainMutationPaths.add(path);
  return drainMutationPaths;
}

async function handleAdminWalletPost(urlPath, { worker, input, json, res }) {
  if (urlPath === '/wallet/admin-credit') {
    if (typeof worker.adminCredit !== 'function') {
      return json(res, 200, { ok: false, skipped: 'admin-credit-unsupported' });
    }
    return json(res, 200, await worker.adminCredit(input));
  }
  if (urlPath === '/wallet/admin-spend') {
    if (typeof worker.adminSpend !== 'function') {
      return json(res, 200, { ok: false, skipped: 'admin-spend-unsupported' });
    }
    return json(res, 200, await worker.adminSpend(input));
  }
  return null;
}

module.exports = {
  ADMIN_WALLET_PATHS,
  registerAdminWalletDrainPaths,
  handleAdminWalletPost
};
