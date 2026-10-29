// Mock environment: replaces Google services with simple Node.js fakes (never runs inside Apps Script).
// Usage: const m = require("./mock_gas.js"); const w = m.world(opts); const ctx = m.load(srcDir, files, w);
var fs = require('fs'), path = require('path'), vm = require('vm');

function makeSheet(name, rows) {
  var data = (rows || []).map(function (r) { return r.slice(); });
  var sh = {
    __rows: function () { return data; },
    getName: function () { return name; },
    getLastRow: function () { return data.length; },
    getLastColumn: function () { return data.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
    appendRow: function (r) { data.push(r.slice()); return sh; },
    clearContents: function () { data = []; return sh; },
    getDataRange: function () { return sh.getRange(1, 1, Math.max(data.length, 1), Math.max(sh.getLastColumn(), 1)); },
    getRange: function (r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) { var v = (data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); }
          return out;
        },
        setValues: function (vals) {
          vals.forEach(function (vr, i) { var t = data[r - 1 + i] || (data[r - 1 + i] = []); vr.forEach(function (v, j) { t[c - 1 + j] = v; }); });
          for (var k = 0; k < data.length; k++) if (!data[k]) data[k] = [];
          return this;
        },
        setValue: function (v) { return this.setValues([[v]]); }
      };
    }
  };
  return sh;
}

function world(opts) {
  opts = opts || {};
  var w = { sheets: {}, mails: opts.mails || [], sent: [], drafts: [], files: [], docs: {}, fetches: [], triggers: [], props: Object.assign({}, opts.props || {}), nowMs: opts.nowMs || Date.UTC(2026, 9, 1, 1, 0, 0) };
  Object.keys(opts.sheets || {}).forEach(function (n) { w.sheets[n] = makeSheet(n, opts.sheets[n]); });
  var ss = {
    getSheetByName: function (n) { return w.sheets[n] || null; },
    insertSheet: function (n) { return (w.sheets[n] = makeSheet(n, [])); },
    getSpreadsheetTimeZone: function () { return 'Asia/Tokyo'; }
  };
  var folder = { createFile: function (blob) { var f = { name: blob.getName(), blob: blob, getId: function () { return 'file' + w.files.length; }, getUrl: function () { return 'https://drive.example/' + f.name; }, getName: function () { return f.name; } }; w.files.push(f); return f; } };
  function blob(content, type, name) {
    return { content: content, type: type, name: name, getName: function () { return this.name; }, setName: function (n) { this.name = n; return this; }, getDataAsString: function () { return String(this.content); }, getAs: function (t) { return blob(this.content, t, this.name); } };
  }
  w.globals = {
    console: console, JSON: JSON, Math: Math, Date: Date,
    SpreadsheetApp: { getActive: function () { return ss; }, getActiveSpreadsheet: function () { return ss; }, openById: function () { return ss; }, flush: function () {} },
    GmailApp: {
      search: function (q) { return w.mails.map(function (m) { return { getMessages: function () { return [m]; } }; }); },
      createDraft: function (to, subject, body, o) { w.drafts.push({ to: to, subject: subject, body: body, options: o }); }
    },
    MailApp: { sendEmail: function (m) { w.sent.push(m); } },
    DriveApp: {
      getFolderById: function () { return folder; },
      getFileById: function (id) { return { makeCopy: function (name) { var did = 'doc' + Object.keys(w.docs).length; w.docs[did] = { name: name, text: opts.templateText || '' }; return { getId: function () { return did; }, getUrl: function () { return 'https://docs.example/' + did; } }; } }; }
    },
    DocumentApp: {
      openById: function (id) { var d = w.docs[id]; return { getBody: function () { return { replaceText: function (pat, val) { d.text = d.text.split(pat.replace(/\\/g, '')).join(val); }, getText: function () { return d.text; } }; }, saveAndClose: function () {} }; }
    },
    UrlFetchApp: {
      fetch: function (url, o) { w.fetches.push({ url: url, options: o }); var r = (opts.http || {})[url]; if (typeof r === 'function') r = r(url, o); r = r || { code: 404, body: '' }; return { getResponseCode: function () { return r.code; }, getContentText: function () { return r.body; } }; }
    },
    Utilities: {
      newBlob: function (c, t, n) { var b = blob(c, t, n); b.getBytes = function () { return Array.from(Buffer.from(String(c), 'utf8')).map(function (x) { return x > 127 ? x - 256 : x; }); }; return b; },
      base64Decode: function (s) { return Array.from(Buffer.from(s, 'base64')).map(function (x) { return x > 127 ? x - 256 : x; }); },
      base64Encode: function (a) { return Buffer.from(a.map(function (x) { return x & 255; })).toString('base64'); },
      computeHmacSha256Signature: function (v, k) { var h = require('crypto').createHmac('sha256', Buffer.from(k.map(function (x) { return x & 255; }))); h.update(Buffer.from(v.map(function (x) { return x & 255; }))); return Array.from(h.digest()).map(function (x) { return x > 127 ? x - 256 : x; }); },
      formatDate: function (d, tz, fmt) {
        var p = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour === '24' ? '00' : p.hour).replace('mm', p.minute);
      },
      sleep: function () {}
    },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return w.props[k] === undefined ? null : w.props[k]; }, setProperty: function (k, v) { w.props[k] = String(v); } }; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, tryLock: function () { return true; }, releaseLock: function () {} }; } },
    ContentService: { createTextOutput: function (t) { return { text: t, setMimeType: function () { return this; } }; }, MimeType: { JSON: 'json' } },
    ScriptApp: { getProjectTriggers: function () { return w.triggers.map(function (t) { return { getHandlerFunction: function () { return t.fn; } }; }); }, deleteTrigger: function () { w.triggers.shift(); },
      newTrigger: function (fn) { var t = { fn: fn }; var b = { timeBased: function () { return b; }, everyMinutes: function (n) { t.minutes = n; return b; }, create: function () { w.triggers.push(t); return t; } }; return b; } },
    Buffer: Buffer,
    Session: { getScriptTimeZone: function () { return 'Asia/Tokyo'; } }
  };
  w.newMail = function (id, subject, body, from) { return { getId: function () { return id; }, getSubject: function () { return subject; }, getPlainBody: function () { return body; }, getFrom: function () { return from || 'sender@example.com'; }, getDate: function () { return new Date(w.nowMs); }, getAttachments: function () { return []; } }; };
  return w;
}

function load(srcDir, files, w) {
  var ctx = vm.createContext(w.globals);
  files.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f }); });
  return ctx;
}

function runner() {
  var n = 0, ng = 0;
  return {
    ok: function (name, cond, detail) { n++; if (!cond) ng++; console.log((cond ? '[OK] ' : '[NG] ') + name + (detail ? ' - ' + detail : '')); },
    done: function () { console.log(''); console.log((n - ng) + ' OK / ' + ng + ' NG (total ' + n + ')'); if (ng) process.exit(1); }
  };
}
function dump(w) {
  if (!process.env.DUMP) return;
  var out = { sheets: {}, files: w.files.map(function (f) { return f.name; }), drafts: w.drafts.length, sent: w.sent.length };
  Object.keys(w.sheets).forEach(function (n) { out.sheets[n] = w.sheets[n].__rows(); });
  require('fs').writeFileSync(process.env.DUMP, JSON.stringify(out));
}
module.exports = { dump: dump, world: world, load: load, makeSheet: makeSheet, runner: runner };
