# 一門サイト Ver.1

信長の野望・真戦 一門専用ポータルの初期版。
Cloudflare Pages + Workers + D1 を想定。

## 構成
- public/ : フロントエンド
- src/worker.js : API + 静的ファイル配信
- schema.sql : D1 テーブル
- wrangler.toml : Cloudflare 設定

## 重要
この初期版は「実装の土台」です。
本番公開前に、Cloudflare側でD1を作成し、DBを初期化してください。

## ローカル
Cloudflare Wrangler を使える環境なら:
  npm install -g wrangler
  wrangler login
  wrangler d1 create ichimon-db
  # 出力された database_id を wrangler.toml に入れる
  wrangler d1 execute ichimon-db --remote --file=schema.sql
  wrangler deploy

DBを初期化した後、サイトの「新規登録」から一門員を登録できます。

## 管理者
最初の管理者はDBで role='admin' に変更します。
例:
UPDATE members SET role='admin' WHERE game_name='あなたのゲーム名';

## SESSION_SECRET
本番公開前に、Cloudflare Workers Secret として SESSION_SECRET を登録してください。
十分長いランダム文字列を使います。コードには書きません。


### 注意（Ver.2）
- D1 binding は `DB`、Assets binding は `ASSETS` を使用します。
- `wrangler.toml` の `database_id` は実際の D1 Database ID に置き換えてください。
- Worker Secret `SESSION_SECRET` を設定してください。
- 部隊登録は Lv1〜50 と兵種（馬・弓・槍・鉄砲）のみです。
