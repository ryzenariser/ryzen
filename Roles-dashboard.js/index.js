// Roles-dashboard.js/index.js
//
// Backend registry for the role dashboards. Every C-suite seat has its own
// module in this folder (COO.js, CTO.js, ...). api/admin.js calls run() from
// the `role-dashboard` action after it has confirmed who is asking.
//
// IMPORTANT: this folder must live OUTSIDE public/ (next to api/) — it is
// server code. Every module is required by a literal path below so Vercel's
// bundler includes it in the admin function. Do not switch these to dynamic
// requires, and do not move them into api/ (each file in api/ would count
// against Vercel Hobby's 12-function limit).

'use strict';

const helpers = require('./_helpers.js');

// Order matches the org-title list the admin panel has always used.
const ROLES = {
  'COO': require('./COO.js'),
  'CTO': require('./CTO.js'),
  'CFO': require('./CFO.js'),
  'CMO': require('./CMO.js'),
  'CLO': require('./CLO.js'),
  'CHRO': require('./CHRO.js'),
  'CAIO': require('./CAIO.js'),
  'CDO (Design)': require('./CDO-Design.js'),
  'CPO': require('./CPO.js'),
  'CECO': require('./CECO.js'),
  'CCO': require('./CCO.js'),
  'CDO (Data)': require('./CDO-Data.js'),
};

const ROLE_TITLES = Object.keys(ROLES);

// true  = a seat can be held by one sub-admin at a time (matches the Org
//         Chart, which shows a single holder per seat).
// false = several sub-admins may share a seat.
const ONE_PERSON_PER_ROLE = true;

const HTML_FOLDER = 'Roles-dashboard.html';

// 'CDO (Design)' -> 'CDO-Design'. admin.html uses the same rule.
function fileKey(title) {
  return String(title).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function has(title) {
  return Object.prototype.hasOwnProperty.call(ROLES, title);
}

// URL of the static dashboard page for a seat, or null for no seat.
function pathFor(title) {
  return title && has(title) ? `/${HTML_FOLDER}/${fileKey(title)}.html` : null;
}

function listRoles() {
  return ROLE_TITLES.map((title) => ({ title, path: pathFor(title) }));
}

// ctx: { supabase, session, admin, env, getJSON, integrationEnvVars }
async function run(title, ctx) {
  if (!has(title)) throw new Error(`No dashboard module for role "${title}".`);
  const mod = ROLES[title];
  const data = await mod.load({ ...ctx, h: helpers, orgTitles: ROLE_TITLES });
  return {
    role: title,
    title: mod.title,
    departments: mod.departments,
    notBuilt: mod.notBuilt,
    data,
  };
}

// Runs one write action (a form on a role page saving something).
// ctx: { supabase, session, admin, env, getJSON, body }
async function act(title, name, ctx) {
  if (!has(title)) throw helpers.httpError(400, 'Unrecognized role.');
  const actions = ROLES[title].actions || {};
  if (!Object.prototype.hasOwnProperty.call(actions, name)) throw helpers.httpError(400, 'Unknown action.');
  return actions[name]({ ...ctx, h: helpers, orgTitles: ROLE_TITLES });
}

module.exports = { act, ROLE_TITLES, ONE_PERSON_PER_ROLE, fileKey, has, pathFor, listRoles, run };
