'use strict';

// Live guild role ids. Every check that recognizes these roles imports this
// module. Matching is by id only. Nothing here creates, renames, or edits the
// Discord roles.
const OWNER_ROLE_ID = '1516602930457739354';
const CM_ROLE_ID = '1521219329360920767';

module.exports = {
  OWNER_ROLE_ID,
  CM_ROLE_ID,
  COMMUNITY_MANAGER_ROLE_ID: CM_ROLE_ID
};
