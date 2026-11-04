// VERSION 1.3.1 | Equipment & Vehicle Register backend | 2026-11-03
const VERSION = '1.3.1';
const SESSION_DAYS = 30; // how long a sign-in stays valid on a device
const DOC_FOLDER_ID = '1V4oGSyvksaeVSVuAS5dRdMwiHJoGArPc'; // Drive folder "Equipment-&-Vehicle-Register": uploaded documents are stored here, one subfolder per entry
const ADMIN_EMAIL = 'Ignatius.Ambrosio@ecooils.com.my'; // seeded as first HSSE user by setup()

const EQ_H = ['ID','Category','Type','MakeModel','PlateSerial','Company','OperatorName','OperatorLicenceClass','Status','LocationStatus','NextInspection','DecisionNote','Remarks','SubmittedBy','SubmittedAt','DecidedBy','DecidedAt','UpdatedAt'];
const DOC_H = ['DocID','ItemID','DocType','Number','Expiry','FileName','FileId','UploadedBy','UploadedAt','Verified','VerifiedBy','VerifiedAt','Note','Current'];
const ST_H = ['StickerNo','ItemID','Token','IssuedAt','IssuedBy','Status','PrintCount','PrintedAt','PrintedBy','ReprintAllowed','ReprintReason','VoidReason','VoidedBy','VoidedAt'];
const IN_H = ['InspID','ItemID','Date','Inspector','Kind','Result','Checklist','Notes'];
const AU_H = ['Time','User','Action','ItemID','Detail'];
const CT_H = ['ContactID','Company','Role','Name','Email','Active'];
const RL_H = ['Key','SentAt'];
const SS_H = ['TokenHash','Email','Expires'];
const CT_ROLES = ['Logistics', 'HR', 'HSSE'];
const REMIND_AT = [30, 14, 7, 3, 0]; // days before expiry when a reminder is sent; after expiry it repeats weekly
const USER_H = ['Email','Name','Role','Company','Active','Salt','Hash'];

const MAX_BYTES = 4 * 1024 * 1024;
const MIMES = ['application/pdf', 'image/jpeg', 'image/png'];
const KIR_EXEMPT = ['Light vehicle', 'Motorcycle'];
const LIFT = ['Mobile crane', 'Crawler crane', 'Tower crane', 'Hoist / chain block'];
const REINSPECT_DAYS = 183; // periodic re-inspection interval (about 6 months): change here

// Required documents. exp: 1 = expiry required, 2 = expiry optional, 0 = none. num: document number required.
// Basis (verify with HSSE/legal): UU 22/2009 LLAJ, PP 55/2012, Permenhub 19/2021 (vehicles);
// Permenaker 8/2020, 9/2010 (lifting equipment and operators), 38/2016 (generators, compressors).
const DOCL = { stnk: 'STNK', pkb: 'PKB tax / SWDKLLJ proof', own: 'Ownership (BPKB copy) or rental agreement', ins: 'Insurance', sim: 'Driver SIM', mcu: 'Medical fit (MCU)', ddc: 'Defensive driving certificate', photo: 'Photos', chk: 'Pre-mobilisation checklist', kir: 'KIR periodic test', b3: 'B3 permit / TREM card / SDS', silo: 'SILO', rep: 'PJK3 inspection & load test report', sio: 'Operator SIO', rig: 'Rigger / signalman certificate', man: 'Manual / load chart / data plate', mnt: 'Maintenance record' };

function docRules(i) {
  const R = [];
  if (i.Category === 'Vehicle') {
    R.push(['stnk', 1, 1], ['pkb', 1, 0], ['own', 2, 0], ['ins', 1, 0], ['sim', 1, 1], ['mcu', 1, 0], ['ddc', 1, 0], ['photo', 0, 0], ['chk', 0, 0]);
    if (KIR_EXEMPT.indexOf(i.Type) < 0) R.push(['kir', 1, 1]);
    if (i.Type === 'Tanker truck') R.push(['b3', 2, 0]);
  } else {
    R.push(['silo', 1, 1], ['rep', 1, 1], ['sio', 1, 1], ['mcu', 1, 0], ['ins', 1, 0], ['own', 2, 0], ['man', 0, 0], ['mnt', 0, 0], ['photo', 0, 0], ['chk', 0, 0]);
    if (LIFT.indexOf(i.Type) >= 0) R.push(['rig', 1, 1]);
  }
  return R.map(r => ({ k: r[0], exp: r[1], num: !!r[2] }));
}

function inspItems(i) {
  return i.Category === 'Vehicle'
    ? ['lights', 'brakes', 'tyres', 'horn', 'rev', 'belts', 'mirrors', 'leaks', 'fire', 'aid', 'chock', 'body', 'ivms', 'interior'].concat(i.Type === 'Truck' || i.Type === 'Tanker truck' || i.Type === 'Pickup / light truck' ? ['cargo'] : [])
    : ['hyd', 'steer', 'safety', 'alarms', 'rops', 'guards', 'under', 'fire', 'aid', 'plate', 'leaks', 'spark', 'body'].concat(LIFT.indexOf(i.Type) >= 0 ? ['rope'] : []);
}

// ---------- ONE-TIME SETUP: run once from the Apps Script editor ----------
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [['Equipment', EQ_H], ['Documents', DOC_H], ['Stickers', ST_H], ['Inspections', IN_H], ['Audit', AU_H], ['Contacts', CT_H], ['ReminderLog', RL_H], ['Sessions', SS_H], ['Users', USER_H]].forEach(p => {
    const sh = ss.getSheetByName(p[0]) || ss.insertSheet(p[0]);
    if (sh.getLastRow() === 0) sh.appendRow(p[1]);
    sh.getRange(2, 1, sh.getMaxRows() - 1, p[1].length).setNumberFormat('@');
  });
  const us = ss.getSheetByName('Users');
  if (us.getLastRow() === 1) us.appendRow([ADMIN_EMAIL, 'Iggy', 'HSSE', 'EcoOils', true, '', '']); // no PIN: set via "Forgot PIN" in the app
  DriveApp.getFolderById(DOC_FOLDER_ID); // fails here if this account cannot open the documents folder
}

// ---------- HTTP ----------
function doGet() { return out({ ok: true, service: 'Equipment & Vehicle Register', version: VERSION }); }

function doPost(e) {
  try {
    const r = JSON.parse(e.postData.contents);
    switch (r.action) {
      case 'requestReset': return out(requestReset(r.email));
      case 'setPin':       return out(setPin(r.email, r.code, r.pin));
      case 'login':        return out(login(r.email, r.pin));
      case 'verify':       return out(verifyPublic(r.id, r.t));
      case 'logout':       return out(logout(r.token));
    }
    const user = auth(r.token);
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      switch (r.action) {
        case 'list':           return out(listAll(user));
        case 'saveItem':       return out(saveItem(user, r.item));
        case 'submit':         return out(submitItem(user, r.itemId));
        case 'uploadDoc':      return out(uploadDoc(user, r));
        case 'getFile':        return out(getFile(user, r.docId));
        case 'verifyDoc':      return out(verifyDoc(user, r.docId, r.result, r.note));
        case 'approve':        return out(approve(user, r.itemId, r.checklist, r.notes));
        case 'reject':         return out(reject(user, r.itemId, r.note));
        case 'voidItem':       return out(voidItem(user, r.itemId, r.reason));
        case 'printSticker':   return out(printSticker(user, r.itemId));
        case 'allowReprint':   return out(allowReprint(user, r.itemId, r.reason));
        case 'listContacts':   return out(listContacts(user));
        case 'saveContact':    return out(saveContact(user, r.contact));
        case 'removeContact':  return out(removeContact(user, r.contactId));
        case 'sendRemindersNow': needHSSE(user); return out({ ok: true, sent: sendReminders() });
      }
    } finally { lock.releaseLock(); }
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err.message || err) });
  }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- generic sheet helpers ----------
function sheet(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }
function norm(e) { return String(e || '').trim().toLowerCase(); }
function isTrue(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function iso() { return new Date().toISOString(); }
function todayStr() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function plusDays(n) { return Utilities.formatDate(new Date(Date.now() + n * 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function fmtDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}
function readAll(name, H) {
  const v = sheet(name).getDataRange().getValues(), out = [];
  for (let i = 1; i < v.length; i++) {
    const o = { _row: i + 1 };
    H.forEach((h, j) => o[h] = fmtDate(v[i][j]));
    if (o[H[0]]) out.push(o);
  }
  return out;
}
function rowVals(H, o) { return H.map(h => o[h] === undefined || o[h] === null ? '' : o[h]); }
function writeRow(name, H, o) { sheet(name).getRange(o._row, 1, 1, H.length).setValues([rowVals(H, o)]); }
function addRow(name, H, o) { sheet(name).appendRow(rowVals(H, o)); }
function strip(o) { const c = Object.assign({}, o); delete c._row; return c; }
function audit(user, action, itemId, detail) { addRow('Audit', AU_H, { Time: iso(), User: user.email, Action: action, ItemID: itemId, Detail: detail || '' }); }

// ---------- AUTH (PIN only via email reset) ----------
function findUser(email) {
  const v = sheet('Users').getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (norm(v[i][0]) === norm(email) && String(v[i][4]).toUpperCase() !== 'FALSE') return { row: i + 1, vals: v[i] };
  }
  return null;
}
function hash(salt, pin) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin)); }

function requestReset(email) {
  const u = findUser(email);
  if (u) { // same response whether or not the email exists
    const code = String(Math.floor(100000 + Math.random() * 900000));
    CacheService.getScriptCache().put('reset_' + norm(email), code, 900);
    MailApp.sendEmail(email, 'Equipment & Vehicle Register - PIN reset code',
      'Your one-time code is ' + code + '. It is valid for 15 minutes.\nIf you did not request this, ignore this email.');
  }
  return { ok: true };
}
function setPin(email, code, pin) {
  if (!/^\d{4,8}$/.test(String(pin))) throw new Error('PIN must be 4 to 8 digits');
  const cache = CacheService.getScriptCache(), key = 'reset_' + norm(email), u = findUser(email);
  if (!u || cache.get(key) !== String(code)) throw new Error('Invalid or expired code');
  const salt = Utilities.getUuid();
  sheet('Users').getRange(u.row, 6, 1, 2).setValues([[salt, hash(salt, pin)]]);
  cache.remove(key);
  dropSessions(s => norm(s.Email) === norm(email)); // a PIN reset signs the user out everywhere
  return { ok: true };
}
function login(email, pin) {
  const cache = CacheService.getScriptCache(), fk = 'fail_' + norm(email);
  if (Number(cache.get(fk) || 0) >= 5) throw new Error('Too many attempts. Try again in 15 minutes or reset your PIN.');
  const u = findUser(email);
  if (!u || !u.vals[5] || hash(u.vals[5], String(pin)) !== u.vals[6]) {
    cache.put(fk, String(Number(cache.get(fk) || 0) + 1), 900);
    throw new Error('Wrong email or PIN. Use "Forgot PIN" to set one.');
  }
  cache.remove(fk);
  const user = { email: u.vals[0], name: u.vals[1], role: effRole(u.vals[2], u.vals[3]), company: u.vals[3] };
  return { ok: true, token: newSession(u.vals[0]), user: user, days: SESSION_DAYS };
}
// ---------- sessions (stay signed in for SESSION_DAYS; only a hash of the token is stored) ----------
function tokenHash(t) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'tok:' + t)); }
function sessSheet() {
  let sh = sheet('Sessions');
  if (!sh) {
    sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Sessions');
    sh.appendRow(SS_H);
    sh.getRange(2, 1, sh.getMaxRows() - 1, SS_H.length).setNumberFormat('@');
  }
  return sh;
}
function dropSessions(pred) { // delete matching rows, bottom first
  const sh = sessSheet(), rows = readAll('Sessions', SS_H).filter(pred).map(r => r._row).sort((a, b) => b - a);
  rows.forEach(r => sh.deleteRow(r));
}
function newSession(email) {
  const sh = sessSheet(), now = iso();
  dropSessions(s => s.Expires < now); // tidy expired sessions
  const token = Utilities.getUuid() + Utilities.getUuid();
  sh.appendRow([tokenHash(token), email, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString()]);
  return token;
}
function auth(token) {
  sessSheet();
  const s = token && readAll('Sessions', SS_H).filter(x => x.TokenHash === tokenHash(token))[0];
  if (!s || s.Expires < iso()) throw new Error('Session expired. Please sign in again.');
  const u = findUser(s.Email); // role changes and deactivation apply immediately
  if (!u) throw new Error('Session expired. Please sign in again.');
  return { email: u.vals[0], name: u.vals[1], role: effRole(u.vals[2], u.vals[3]), company: u.vals[3] };
}
function logout(token) {
  if (token) { const h = tokenHash(token); dropSessions(s => s.TokenHash === h); }
  return { ok: true };
}
// Sheet wording is forgiving: "HSSE Manager", "hsse", "Admin" at EcoOils = HSSE; any contractor company = IC; "viewer" = Viewer.
function effRole(role, company) {
  const r = norm(role), eco = norm(company) === 'ecooils';
  if (r.indexOf('view') === 0) return 'Viewer';
  if (eco) return (r.indexOf('hsse') === 0 || r.indexOf('admin') === 0) ? 'HSSE' : 'Viewer';
  return 'IC';
}
function canSee(u, it) { return u.role === 'HSSE' || u.role === 'Viewer' || (u.role === 'IC' && norm(it.Company) === norm(u.company)); }
function canWork(u, it) { return u.role === 'HSSE' || (u.role === 'IC' && norm(it.Company) === norm(u.company)); }
function needHSSE(u) { if (u.role !== 'HSSE') throw new Error('HSSE rights required'); }
function getItem(id) {
  const it = readAll('Equipment', EQ_H).filter(x => x.ID === id)[0];
  if (!it) throw new Error('Entry not found');
  return it;
}

// ---------- document state and fitness ----------
// For each required document: 'ok' needs a HSSE-verified, unexpired document. A newer unverified
// upload (renewal) never replaces a still-valid verified one until HSSE verifies it.
function ruleStates(item, allDocs, today) {
  return docRules(item).map(r => {
    const cur = allDocs.filter(d => d.ItemID === item.ID && d.DocType === r.k && isTrue(d.Current))
      .sort((a, b) => a.UploadedAt < b.UploadedAt ? 1 : -1);
    const o = { k: r.k, exp: r.exp, num: r.num, s: 'missing', docId: '', pendingId: '' };
    if (!cur.length) return o;
    const good = cur.filter(d => d.Verified === 'Yes' && !(d.Expiry && d.Expiry < today))[0];
    const pend = cur.filter(d => d.Verified === '')[0];
    if (good) { o.s = 'ok'; o.docId = good.DocID; o.pendingId = pend ? pend.DocID : ''; return o; }
    if (pend) { o.s = 'unverified'; o.docId = pend.DocID; return o; }
    o.docId = cur[0].DocID;
    o.s = cur[0].Verified === 'No' ? 'rejected' : 'expired';
    return o;
  });
}
function fitness(item, allDocs, today) {
  if (item.Status === 'Void') return { state: 'VOID', why: [item.DecisionNote || 'Inspection void: re-inspection required'] };
  if (item.Status !== 'Approved') return { state: 'NOT APPROVED', why: [item.Status] };
  const why = [];
  ruleStates(item, allDocs, today).forEach(r => { if (r.s !== 'ok') why.push((DOCL[r.k] || r.k) + ': ' + r.s); });
  if (item.NextInspection && item.NextInspection < today) why.push('Re-inspection overdue (' + item.NextInspection + ')');
  return { state: why.length ? 'SUSPENDED' : 'FIT', why: why };
}

// ---------- list ----------
function listAll(user) {
  const today = todayStr();
  const items = readAll('Equipment', EQ_H).filter(i => canSee(user, i));
  const docsAll = readAll('Documents', DOC_H).filter(d => isTrue(d.Current));
  const ids = {}; items.forEach(i => ids[i.ID] = 1);
  const outItems = items.map(i => {
    const f = fitness(i, docsAll, today), o = strip(i);
    o.Fit = f.state; o.FitWhy = f.why; o.Rules = ruleStates(i, docsAll, today); o.Check = inspItems(i);
    return o;
  });
  const docs = docsAll.filter(d => ids[d.ItemID]).map(d => ({ DocID: d.DocID, ItemID: d.ItemID, DocType: d.DocType, Number: user.role === 'Viewer' ? '' : d.Number, Expiry: d.Expiry, FileName: d.FileName, UploadedBy: d.UploadedBy, UploadedAt: d.UploadedAt, Verified: d.Verified, VerifiedBy: d.VerifiedBy, Note: d.Note }));
  const stickers = readAll('Stickers', ST_H).filter(s => ids[s.ItemID]).map(s => ({ StickerNo: s.StickerNo, ItemID: s.ItemID, Token: user.role === 'HSSE' ? s.Token : '', IssuedAt: s.IssuedAt, Status: s.Status, PrintCount: Number(s.PrintCount) || 0, ReprintAllowed: isTrue(s.ReprintAllowed), PrintedAt: s.PrintedAt, PrintedBy: s.PrintedBy }));
  return { ok: true, user: user, items: outItems, docs: docs, stickers: stickers };
}

// ---------- items ----------
function nextId(cat) {
  const p = cat === 'Vehicle' ? 'EVR-V-' : 'EVR-E-', all = readAll('Equipment', EQ_H);
  let max = 0;
  all.forEach(i => { if (i.ID.indexOf(p) === 0) max = Math.max(max, Number(i.ID.slice(p.length)) || 0); });
  return p + ('000' + (max + 1)).slice(-3);
}

function saveItem(user, item) {
  if (user.role === 'Viewer') throw new Error('View-only account');
  if (['Vehicle', 'Heavy Equipment'].indexOf(item.Category) < 0) throw new Error('Choose a category');
  if (!item.Type) throw new Error('Choose a type');
  const plate = String(item.PlateSerial || '').trim().toUpperCase();
  if (!plate) throw new Error('Plate / serial number is required');
  const dup = readAll('Equipment', EQ_H).filter(x => x.PlateSerial === plate && x.ID !== item.ID && x.Status !== 'Void')[0];
  if (dup) throw new Error('Already registered as ' + dup.ID);
  const now = iso(), F = ['Category', 'Type', 'MakeModel', 'OperatorName', 'OperatorLicenceClass', 'Remarks'];
  if (item.ID) {
    const cur = getItem(item.ID);
    if (!canWork(user, cur)) throw new Error('Not allowed');
    if (cur.Status === 'Approved' && (cur.Category !== item.Category || cur.Type !== item.Type || cur.PlateSerial !== plate)) throw new Error('Void the inspection first to change category, type or plate');
    if (user.role === 'IC' && ['Draft', 'Rejected', 'Void'].indexOf(cur.Status) < 0 && (cur.Category !== item.Category || cur.Type !== item.Type)) throw new Error('Entry is locked while with HSSE');
    F.forEach(f => cur[f] = item[f] || '');
    cur.PlateSerial = plate; cur.UpdatedAt = now;
    if (user.role === 'HSSE') { cur.Company = item.Company || cur.Company; cur.LocationStatus = item.LocationStatus || cur.LocationStatus; }
    writeRow('Equipment', EQ_H, cur);
    audit(user, 'saveItem', cur.ID, '');
    return { ok: true, id: cur.ID };
  }
  const o = { Status: 'Draft', LocationStatus: 'Off-site', PlateSerial: plate, UpdatedAt: now };
  F.forEach(f => o[f] = item[f] || '');
  o.Company = user.role === 'IC' ? user.company : (item.Company || '');
  if (!o.Company) throw new Error('Company is required');
  o.ID = nextId(o.Category);
  addRow('Equipment', EQ_H, o);
  audit(user, 'create', o.ID, plate);
  return { ok: true, id: o.ID };
}

function submitItem(user, id) {
  const it = getItem(id);
  if (!canWork(user, it)) throw new Error('Not allowed');
  if (['Draft', 'Rejected', 'Void'].indexOf(it.Status) < 0) throw new Error('Already submitted');
  const docs = readAll('Documents', DOC_H).filter(d => isTrue(d.Current));
  const miss = ruleStates(it, docs, todayStr()).filter(r => r.s === 'missing').map(r => DOCL[r.k] || r.k);
  if (miss.length) throw new Error('Upload all required documents first. Missing: ' + miss.join(', '));
  it.Status = 'Submitted'; it.SubmittedBy = user.email; it.SubmittedAt = iso(); it.DecisionNote = ''; it.UpdatedAt = iso();
  writeRow('Equipment', EQ_H, it);
  audit(user, 'submit', id, '');
  return { ok: true };
}

// ---------- documents ----------
function subFolder(parent, name) {
  const f = parent.getFoldersByName(name);
  return f.hasNext() ? f.next() : parent.createFolder(name);
}
// Drive layout: root / <Company> / <Light vehicles|Heavy equipment> / <ItemID>
function itemFolder(itemId, company, category) {
  const root = DriveApp.getFolderById(DOC_FOLDER_ID);
  const co = subFolder(root, String(company || 'Other').replace(/[\\\/]/g, '-'));
  return subFolder(subFolder(co, category === 'Vehicle' ? 'Light vehicles' : 'Heavy equipment'), itemId);
}

function uploadDoc(user, p) {
  const it = getItem(p.itemId);
  if (!canWork(user, it)) throw new Error('Not allowed');
  const rule = docRules(it).filter(r => r.k === p.docType)[0];
  if (!rule) throw new Error('This document is not required for this entry');
  if (rule.num && !String(p.number || '').trim()) throw new Error('Document number is required');
  if (p.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(p.expiry)) throw new Error('Invalid expiry date');
  if (rule.exp === 1 && !p.expiry) throw new Error('Expiry date is required');
  if (p.expiry && p.expiry < todayStr()) throw new Error('This document is already expired');
  if (MIMES.indexOf(p.mime) < 0) throw new Error('Only PDF, JPG or PNG files');
  const bytes = Utilities.base64Decode(p.b64 || '');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('File must be under 4 MB');
  const safe = String(p.fileName || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 60);
  const docId = 'D-' + Utilities.getUuid().slice(0, 8), now = iso();
  const file = itemFolder(it.ID, it.Company, it.Category).createFile(Utilities.newBlob(bytes, p.mime, it.ID + '_' + p.docType + '_' + docId + '_' + safe));
  if (p.docType !== 'photo') { // older rows that were never verified are replaced; a verified one stays until the new one is verified
    readAll('Documents', DOC_H).forEach(d => {
      if (d.ItemID === it.ID && d.DocType === p.docType && isTrue(d.Current) && d.Verified !== 'Yes') { d.Current = 'FALSE'; writeRow('Documents', DOC_H, d); }
    });
  }
  addRow('Documents', DOC_H, { DocID: docId, ItemID: it.ID, DocType: p.docType, Number: String(p.number || '').trim(), Expiry: p.expiry || '', FileName: safe, FileId: file.getId(), UploadedBy: user.email, UploadedAt: now, Verified: '', Note: p.note || '', Current: 'TRUE' });
  audit(user, 'upload', it.ID, p.docType + ' ' + docId);
  return { ok: true, docId: docId };
}

function getFile(user, docId) {
  const d = readAll('Documents', DOC_H).filter(x => x.DocID === docId)[0];
  if (!d) throw new Error('Document not found');
  const it = getItem(d.ItemID);
  if (!canWork(user, it)) throw new Error('Not allowed');
  const blob = DriveApp.getFileById(d.FileId).getBlob();
  audit(user, 'viewDoc', it.ID, docId);
  return { ok: true, name: d.FileName, mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
}

function verifyDoc(user, docId, result, note) {
  needHSSE(user);
  if (['Yes', 'No'].indexOf(result) < 0) throw new Error('Invalid result');
  const d = readAll('Documents', DOC_H).filter(x => x.DocID === docId)[0];
  if (!d) throw new Error('Document not found');
  if (result === 'No' && !String(note || '').trim()) throw new Error('Give a reason for rejecting the document');
  if (d.UploadedBy === user.email) throw new Error('A different HSSE user must verify a document you uploaded');
  d.Verified = result; d.VerifiedBy = user.email; d.VerifiedAt = iso(); d.Note = note || d.Note;
  writeRow('Documents', DOC_H, d);
  if (result === 'Yes' && d.DocType !== 'photo') {
    readAll('Documents', DOC_H).forEach(o => {
      if (o.ItemID === d.ItemID && o.DocType === d.DocType && o.DocID !== d.DocID && isTrue(o.Current)) { o.Current = 'FALSE'; writeRow('Documents', DOC_H, o); }
    });
  }
  audit(user, 'verifyDoc', d.ItemID, d.DocType + ' ' + result);
  return { ok: true };
}

// ---------- inspection, approval, sticker ----------
function approve(user, id, checklist, notes) {
  needHSSE(user);
  const it = getItem(id), today = todayStr();
  if (['Submitted', 'Approved'].indexOf(it.Status) < 0) throw new Error('Entry is not submitted for inspection');
  if (it.Status === 'Submitted' && it.SubmittedBy === user.email) throw new Error('A different HSSE user must approve an entry you submitted');
  const docs = readAll('Documents', DOC_H).filter(d => isTrue(d.Current));
  const rs = ruleStates(it, docs, today), bad = rs.filter(r => r.s !== 'ok');
  if (bad.length) throw new Error('Cannot approve. ' + bad.map(r => (DOCL[r.k] || r.k) + ' (' + r.s + ')').join(', '));
  const need = inspItems(it), failed = need.filter(k => !checklist || checklist[k] !== true);
  if (failed.length) throw new Error('Physical inspection incomplete: ' + failed.length + ' checklist item(s) not passed');
  let minExp = plusDays(REINSPECT_DAYS);
  rs.forEach(r => { const d = docs.filter(x => x.DocID === r.docId)[0]; if (d && d.Expiry && d.Expiry < minExp) minExp = d.Expiry; });
  const kind = it.Status === 'Submitted' ? 'Initial' : 'Re-inspection';
  addRow('Inspections', IN_H, { InspID: 'I-' + Utilities.getUuid().slice(0, 8), ItemID: id, Date: iso(), Inspector: user.email, Kind: kind, Result: 'Pass', Checklist: JSON.stringify(checklist), Notes: notes || '' });
  it.Status = 'Approved'; it.NextInspection = minExp; it.DecidedBy = user.email; it.DecidedAt = iso(); it.DecisionNote = notes || ''; it.UpdatedAt = iso();
  writeRow('Equipment', EQ_H, it);
  const sts = readAll('Stickers', ST_H), active = sts.filter(s => s.ItemID === id && s.Status === 'Active')[0];
  let stickerNo = active ? active.StickerNo : '', created = false;
  if (!active) {
    const yr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
    stickerNo = 'EVR-S-' + yr + '-' + ('0000' + (sts.length + 1)).slice(-4);
    addRow('Stickers', ST_H, { StickerNo: stickerNo, ItemID: id, Token: Utilities.getUuid().replace(/-/g, '').slice(0, 16), IssuedAt: today, IssuedBy: user.email, Status: 'Active', PrintCount: 0, ReprintAllowed: 'FALSE' });
    created = true;
  }
  audit(user, 'approve', id, kind + ' ' + stickerNo + (created ? ' issued' : ''));
  return { ok: true, stickerNo: stickerNo, created: created, nextInspection: minExp };
}

function reject(user, id, note) {
  needHSSE(user);
  const it = getItem(id);
  if (it.Status !== 'Submitted') throw new Error('Entry is not awaiting inspection');
  if (!String(note || '').trim()) throw new Error('Give the reason for rejecting');
  it.Status = 'Rejected'; it.DecisionNote = note; it.DecidedBy = user.email; it.DecidedAt = iso(); it.UpdatedAt = iso();
  writeRow('Equipment', EQ_H, it);
  audit(user, 'reject', id, note);
  return { ok: true };
}

function voidItem(user, id, reason) {
  needHSSE(user);
  if (!String(reason || '').trim()) throw new Error('Give the reason (damage or defect found)');
  const it = getItem(id);
  if (it.Status !== 'Approved') throw new Error('Only an approved entry can be voided');
  it.Status = 'Void'; it.DecisionNote = reason; it.DecidedBy = user.email; it.DecidedAt = iso(); it.UpdatedAt = iso();
  writeRow('Equipment', EQ_H, it);
  readAll('Stickers', ST_H).forEach(s => {
    if (s.ItemID === id && s.Status === 'Active') { s.Status = 'Void'; s.VoidReason = reason; s.VoidedBy = user.email; s.VoidedAt = iso(); writeRow('Stickers', ST_H, s); }
  });
  audit(user, 'void', id, reason);
  return { ok: true };
}

function activeSticker(id) {
  const s = readAll('Stickers', ST_H).filter(x => x.ItemID === id && x.Status === 'Active')[0];
  if (!s) throw new Error('No active sticker for this entry');
  return s;
}

function printSticker(user, id) {
  needHSSE(user);
  const it = getItem(id), s = activeSticker(id);
  if (it.Status !== 'Approved') throw new Error('Entry is not approved');
  const printed = Number(s.PrintCount) || 0;
  if (printed > 0 && !isTrue(s.ReprintAllowed)) throw new Error('This sticker was already printed. Authorise a reprint with a reason first.');
  s.PrintCount = printed + 1; s.PrintedAt = iso(); s.PrintedBy = user.email; s.ReprintAllowed = 'FALSE';
  writeRow('Stickers', ST_H, s);
  audit(user, 'print', id, s.StickerNo + ' #' + s.PrintCount);
  return { ok: true, sticker: { StickerNo: s.StickerNo, Token: s.Token, IssuedAt: s.IssuedAt }, item: strip(it) };
}

function allowReprint(user, id, reason) {
  needHSSE(user);
  if (!String(reason || '').trim()) throw new Error('Give the reason for the reprint (lost, damaged, misprint)');
  const s = activeSticker(id);
  if (!(Number(s.PrintCount) > 0)) throw new Error('Not printed yet');
  s.ReprintAllowed = 'TRUE'; s.ReprintReason = reason;
  writeRow('Stickers', ST_H, s);
  audit(user, 'allowReprint', id, reason);
  return { ok: true };
}

// ---------- public QR verification (no sign-in; limited, non-personal data) ----------
function verifyPublic(id, tok) {
  if (!id || !tok) throw new Error('Invalid QR code');
  const it = readAll('Equipment', EQ_H).filter(x => x.ID === id)[0];
  const st = readAll('Stickers', ST_H).filter(s => s.ItemID === id && s.Token === tok)[0];
  if (!it || !st) throw new Error('Invalid QR code');
  const today = todayStr(), docs = readAll('Documents', DOC_H).filter(d => isTrue(d.Current));
  let f = fitness(it, docs, today);
  if (st.Status !== 'Active') f = { state: 'VOID', why: [st.Status === 'Void' ? (st.VoidReason || 'Sticker void') : 'Superseded sticker'] };
  const rs = ruleStates(it, docs, today).map(r => ({ k: r.k, s: r.s }));
  return { ok: true, v: { ID: it.ID, Category: it.Category, Type: it.Type, MakeModel: it.MakeModel, PlateSerial: it.PlateSerial, Company: it.Company, StickerNo: st.StickerNo, IssuedAt: st.IssuedAt, NextInspection: it.NextInspection, Fit: f.state, Why: f.why, Docs: rs } };
}

// ---------- contacts (who receives reminders) ----------
function listContacts(user) {
  needHSSE(user);
  return { ok: true, contacts: readAll('Contacts', CT_H).filter(c => isTrue(c.Active)).map(strip) };
}
function saveContact(user, c) {
  needHSSE(user);
  const email = String(c.Email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address');
  if (CT_ROLES.indexOf(c.Role) < 0) throw new Error('Choose Logistics, HR or HSSE');
  if (!String(c.Company || '').trim()) throw new Error('Company is required');
  const all = readAll('Contacts', CT_H);
  if (c.ContactID) {
    const cur = all.filter(x => x.ContactID === c.ContactID)[0];
    if (!cur) throw new Error('Contact not found');
    cur.Company = c.Company; cur.Role = c.Role; cur.Name = c.Name || ''; cur.Email = email;
    writeRow('Contacts', CT_H, cur);
  } else {
    if (all.filter(x => isTrue(x.Active) && x.Email === email && x.Company === c.Company && x.Role === c.Role)[0]) throw new Error('This contact already exists');
    addRow('Contacts', CT_H, { ContactID: 'C-' + Utilities.getUuid().slice(0, 6), Company: c.Company, Role: c.Role, Name: c.Name || '', Email: email, Active: 'TRUE' });
  }
  audit(user, 'saveContact', '', c.Company + ' ' + c.Role + ' ' + email);
  return { ok: true };
}
function removeContact(user, id) {
  needHSSE(user);
  const cur = readAll('Contacts', CT_H).filter(x => x.ContactID === id)[0];
  if (!cur) throw new Error('Contact not found');
  cur.Active = 'FALSE'; writeRow('Contacts', CT_H, cur);
  audit(user, 'removeContact', '', cur.Company + ' ' + cur.Email);
  return { ok: true };
}

// ---------- reminders: run daily by a trigger (run installTrigger() once) ----------
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(7).create();
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }

// Returns the key suffix when a reminder is due today, else ''.
function reminderStage(days) {
  if (days < 0) return 'X' + Math.floor(-days / 7); // expired: repeats every 7 days
  const t = REMIND_AT.filter(x => x >= days).sort((a, b) => a - b)[0];
  return t === undefined ? '' : 'T' + t;
}

function sendReminders() {
  const today = todayStr();
  const items = readAll('Equipment', EQ_H).filter(i => i.Status === 'Approved');
  const docs = readAll('Documents', DOC_H).filter(d => isTrue(d.Current));
  const contacts = readAll('Contacts', CT_H).filter(c => isTrue(c.Active));
  const sent = {}; readAll('ReminderLog', RL_H).forEach(r => sent[r.Key] = 1);
  const byCo = {};
  items.forEach(i => {
    const entries = [];
    ruleStates(i, docs, today).forEach(r => {
      const d = docs.filter(x => x.DocID === r.docId)[0];
      if (d && d.Expiry) entries.push({ what: DOCL[r.k] || r.k, date: d.Expiry, base: i.ID + '|' + r.k + '|' + d.Expiry });
    });
    if (i.NextInspection) entries.push({ what: 'EcoOils approval / re-inspection', date: i.NextInspection, base: i.ID + '|APPROVAL|' + i.NextInspection });
    entries.forEach(e => {
      const days = daysBetween(today, e.date), stage = reminderStage(days);
      if (!stage) return;
      const key = e.base + '|' + stage;
      if (sent[key]) return;
      (byCo[i.Company] = byCo[i.Company] || []).push({ item: i, what: e.what, date: e.date, days: days, key: key });
    });
  });
  const hsse = contacts.filter(c => c.Company === 'EcoOils').map(c => c.Email);
  let mails = 0;
  Object.keys(byCo).forEach(co => {
    const to = contacts.filter(c => c.Company === co).map(c => c.Email);
    const rec = to.concat(hsse).filter((e, i, a) => a.indexOf(e) === i);
    if (!rec.length) return; // nobody to tell: do not log, so it is retried once contacts exist
    const lines = byCo[co].sort((a, b) => a.days - b.days).map(x =>
      '- ' + x.item.ID + ' | ' + x.item.PlateSerial + ' (' + x.item.Type + ') | ' + x.what + ' | ' + x.date + ' | ' + (x.days < 0 ? 'EXPIRED ' + (-x.days) + ' day(s) ago' : x.days === 0 ? 'expires TODAY' : 'expires in ' + x.days + ' day(s)'));
    const body = 'Equipment & Vehicle Register reminder for ' + co + '.\n\n' + lines.join('\n') +
      '\n\nExpired items are suspended at the gate (the sticker QR will show SUSPENDED). Please upload the renewed document in the register, or request re-inspection for the approval, so HSSE can verify it.' +
      (to.length ? '' : '\n\n(No contacts are registered for ' + co + ' yet: add them in the Contacts tab.)');
    MailApp.sendEmail(rec.join(','), '[EVR] ' + byCo[co].length + ' expiry reminder(s) - ' + co, body);
    mails++;
  });
  // log only the keys of companies that actually had a recipient
  Object.keys(byCo).forEach(co => {
    const has = contacts.some(c => c.Company === co) || hsse.length;
    if (has) byCo[co].forEach(x => addRow('ReminderLog', RL_H, { Key: x.key, SentAt: iso() }));
  });
  return mails;
}
