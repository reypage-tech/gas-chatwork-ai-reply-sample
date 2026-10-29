/** 設定。秘密の値はコードに書かず、スクリプトプロパティに置く：
 *  CHATWORK_WEBHOOK_TOKEN - Webhook の編集画面に出るトークン（署名の確かめに使う）
 *  CHATWORK_MY_ACCOUNT_ID - 返信するアカウントのID（空なら何も処理しない）
 *  CHATWORK_TOKEN         - 返信に使う Chatwork の APIトークン
 *  AI_API_KEY             - 生成AIのAPIキー（この見本は Anthropic の Messages API） */
var CONFIG = {
  signatureParam: 'chatwork_webhook_signature',
  queueSheet: '受信キュー', sheetName: 'やりとり', errorSheet: 'エラー記録',
  batchSize: 5,                       // 1回のトリガーで処理する件数
  apiUrl: 'https://api.anthropic.com/v1/messages',
  apiVersion: '2023-06-01',
  model: 'claude-haiku-4-5-20251001', // 案件の仕様に合わせて替える
  maxTokens: 400,
  maxInputChars: 4000,                // 長い文は送る前に切る
  prompt: '次のチャットの依頼文に対する、ていねいで短い返事の案を日本語で書いてください。返事の案だけを返してください。',
  chatworkUrl: 'https://api.chatwork.com/v2/rooms/{room}/messages',
  fallbackReply: '受け付けました。内容を確かめて、あとでお返事します。',
  timeZone: 'Asia/Tokyo'
};
