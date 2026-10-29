/** Webhook の受け口。署名を確かめ、自分あての文を「受信キュー」に入れるだけにして、すぐ返す。
 *  Chatwork は10秒以内の応答を求め、失敗しても再送しないため、時間のかかる処理（AIと返信）はトリガー側で行う。 */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var raw = (e && e.postData && e.postData.contents) || '';
  if (!verifySignature_(raw, (e.parameter || {})[CONFIG.signatureParam], props.getProperty('CHATWORK_WEBHOOK_TOKEN'))) return out_({ ok: false, reason: 'forbidden' });
  var me = props.getProperty('CHATWORK_MY_ACCOUNT_ID'), res = { queued: 0, skipped: 0, dup: 0 };
  var json; try { json = JSON.parse(raw); } catch (x) { return out_({ ok: false, reason: 'bad json' }); }
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var q = sheet_(SpreadsheetApp.getActive(), CONFIG.queueSheet, ['受信日時', 'メッセージID', '部屋', '送った人', '本文', '状態']);
    var seen = {}; q.getDataRange().getValues().forEach(function (r) { seen[r[1]] = true; });
    var now = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd HH:mm');
    extractChatwork_(json).forEach(function (msg) {
      if (!isForMe_(msg, me)) { res.skipped++; return; }
      if (seen[msg.id]) { res.dup++; return; }   // 同じメッセージは1回だけ（二重の課金を防ぐ）
      q.appendRow([now, msg.id, msg.room, msg.from, safeCell_(msg.text), '未処理']); seen[msg.id] = true; res.queued++;
    });
  } finally { lock.releaseLock(); }
  return out_({ ok: true, result: res });
}
/** Chatwork の決まりどおりに署名を確かめる：トークンを Base64 でデコードした値を鍵に、
 *  受け取った本文そのままの HMAC-SHA256 を取り、Base64 にしたものが chatwork_webhook_signature と一致するか。 */
function verifySignature_(raw, signature, token) {
  if (!token || !signature) return false;
  var mac = Utilities.computeHmacSha256Signature(Utilities.newBlob(raw).getBytes(), Utilities.base64Decode(token));
  return sameSignature_(Utilities.base64Encode(mac), signature);
}
/** 時間主導型のトリガーで呼ぶ。「未処理」の文に生成AIで返事の案を作り、Chatwork に返して記録する。 */
function processQueue() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(1000)) return { busy: true };
  try {
    var props = PropertiesService.getScriptProperties(), ss = SpreadsheetApp.getActive();
    var q = sheet_(ss, CONFIG.queueSheet, ['受信日時', 'メッセージID', '部屋', '送った人', '本文', '状態']);
    var log = sheet_(ss, CONFIG.sheetName, ['処理日時', '部屋', '送った人', '依頼文', '返事の案', '状態', 'モデル', 'トークン 入/出']);
    var err = sheet_(ss, CONFIG.errorSheet, ['処理日時', 'メッセージID', '理由', '依頼文']);
    var key = props.getProperty('AI_API_KEY'), token = props.getProperty('CHATWORK_TOKEN');
    var now = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd HH:mm'), res = { done: 0, errors: 0 };
    var rows = q.getDataRange().getValues(), n = 0;
    for (var i = 1; i < rows.length && n < CONFIG.batchSize; i++) {
      if (rows[i][5] !== '未処理') continue; n++;
      var msg = { id: String(rows[i][1]), room: String(rows[i][2]), from: String(rows[i][3]) };
      var text = cleanText_(String(rows[i][4]).replace(/^'/, ''));
      q.getRange(i + 1, 6).setValue('処理中');   // 失敗しても自動ではやり直さない
      var r = key ? draftReply_(text, key) : { ok: false, error: 'AI_API_KEY が未設定' };
      var replyText = r.ok ? r.text : CONFIG.fallbackReply;
      var sent = token ? postChatwork_(msg.room, buildReply_(msg, replyText), token) : { ok: false, error: 'CHATWORK_TOKEN が未設定' };
      var state = (r.ok ? 'AIの案' : '受付のみ') + (sent.ok ? '・返信済み' : '・未返信');
      log.appendRow([now, msg.room, msg.from, safeCell_(text), safeCell_(replyText), state, r.model || '', r.ok ? r.inTok + '/' + r.outTok : '']);
      if (!r.ok) err.appendRow([now, msg.id, r.error, safeCell_(text)]);
      if (!sent.ok) err.appendRow([now, msg.id, sent.error, safeCell_(text)]);
      q.getRange(i + 1, 6).setValue(r.ok && sent.ok ? '処理済み' : 'エラー');
      if (r.ok && sent.ok) res.done++; else res.errors++;
    }
    return res;
  } finally { lock.releaseLock(); }
}
/** 最初に1回だけ手で実行し、processQueue を1分おきに呼ぶトリガーを作る。 */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'processQueue') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(1).create();
}
/** 生成AIのAPIを呼ぶ。キーはスクリプトプロパティから渡されたものだけを使う。 */
function draftReply_(text, key) {
  var resp = UrlFetchApp.fetch(CONFIG.apiUrl, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': CONFIG.apiVersion },
    payload: JSON.stringify(buildRequest_(text, CONFIG))
  });
  return parseResponse_(resp.getResponseCode(), resp.getContentText());
}
/** Chatwork の部屋に投稿する。 */
function postChatwork_(room, body, token) {
  var resp = UrlFetchApp.fetch(CONFIG.chatworkUrl.replace('{room}', encodeURIComponent(room)), {
    method: 'post', muteHttpExceptions: true, headers: { 'X-ChatWorkToken': token }, payload: { body: body }
  });
  var code = resp.getResponseCode();
  return code === 200 ? { ok: true } : { ok: false, error: 'Chatwork HTTP ' + code };
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function sheet_(ss, name, header) { var s = ss.getSheetByName(name); if (!s) { s = ss.insertSheet(name); s.appendRow(header); } return s; }
