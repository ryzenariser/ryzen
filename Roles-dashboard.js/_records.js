// Roles-dashboard.js/_records.js
//
// Turns a plain description of a table into the save / delete / status
// actions a role page needs. Table and column names come ONLY from the
// descriptions in the role files, never from the browser, and every value is
// checked here before it reaches the database.
//
//   const rec = defineRecords({
//     supplier: { table: 'suppliers', fields: [ { key: 'name', col: 'name', label: 'Name', type: 'text', required: true } ] },
//   });
//   actions: { ...rec.actions }   // -> save-supplier, delete-supplier
//
// Field types: text, url, email, number, int, date, month, enum (with values), uuid.
// dbDefault: true  = leave the column out when blank so the database default applies.

'use strict';

const { httpError, todayISO } = require('./_helpers.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Returns the cleaned value, null (blank optional), or undefined (leave the column out).
function cleanValue(f, raw) {
  const blank = raw === undefined || raw === null || String(raw).trim() === '';
  if (blank) {
    if (f.required) throw httpError(400, `${f.label} is required.`);
    return f.dbDefault ? undefined : null;
  }
  const s = String(raw).trim();
  switch (f.type) {
    case 'number':
    case 'int': {
      const n = Number(s);
      if (!Number.isFinite(n)) throw httpError(400, `${f.label} must be a number.`);
      if (f.type === 'int' && !Number.isInteger(n)) throw httpError(400, `${f.label} must be a whole number.`);
      if (f.min !== undefined && n < f.min) throw httpError(400, `${f.label} must be ${f.min} or more.`);
      if (f.max !== undefined && n > f.max) throw httpError(400, `${f.label} must be ${f.max} or less.`);
      return n;
    }
    case 'date':
      if (!validDate(s)) throw httpError(400, `${f.label} must be a valid date.`);
      return s;
    case 'month':
      if (!/^\d{4}-\d{2}$/.test(s) || !validDate(s + '-01')) throw httpError(400, `${f.label} must be a valid month.`);
      return s + '-01';
    case 'enum':
      if (!f.values.includes(s)) throw httpError(400, `${f.label} must be one of: ${f.values.join(', ')}.`);
      return s;
    case 'uuid':
      if (!UUID.test(s)) throw httpError(400, `Choose a valid ${f.label.toLowerCase()}.`);
      return s;
    case 'email':
      if (!EMAIL.test(s) || s.length > 200) throw httpError(400, `${f.label} must be a valid email address.`);
      return s.toLowerCase();
    case 'url':
      if (!/^https?:\/\/\S+$/i.test(s) || s.length > 500) throw httpError(400, `${f.label} must be a link starting with http:// or https://.`);
      return s;
    default: {
      const max = f.long ? 1000 : 200;
      if (s.length > max) throw httpError(400, `${f.label} is too long (max ${max} characters).`);
      return s;
    }
  }
}

// Turn database errors into plain messages. Anything unexpected is logged
// on the server and shown as a generic message.
function explain(err) {
  if (err && err.status) return err;
  const code = err && err.code;
  if (code === '23503') return httpError(409, 'Other records still use this. Remove those first.');
  if (code === '23505') return httpError(409, 'That record already exists.');
  if (code === '23514') return httpError(400, 'One of the values is not allowed.');
  if (code === '42P01' || code === 'PGRST205') return httpError(500, 'This section\u2019s table has not been created yet. Run the SQL setup file in Supabase first.');
  console.error('roles-dashboard record action failed:', err && err.message);
  return httpError(500, 'Could not save. Try again.');
}

function buildRow(def, body) {
  const row = {};
  for (const f of def.fields) {
    const v = cleanValue(f, body[f.key]);
    if (v !== undefined) row[f.col] = v;
  }
  if (def.stamp) row[def.stamp] = new Date().toISOString();
  return row;
}

function idFrom(def, body) {
  const idCol = def.idColumn || 'id';
  const id = String(body.id === undefined || body.id === null ? '' : body.id).trim();
  if (!id) throw httpError(400, 'Which record?');
  if (idCol === 'id' && !UUID.test(id)) throw httpError(400, 'That is not a valid record.');
  if (id.length > 200) throw httpError(400, 'That is not a valid record.');
  return { idCol, id };
}

function defineRecords(defs) {
  const actions = {};
  for (const [key, def] of Object.entries(defs)) {
    actions[`save-${key}`] = async ({ supabase, body }) => {
      const row = buildRow(def, body || {});
      try {
        const query = def.conflict
          ? supabase.from(def.table).upsert(row, { onConflict: def.conflict })
          : supabase.from(def.table).insert(row);
        const { error } = await query;
        if (error) throw error;
      } catch (err) { throw explain(err); }
      return { saved: true };
    };

    actions[`delete-${key}`] = async ({ supabase, body }) => {
      const { idCol, id } = idFrom(def, body || {});
      try {
        const { error } = await supabase.from(def.table).delete().eq(idCol, id);
        if (error) throw error;
      } catch (err) { throw explain(err); }
      return { removed: true };
    };

    if (def.status) {
      const column = def.status.column || 'status';
      actions[`update-${key}-status`] = async ({ supabase, body }) => {
        const { idCol, id } = idFrom(def, body || {});
        const status = String((body || {}).status || '');
        if (!def.status.values.includes(status)) throw httpError(400, `Status must be one of: ${def.status.values.join(', ')}.`);
        const patch = { [column]: status, ...(def.status.onSet ? def.status.onSet(status) : {}) };
        try {
          const { error } = await supabase.from(def.table).update(patch).eq(idCol, id);
          if (error) throw error;
        } catch (err) { throw explain(err); }
        return { updated: true };
      };
    }
  }
  return { actions };
}

// Small field builders so role files stay readable.
const f = {
  text: (key, col, label, o = {}) => ({ key, col, label, type: 'text', ...o }),
  url: (key, col, label, o = {}) => ({ key, col, label, type: 'url', ...o }),
  email: (key, col, label, o = {}) => ({ key, col, label, type: 'email', ...o }),
  number: (key, col, label, o = {}) => ({ key, col, label, type: 'number', ...o }),
  int: (key, col, label, o = {}) => ({ key, col, label, type: 'int', ...o }),
  date: (key, col, label, o = {}) => ({ key, col, label, type: 'date', ...o }),
  month: (key, col, label, o = {}) => ({ key, col, label, type: 'month', ...o }),
  uuid: (key, col, label, o = {}) => ({ key, col, label, type: 'uuid', ...o }),
  enum: (key, col, label, values, o = {}) => ({ key, col, label, type: 'enum', values, ...o }),
};

module.exports = { defineRecords, cleanValue, f, todayISO };
