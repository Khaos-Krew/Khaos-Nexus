'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeServerDefinition, monetizationRisk, clean } = require('../../shared/game-server-catalog.cjs');

const APPLICATION_STATES = new Set(['submitted','changes-required','approved','denied']);
const MONETIZATION_MODELS = new Set(['none','donations-cost-recovery','cosmetic-support','paid-convenience','commercial']);

function nowIso() { return new Date().toISOString(); }
function newId() { return `APP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function bool(value) { return value === true; }

class ServerApplicationStore {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(process.env.NEXUS_DATA_DIR || 'data','server-applications.json');
    this.state = { version:1, applications:[] };
    this.load();
  }
  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      if (parsed && Array.isArray(parsed.applications)) this.state = { version:1, applications:parsed.applications };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(this.state,null,2));
    fs.renameSync(temp,this.filePath);
  }
  list(options = {}) {
    let rows = this.state.applications;
    if (options.applicantDiscordId) rows = rows.filter((item)=>item.applicantDiscordId === String(options.applicantDiscordId));
    if (options.status) rows = rows.filter((item)=>item.status === String(options.status));
    return clone(rows).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  get(id) { return clone(this.state.applications.find((item)=>item.id === String(id).toUpperCase()) || null); }
  submit(input = {}) {
    const applicantDiscordId = clean(input.applicantDiscordId,32);
    if (!/^\d{15,24}$/.test(applicantDiscordId)) throw new Error('A valid Discord applicant ID is required.');
    if (input.policyAccepted !== true) throw new Error('You must accept the Khaos Nexus community-server policy before submitting.');
    const monetizationModel = clean(input.monetizationModel || input.monetization,40).toLowerCase() || 'none';
    if (!MONETIZATION_MODELS.has(monetizationModel)) throw new Error('Unsupported monetization model.');
    const server = normalizeServerDefinition(input.server || input,{ allowEndpointless:true });
    const risk = monetizationRisk({
      monetizationModel,
      paidAdvantages:bool(input.paidAdvantages),
      mandatoryFees:bool(input.mandatoryFees),
      affiliateReferral:bool(input.affiliateReferral)
    });
    const createdAt = nowIso();
    const application = {
      id:newId(), applicantDiscordId, status:'submitted',
      server:{ ...server, ownershipType:'community-approved' },
      monetization:{
        model:monetizationModel,
        details:clean(input.monetizationDetails,1200),
        paidAdvantages:bool(input.paidAdvantages), mandatoryFees:bool(input.mandatoryFees), affiliateReferral:bool(input.affiliateReferral),
        policyAccepted:true
      },
      riskFlags:risk.flags, hardBlocked:risk.hardBlocked,
      reviewReason:'', reviewerDiscordId:'', approvedServerId:'',
      createdAt, updatedAt:createdAt,
      audit:[{ at:createdAt, action:'submitted', actorDiscordId:applicantDiscordId, note:'Community server application submitted.' }]
    };
    this.state.applications.push(application); this.save(); return clone(application);
  }
  review(id, input = {}, hostedServers) {
    const key = String(id || '').toUpperCase();
    const index = this.state.applications.findIndex((item)=>item.id === key);
    if (index < 0) return null;
    const application = this.state.applications[index];
    const decision = clean(input.decision,40).toLowerCase();
    if (!APPLICATION_STATES.has(decision) || decision === 'submitted') throw new Error('Review decision must be approved, changes-required, or denied.');
    if (decision === 'approved' && application.hardBlocked) throw new Error('This application has hard monetization-policy blocks and cannot be approved until the application is corrected.');
    const reviewerDiscordId = clean(input.reviewerDiscordId,32);
    const reason = clean(input.reason,1200);
    let approvedServerId = application.approvedServerId || '';
    if (decision === 'approved' && !approvedServerId) {
      if (!hostedServers) throw new Error('Hosted server registry is required to approve an application.');
      const promoted = hostedServers.add({
        ...application.server,
        ownershipType:'community-approved', ownerDiscordId:application.applicantDiscordId, approvalId:application.id,
        public:true, listingState:'listed', accessRank:'',
        adminNotes:`Approved community listing from ${application.id}${reason ? ` — ${reason}` : ''}`
      });
      approvedServerId = promoted.id;
    }
    const updatedAt = nowIso();
    application.status = decision;
    application.reviewReason = reason;
    application.reviewerDiscordId = reviewerDiscordId;
    application.approvedServerId = approvedServerId;
    application.updatedAt = updatedAt;
    application.audit = Array.isArray(application.audit) ? application.audit : [];
    application.audit.push({ at:updatedAt, action:`review:${decision}`, actorDiscordId:reviewerDiscordId, note:reason || 'No review note supplied.' });
    this.save(); return clone(application);
  }
}

module.exports = { APPLICATION_STATES, MONETIZATION_MODELS, ServerApplicationStore };
