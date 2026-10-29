// node test/run.js : 模擬環境で確かめる（Google のサービス、生成AIのAPI、Chatwork のAPIはすべて偽物。データは架空。ネットにはつながない）
var m = require('./mock_gas.js'), path = require('path'), crypto = require('crypto');
var SRC = path.join(__dirname, '..', 'src'), FILES = ['Config.gs', 'Lib.gs', 'Main.gs'];
var AI = 'https://api.anthropic.com/v1/messages', CW = 'https://api.chatwork.com/v2/rooms/111/messages';
var WH_TOKEN = Buffer.from('fictional-webhook-token-for-tests').toString('base64'), ME = '999';
var ai = [], cwPosts = [];
function fakeAi(url, o) {
  ai.push(o); var body = JSON.parse(o.payload), txt = body.messages[0].content;
  if (/FAIL/.test(txt)) return { code: 529, body: JSON.stringify({ type: 'error', error: { message: 'overloaded' } }) };
  return { code: 200, body: JSON.stringify({ model: body.model, content: [{ type: 'text', text: '（模擬の返事）承知しました。金曜の納品で進めます。' }], usage: { input_tokens: 60, output_tokens: 20 } }) };
}
function fakeCw(url, o) { cwPosts.push(o); return { code: 200, body: '{"message_id":"9"}' }; }
var http = {}; http[AI] = fakeAi; http[CW] = fakeCw;
var baseProps = { CHATWORK_WEBHOOK_TOKEN: WH_TOKEN, CHATWORK_MY_ACCOUNT_ID: ME, AI_API_KEY: 'test-key-not-real', CHATWORK_TOKEN: 'test-token-not-real' };
function env(props) { var w = m.world({ props: props, http: http }); return { w: w, c: m.load(SRC, FILES, w) }; }
function sign(raw, tok) { return crypto.createHmac('sha256', Buffer.from(tok || WH_TOKEN, 'base64')).update(raw, 'utf8').digest('base64'); }
function post(cx, p, sig) { var raw = JSON.stringify(p); return JSON.parse(cx.doPost({ parameter: { chatwork_webhook_signature: sig === undefined ? sign(raw) : sig }, postData: { contents: raw } }).text); }
var mention = function (id, body, from) { return { webhook_setting_id: '1', webhook_event_type: 'mention_to_me', webhook_event_time: 1790000000, webhook_event: { from_account_id: from || 222, to_account_id: Number(ME), room_id: 111, message_id: id, body: body, send_time: 1790000000, update_time: 0 } }; };
var created = function (id, body, from) { return { webhook_setting_id: '1', webhook_event_type: 'message_created', webhook_event_time: 1790000000, webhook_event: { account_id: from || 222, room_id: 111, message_id: id, body: body, send_time: 1790000000, update_time: 0 } }; };
var t = m.runner(), E = env(baseProps), w = E.w, c = E.c, sh = function (n) { return w.sheets[n].__rows(); };

// 署名
t.ok('署名のない Webhook ははじき、キューに何も入れない', post(c, mention('m0', '[To:999]こんにちは'), '').ok === false && !w.sheets['受信キュー']);
t.ok('署名が合わない Webhook ははじく', post(c, mention('m0', '[To:999]こんにちは'), sign('別の本文')).ok === false && !w.sheets['受信キュー']);
t.ok('別のトークンで作った署名ははじく', post(c, mention('m0', '[To:999]こんにちは'), sign(JSON.stringify(mention('m0', '[To:999]こんにちは')), Buffer.from('other').toString('base64'))).ok === false);
var raw0 = JSON.stringify(mention('m0', '[To:999]x'));
t.ok('署名は Chatwork の決まりどおり（Base64 デコードしたトークンで本文の HMAC-SHA256 を取り Base64）', c.verifySignature_(raw0, sign(raw0), WH_TOKEN) === true && c.verifySignature_(raw0 + ' ', sign(raw0), WH_TOKEN) === false);
// 受け口はキューに入れるだけ
var r = post(c, mention('m1', '[To:999]見本ボットさん\nサンプル商事の山田です。納品日を水曜から金曜に変えたいです。')).result;
t.ok('受け口は自分へのメンションをキューに入れるだけで、AIも返信も呼ばない', r.queued === 1 && sh('受信キュー')[1][5] === '未処理' && ai.length === 0 && cwPosts.length === 0);
t.ok('同じメッセージIDが2回届いても、キューには1回だけ入る', post(c, mention('m1', '[To:999]もう一度')).result.dup === 1 && sh('受信キュー').length === 2);
// どの文を処理するか
t.ok('message_created でも本文に [To:自分のID] があればキューに入る', post(c, created('m2', '[To:999]見本ボットさん\n見積りをお願いします')).result.queued === 1);
t.ok('message_created で自分あてでない文は入れない', post(c, created('m3', '[To:555]ほかの人さん\n資料を送ります')).result.skipped === 1 && sh('受信キュー').length === 3);
t.ok('ほかの人へのメンション（宛先が自分でない）は入れない', post(c, { webhook_event_type: 'mention_to_me', webhook_event: { from_account_id: 222, to_account_id: 555, room_id: 111, message_id: 'm4', body: '[To:555]x' } }).result.skipped === 1);
t.ok('自分が送った文は入れない', post(c, created('m5', '[To:999]承知しました', 999)).result.skipped === 1);
t.ok('ほかの種類のイベント（message_updated など）は入れない', post(c, { webhook_event_type: 'message_updated', webhook_event: { account_id: 222, room_id: 111, message_id: 'm6', body: '[To:999]x' } }).result.queued === 0 && sh('受信キュー').length === 3);
var N = env({ CHATWORK_WEBHOOK_TOKEN: WH_TOKEN, AI_API_KEY: 'k', CHATWORK_TOKEN: 't' });
t.ok('CHATWORK_MY_ACCOUNT_ID が空なら何も処理しない', post(N.c, mention('n1', '[To:999]x')).result.queued === 0 && N.w.sheets['受信キュー'].__rows().length === 1);
// トリガー側の処理
var p = c.processQueue(), row = sh('やりとり')[1];
t.ok('トリガーの処理で返事の案を作り、シートに記録し、キューを処理済みにする', p.done === 2 && /金曜の納品/.test(row[4]) && row[5] === 'AIの案・返信済み' && row[7] === '60/20' && sh('受信キュー')[1][5] === '処理済み');
t.ok('宛先の記号と宛名を、AIに渡す前に取り除く', row[3].indexOf('[To:') < 0 && row[3].indexOf('見本ボット') < 0 && JSON.parse(ai[0].payload).messages[0].content.indexOf('[To:') < 0);
t.ok('同じ部屋に、送った人への返信の形で投稿する', cwPosts.length === 2 && /^\[rp aid=222 to=111-m1\]/.test(cwPosts[0].payload.body));
t.ok('APIキーとトークンはスクリプトプロパティから読み、ヘッダーだけで送る', ai[0].headers['x-api-key'] === 'test-key-not-real' && ai[0].payload.indexOf('test-key-not-real') < 0 && cwPosts[0].headers['X-ChatWorkToken'] === 'test-token-not-real');
t.ok('処理済みの文は、次のトリガーでもう一度処理しない', c.processQueue().done === 0 && ai.length === 2);
post(c, mention('m7', '[To:999]FAIL 見積りをお願いします')); var p2 = c.processQueue();
t.ok('AIのAPIが失敗したら、エラー記録に残し、部屋には受付の文だけを返す', p2.errors === 1 && /529/.test(sh('エラー記録')[1][2]) && /受け付けました/.test(cwPosts[2].payload.body) && sh('受信キュー')[3][5] === 'エラー');
var K = env({ CHATWORK_WEBHOOK_TOKEN: WH_TOKEN, CHATWORK_MY_ACCOUNT_ID: ME }), a0 = ai.length, c0 = cwPosts.length;
post(K.c, mention('k1', '[To:999]こんにちは')); var p3 = K.c.processQueue();
t.ok('キーとトークンが未設定なら外へは何も送らず、理由を記録する', p3.errors === 1 && ai.length === a0 && cwPosts.length === c0 && /AI_API_KEY/.test(K.w.sheets['エラー記録'].__rows()[1][2]) && /CHATWORK_TOKEN/.test(K.w.sheets['エラー記録'].__rows()[2][2]));
var B = env(baseProps); for (var i = 0; i < 7; i++) post(B.c, mention('b' + i, '[To:999]件' + i));
t.ok('1回のトリガーで処理するのは batchSize 件まで', B.c.processQueue().done === 5 && B.c.processQueue().done === 2);
c.installTrigger(); c.installTrigger();
t.ok('installTrigger は processQueue の1分おきのトリガーを1つだけ作る', w.triggers.length === 1 && w.triggers[0].fn === 'processQueue' && w.triggers[0].minutes === 1);
t.ok('宛名のないメンション（公式の例の形）でも本文は残る', c.cleanText_('[To:1484814]おかずはなんですか？') === 'おかずはなんですか？');
t.ok('とても長い文は送る前に切る', c.buildRequest_('あ'.repeat(5000), c.CONFIG).messages[0].content.length < 4200);
post(c, mention('m8', '=HYPERLINK("x") [To:999]を確認してください')); c.processQueue();
t.ok('数式に見える値は文字として記録する', String(sh('受信キュー')[4][4]).charAt(0) === "'" && String(sh('やりとり')[4][3]).charAt(0) === "'");
m.dump(w); t.done();
