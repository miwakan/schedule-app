# 日程調整ツール

GitHub Pages の閲覧画面と Google Apps Script の入力・保存画面を組み合わせた日程調整ツールです。

## 構成

- `github/index.html` — 閲覧画面
- `github/style.css` — 既存デザイン（変更なし）
- `github/app.js` — イベント情報・CSVの取得、集計、描画
- `gas/Code.gs` — イベント作成、CSV配信、予定CRUD、AI変換
- `gas/Index.html` — 参加者の予定入力画面
- `gas/CreateEvent.html` — イベント作成・ロール設定画面
- `gas/appsscript.json` — GAS manifest

## 新しいイベントの流れ

1. GAS Webアプリを `?page=create` で開く。
2. イベント名、期間、対象時間帯、ロールを設定して作成する。
3. 表示された GitHub Pages のURLを開く。
4. 予定が0件でも日付軸・粒度切替・右端の `＋` が表示される。
5. `＋` からメンバーを追加し、予定を入力する。
6. GitHub Pages を再読み込みすると反映される。

## データ形式

イベントごとに専用スプレッドシートを1つ作成し、`data` シートへ以下の列で保存します。

`name,date,start,end,status,note,id,role`

イベント台帳はGASを紐づけた元スプレッドシートの `events` シートです。
