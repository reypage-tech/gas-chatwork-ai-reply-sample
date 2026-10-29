/** Google のサービスを使わない処理（テストの対象）。 */
/** Chatwork の Webhook を読む。ほかのイベントは []。 */
function extractChatwork_(json) {
  var ev = json && json.webhook_event; if (!ev || !ev.body) return [];
  var type = json.webhook_event_type;
  if (type !== 'message_created' && type !== 'mention_to_me') return [];
  return [{ type: type, id: String(ev.message_id), room: String(ev.room_id), from: String(ev.account_id || ev.from_account_id || ''),
            to: ev.to_account_id === undefined ? '' : String(ev.to_account_id), text: String(ev.body) }];
}
/** 自分あての文だけを処理する。mention_to_me は宛先が自分のとき、message_created は本文に [To:自分のID] があるとき。
 *  自分のIDが空なら何も処理しない。自分が送った文も処理しない。 */
function isForMe_(msg, myId) {
  if (!myId) return false;
  myId = String(myId);
  if (msg.from === myId) return false;
  if (msg.type === 'mention_to_me') return msg.to === myId;
  if (msg.type === 'message_created') return msg.text.indexOf('[To:' + myId + ']') >= 0;
  return false;
}
/** 署名を比べる（長さと全文字を比べ、途中で抜けない）。 */
function sameSignature_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** [To:123] や [info] などの Chatwork の記号を、生成AIに渡す前に取り除く。 */
function cleanText_(text) {
  return String(text).replace(/\[(To:\d+|rp aid=[^\]]*)\]([^\n\[]*?さん(?=\s|\[|$))?/g, ' ')  // [To:123] と「〇〇さん」の宛名を外す
    .replace(/\[\/?[a-zA-Z]+(?::[^\]]*)?\]/g, ' ')                  // [info] などの記号
    .replace(/\s+/g, ' ').trim();
}
/** Messages API に送る中身を作る。 */
function buildRequest_(text, cfg) {
  var t = text.length > cfg.maxInputChars ? text.slice(0, cfg.maxInputChars) : text;
  return { model: cfg.model, max_tokens: cfg.maxTokens, messages: [{ role: 'user', content: cfg.prompt + '\n\n' + t }] };
}
/** Messages API の返事から、文とトークン数を取り出す。 */
function parseResponse_(code, body) {
  var j; try { j = JSON.parse(body); } catch (e) { return { ok: false, error: 'HTTP ' + code + '（JSONではない）' }; }
  if (code !== 200) return { ok: false, error: 'HTTP ' + code + ': ' + ((j.error && j.error.message) || 'error') };
  var s = (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('').trim();
  if (!s) return { ok: false, error: '返事の案が空' };
  return { ok: true, text: s, model: j.model, inTok: (j.usage || {}).input_tokens, outTok: (j.usage || {}).output_tokens };
}
/** Chatwork に返す本文。元の送り主に [rp] で返信の形にする。 */
function buildReply_(msg, text) { return '[rp aid=' + msg.from + ' to=' + msg.room + '-' + msg.id + ']\n' + text; }
/** 数式として読まれないようにする */
function safeCell_(v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; }
