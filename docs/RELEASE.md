# GitHub `main` → Private Site リリース手順（KIF-003）

作成: 2026-11-15（Claude）。**正本はGitHub `main`**、実行先は本人限定のPrivate ChatGPT Site。GitHubへのマージではSiteは変わらない。Siteへの反映は、Sites権限を持つ側（現状はChatGPT）が以下の手順で**明示的に**行う。

この手順は公開範囲・課金・D1スキーマを変えない。変える必要が出たら中断し、ユーザーの承認を取る。

## 役割

| 役割 | 担当 | できること／できないこと |
| --- | --- | --- |
| 準備 | Claude（GitHub書込権限あり） | リリース候補SHAの選定、`release plan`と`manifest`の作成、台帳記録。**Sitesへの配備権限はない** |
| 配備 | ChatGPT（Sites権限あり） | 同期前の保全と`preflight`、差分ごとの判断の記録、Sitesソースへの反映、`verify`、ビルド、Privateのままデプロイ、アクセス設定の確認、ロールバック |
| 承認・確認 | ユーザー | `data`判定の承認、iPhone実機での動作確認、公開範囲の変更（通常は変更しない） |

## 0. 前提の確認

- リリース候補はGitHub `main`上のコミットで、そのコミットの`Source validation`（push run）が成功していること。
- 直前にSiteへ出したGitHub SHA（以下`<released>`）が分かっていること。分からない場合（初回）は §初回リリース を先に行う。
- 配備担当はSiteの現在のversion番号、`access_mode`、許可ユーザー数を控える（ロールバック先と事後確認のため）。

## 1. 変更内容の分類（準備担当）

```sh
git fetch origin main && git checkout <candidate-sha>
npm ci
npm run release:plan -- --base <released>
```

| 判定 | 意味 | 次の行動 |
| --- | --- | --- |
| `none` | 文書・テスト・CI・リポジトリ管理用スクリプトのみ（明示リストに載ったもの）。配信物は変わらない | 配備は任意 |
| `app` | 画面・将棋ロジック・教材の変更 | 通常リリース。§2へ |
| `runtime` | API・Worker・依存関係・ビルド設定・配信ファイルの削除・**どの規則にも当てはまらない未分類ファイル**・`package.json`のビルド／起動／インストール系スクリプトやnpmのライフサイクルフック（`preinstall`・`postinstall`・`prepare`等）の変更 | `npm run build`と`npm start`でビルド済みWorkerを確認してから§2へ |
| `data` | D1マイグレーション・スキーマ・`drizzle.config.ts`・hosting binding・認証・localStorageキーの変更 | **中断**（終了コード2）。§データ の条件をユーザーが承認するまで配備しない |

判定は**安全側**に倒す。分類規則に載っていない新しいファイルは`runtime`として確認対象にする。`package.json`は、依存関係・`engines`等が不変で、かつ変更されたスクリプトがすべて管理用（`lint`・`test`・`test:*`・`ledger:check`・`public:check`・`release:*`）の場合だけ`none`になる。

## 2. マニフェスト作成（準備担当）

候補SHAをクリーンにチェックアウトした状態で実行する。

```sh
npm run release:manifest -- --out outputs/release-<short-sha>.json
```

`outputs/`はGit管理外。マニフェストは追跡ファイル全件のSHA-256で、コミットSHAを含む。秘密情報は入らないが、Siteの実データも入らない。配備担当へはファイルを渡すか、同じコマンドを配備側で再実行してもらう（決定的なので同じ結果になる）。

## 3. Sitesソースへの反映（配備担当）— 同期の前に差分を確定する

**重要**: 同期（`rsync --delete`）を先に行うと、Siteにしかないファイルが消え、事後の照合では見つけられない。必ず次の順序で行う。各段階は独立して働き、どれか一つが失敗したら止まる。ClaudeはSiteにアクセスできないため、§3はSites権限を持つ配備担当（ChatGPT）が実行する。

1. **対象の特定**: 配備元（GitHubの候補SHAをクリーンにチェックアウトした`<github-checkout>`）、配備先（Sitesソースのチェックアウト`<sites-checkout>`）、対象SHA、現在のSite versionを`SESSION_LOG`に書く。
2. **保全（同期の前）**: Sitesソースを丸ごと退避し、その時点のハッシュを記録する。復旧の確認に使う。

```sh
tar czf outputs/site-backup-<date>.tgz -C <sites-checkout> --exclude node_modules .
node scripts/release.mjs snapshot --root <sites-checkout> --out outputs/site-before-<date>.json
```

   D1の本番データは、このリリースでは触れない（`data`判定なら§データ）。Siteのversion履歴でロールバックできることも確認しておく。

3. **差分の取得（読み取り専用）**: 同期は行わず、GitHubのマニフェストとSiteを比べる。

```sh
node scripts/release.mjs preflight outputs/release-<short-sha>.json --root <sites-checkout> --out outputs/preflight-<short-sha>.json
```

   出力は「追加（GitHubにだけある）」「上書き（内容が違う）」「削除（Siteにだけある）」の3種類。追加は既存のSiteの内容を失わないので判断不要。**上書きと削除は、1件ずつ人の判断が要る**。

4. **一覧の確認**: `preflight-*.json`の`decisionTemplate`に、判断が必要なファイルがハッシュ付きで並ぶ。初回リリースではGitHubとSiteに共通の基準がないため、**「GitHubが新しいはず」と決めつけない**。各ファイルについて、Site側の内容を読んで次のどちらかにする。
   - Site側の変更を残すべき → **同期を止め**、その変更をGitHubへPRで取り込む。マージ後の新しいSHAで§1からやり直す。
   - GitHub側で置き換えてよい → `decisions.json`にその1件を記録する（`path`、`action`（`overwrite`／`delete`）、`siteSha256`（一覧のまま）、`reason`、`decidedBy`）。

5. **停止条件**: 次のどれかに当てはまる間は同期しない。`preflight`は終了コード3（STOP）を返す。
   - 判断のない上書き・削除がある。
   - 判断の後にSite側のファイルが変わった（ハッシュが違う判断は「古い判断」として無効になる）。
   - 保全（手順2）ができていない、またはD1・認証・公開設定に関わる差分がある。

6. **同期方法の事前確認**: rsyncの空実行の結果を、preflightの予測と突き合わせる。除外設定の漏れなどで予測外の削除・転送があれば止まる。

```sh
rsync -a --checksum --delete --dry-run --itemize-changes \
  --exclude .git --exclude node_modules --exclude .sites-runtime --exclude .wrangler \
  <github-checkout>/ <sites-checkout>/ > outputs/rsync-dry-run.txt
node scripts/release.mjs preflight outputs/release-<short-sha>.json --root <sites-checkout> \
  --decisions decisions.json --rsync-dry-run outputs/rsync-dry-run.txt
```

   `--checksum`は内容で比較させるため（日時とサイズだけの比較では内容の変更を見逃すことがある）。`SAFE TO SYNC`が出たときだけ次へ進む。

7. **同期**: 手順6と同じ引数から`--dry-run --itemize-changes`を外して実行する。
8. **同期後の照合**: `node scripts/release.mjs verify outputs/release-<short-sha>.json --root <sites-checkout>`。`verify: OK`以外ならデプロイしない。
9. **復旧の確認**: 問題があれば`outputs/site-backup-<date>.tgz`を展開し、`node scripts/release.mjs verify outputs/site-before-<date>.json --root <復元先>`で、同期前と完全に同じに戻ったことを確かめる。
10. Sitesソースにコミットする。メッセージに`GitHub <full-sha>`を含め、`decisions.json`の要約を`SESSION_LOG`へ残す。

2026-11-15のリハーサル（GitHubの古いSHA＋Siteだけのファイル1件＋Site側の編集1件）で、1回目の`preflight`はSTOP（未判断8件）、判断を記録してrsyncの空実行と突き合わせるとSAFE、同期後の`verify`はOK、同期後の改ざんは`verify`で検出、バックアップからの復元は同期前のハッシュと一致した。判断後にSite側を編集すると「古い判断」として再びSTOPした。

## 4. ビルド・Privateデプロイ（配備担当）

1. Sitesスキルの正規の手順でinstall・buildする（`npm run build`相当）。手動でCloudflareへWorkerを上書きしない。
2. **Privateのまま**デプロイする。公開範囲の設定には触れない。
3. デプロイ後、`access_mode=custom`・許可ユーザー・外部0人が§0で控えた値と同じであることを確認する。

## 5. 動作確認（ユーザー／配備担当）

- 対局: 新規対局、数手指す、成りの選択、持ち駒を打つ、投了、記録画面への反映。
- 教材: 1題を解く。チャット: 1往復。
- **既存データ**: リリース前に保存済みの対局記録・修了レッスン・途中の盤面が残っていること（`kifu-rival.v1`）。
- iPhoneの実機で盤面が崩れないこと（UI変更を含む場合は必須）。

## 6. 記録

`docs/ledger/SESSION_LOG.md`へ追記し、下の「リリース記録」の表に1行足す（PRで反映）。必須項目: 日付、GitHub SHA、Site version、判定（`none`/`app`/`runtime`/`data`）、`verify`結果、アクセス設定の事後確認、動作確認の範囲、ロールバック先version。

## ロールバック

- **通常（`app`/`runtime`）**: Sitesの機能で直前のversionへ戻す。それができない場合は、直前のリリースSHAで§3〜4をやり直す。D1は変更していないので、コードを戻すだけで済む。
- 戻した事実と理由を台帳へ記録し、GitHub側で修正PRを作る。GitHubの履歴は巻き戻さない（`reset`・force push禁止）。
- **localStorageの互換性**: ロールバックしても端末内の記録を壊さないよう、リリースは**旧版が新しい保存データを読めること**を守る。フィールドの追加は任意フィールドに限り（例: `Game.positionLog`）、キー`kifu-rival.v1`や既存フィールドの意味は変えない。変える場合は`data`扱いとし、移行と旧版への戻し方を先に設計する。

## データ（`data`判定のリリース）

以下がすべてそろうまで配備しない。

1. ユーザーの明示的な承認（台帳に記録）。
2. 本番D1のバックアップ手段の確認と取得（Sitesで取れる手段は配備担当が確認する。**取れないならリリースしない**）。
3. マイグレーションは追加のみ（列・表の追加）。削除や型変更は別の設計判断にする。
4. 旧版コードが新スキーマで動くこと、またはロールバック手順が書かれていること。

## 初回リリース（Sitesソースの同期）

GitHubは検査済みスナップショットから新しい履歴で始めたため、Sitesソースの履歴とはつながっていない。初回は次の手順にする。

1. 配備担当が現在のSitesソースのHEADとSite versionを控える。
2. `--base`には、GitHubへ移管した最初のコミット`992fdd0c50ad5316dd8621b94ddffd271844ef19`を使い、変更の分類を確認する。2026-11-15時点（`main` `53557f6`）で配信物の変更は`lib/shogi.ts`（千日手・500手・入玉宣言の判定・不正局面検出）と`lib/lessons.ts`（「はじめての一手詰」の二歩修正）のみで判定は`app`。D1・API・依存関係の変更はない。実行時に再確認する。
3. §3の手順3〜5（同期前の`preflight`）で、Site側にしかないファイルと内容の違うファイルをすべて洗い出す。共通の基準SHAがないため、差分を「不要」と決めつけず、1件ずつ「GitHubへ取り込む」か「置き換えてよい」かを判断して記録する。
4. 以降は通常の手順に従う。

## リリース記録

| 日付 | GitHub SHA | Site version | 判定 | preflight（未判断0件の確認） | 判断の件数 | verify | アクセス事後確認 | 動作確認 | 戻し先 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| （未実施） | | | | | | | | | |
