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
npm run release:plan -- --base <released> --out outputs/plan-<short-sha>.json
```

| 判定 | 意味 | 次の行動 |
| --- | --- | --- |
| `none` | 文書・テスト・CI・リポジトリ管理用スクリプトのみ（明示リストに載ったもの）。配信物は変わらない | 配備は任意 |
| `app` | 画面・将棋ロジック・教材の変更 | 通常リリース。§2へ |
| `runtime` | API・Worker・依存関係・ビルド設定・配信ファイルの削除・**どの規則にも当てはまらない未分類ファイル**・`package.json`のビルド／起動／インストール系スクリプトやnpmのライフサイクルフック（`preinstall`・`postinstall`・`prepare`等）の変更 | `npm run build`と`npm start`でビルド済みWorkerを確認してから§2へ |
| `data` | D1マイグレーション・スキーマ・`drizzle.config.ts`・hosting binding・認証。加えて、配信コード（`app/`・`lib/`・`components/`・`hooks/`）の**中身**で端末の保存データに関わる変更（下の「保存処理の変更の検出」） | **中断**（終了コード2）。§データ の条件をユーザーが承認するまで配備しない |

### 保存処理の変更の検出（`release:plan`と`preflight`で共通）

- 対象: 配信コードの中の`localStorage`・`sessionStorage`・`indexedDB`を含む文と、保存キー（`STORAGE_KEY = "..."`、`getItem`/`setItem`/`removeItem`の文字列キー、`kifu-rival.vN`）。
- 比較の前にコメントを除き、空白・改行を取り除く。`localStorage .clear ()`や改行をはさんだ呼び出しも同じ文として扱う。
- 保存に関わる文を引数まで含めて1件ずつ比べ、追加・削除・変更があれば`data`。`removeItem(STORAGE_KEY)`から`clear()`への同数の置き換えも検出する。影響を判定できない変更（保存する内容の変更など）も**通常の変更に落とさず`data`**とする。保存処理に触れない画面の変更や、空白だけの変更は`data`にしない。
- 限界: 保存APIを別名の変数に入れて別の場所で使う書き方は、その名前（`localStorage`等）が現れる箇所しか検出できない。棋友のコードではこの書き方をしない。

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

5. **ゲートの確認（同期の前に必ず）**: `preflight`は次のゲートをまとめて判定し、1つでもNGなら終了コード3（STOP）を返す。**通過しても「同期してよい」ことしか意味しない**。デプロイ後の確認（§4〜5）は別に必要。

   | 種類 | ゲート | 誰が保証するか |
   | --- | --- | --- |
   | 自動 | `release:plan`の結果（`--release-plan`）が、このマニフェストと同じSHAに対するもの | ツールが検証 |
   | 自動 | GitHub側のチェックアウト（`--github-root`）がマニフェストと一致する | ツールが検証 |
   | 自動 | シンボリックリンク・特殊ファイルがない（このツールでは検証できないため、あれば止める） | ツールが検証 |
   | 自動 | 上書き・削除のすべてに、現在のハッシュに紐づく判断がある（判断の後にSiteが変われば無効） | ツールが検証 |
   | 自動 | rsyncの空実行が予測（追加・上書き・削除）と一致する | ツールが検証 |
   | 自動 | バックアップのスナップショットが、今のSiteと一致する（バックアップ後の変更を検出） | ツールが検証 |
   | 自動 | バックアップのアーカイブを一時ディレクトリに展開すると、スナップショットと一致する | ツールが検証 |
   | 手動 | このリリースの判定が`data`の場合、承認記録（`approvedBy`、`approvedOn`、`scope`、`d1Backup`、`rollbackPlan`）がそろっている。判定は「同期するパス」「Site側とGitHub側の中身の比較（保存キー等）」「`release:plan`の判定」のうち最も重いもので、どれか1つでも`data`なら必要。迂回する指定はない | **人**。ツールは記録がそろっているかだけを確認し、内容の真偽は確認しない |
   | 手動（ツール外） | Site versionを控えた、D1のバックアップを取った（`data`の場合）、デプロイ後のPrivate設定・iPhone確認 | **人**。§0・§4・§5で記録する |

6. **同期方法の事前確認とゲートの実行**:

```sh
EXC=$(node scripts/release.mjs excludes)   # 検証対象外のパスを、同期でも触らないための除外指定
rsync -a --checksum --delete --dry-run --itemize-changes $EXC <github-checkout>/ <sites-checkout>/ > outputs/rsync-dry-run.txt
node scripts/release.mjs preflight outputs/release-<short-sha>.json --root <sites-checkout> \
  --github-root <github-checkout> --release-plan outputs/plan-<short-sha>.json \
  --decisions decisions.json --rsync-dry-run outputs/rsync-dry-run.txt \
  --backup-snapshot outputs/site-before-<date>.json --backup-archive outputs/site-backup-<date>.tgz \
  [--data-approval approval.json]
```

   `--checksum`は内容で比較させるため（日時とサイズだけの比較では内容の変更を見逃すことがある）。`GATES PASSED`が出たときだけ次へ進む。同期（手順7）にも**同じ`$EXC`**を必ず付ける。

   **検証の対象外（ツールは中身を確認しない）**: 次のパスはハッシュ照合の対象外。代わりに、rsyncの除外指定で**同期の際に削除も上書きもしない**。tarのバックアップには含まれるが、中身の照合はしない。`preflight`は見つかったものを一覧で表示する。
   - ディレクトリ: `.git/`、`node_modules/`、`dist/`、`.next/`、`.vinext/`、`out/`、`.wrangler/`（ローカルのD1状態を含む）、`.sites-runtime/`、`coverage/`、`outputs/`、`work/`、`.agents/`、`.codex/`、`.yarn/`、`.pnp/`
   - ファイル: `.env*`、`.dev.vars*`、`*.pem`、`.DS_Store`、`next-env.d.ts`、`*.tsbuildinfo`、`*-debug.log*`
   - シンボリックリンク・特殊ファイル: 扱えないため、見つかった時点で**停止**する（Site側・GitHub側とも）。
   除外指定を付け忘れると、rsyncの空実行に予測外の削除が出て、手順6のゲートで止まる。

7. **同期**: 手順6と同じ引数（`$EXC`を含む）から`--dry-run --itemize-changes`を外して実行する。
8. **同期後の照合**: `node scripts/release.mjs verify outputs/release-<short-sha>.json --root <sites-checkout>`。`verify: OK`以外ならデプロイしない。
9. **復旧の確認**: 問題があれば`outputs/site-backup-<date>.tgz`を展開し、`node scripts/release.mjs verify outputs/site-before-<date>.json --root <復元先>`で、同期前と完全に同じに戻ったことを確かめる。
10. Sitesソースにコミットする。メッセージに`GitHub <full-sha>`を含め、`decisions.json`の要約を`SESSION_LOG`へ残す。

2026-11-15のリハーサル（rsync 3.2.7、GitHubの古いSHAを展開したSite＋Siteだけのファイル1件＋Site側の編集1件）: 判断もバックアップもない段階では`preflight`がSTOP。判断を記録し、`tar`のバックアップとスナップショットを用意すると全ゲートを通過（`GATES PASSED`）。同期後の`verify`はOK、同期後の改ざんは`verify`で検出、バックアップから同期前のハッシュどおりに復元できた。バックアップ後にSiteを編集すると、判断の無効化・空実行との不一致・スナップショットの不一致で再びSTOPした。

第2回のリハーサル（同日）: Site側の`app/rival-app.tsx`だけが古い保存キー（`kifu-rival.v0`）のとき、`release:plan`（GitHub側の履歴）は`app`判定だったが、`preflight`の中身の比較が`data`と判定し、承認記録がない間は停止した。Site側のシンボリックリンクでも停止した。承認記録をそろえると通過し、同期後もSite側の`.dev.vars`と`.wrangler/state`は除外指定によって残った。

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

GitHubは検査済みスナップショットから新しい履歴で始めたため、Sitesソースの履歴とはつながっていない。初回は次の手順にする。**SHAや変更範囲を文書に固定せず、実際にリリースする最新SHAで毎回求める**。

1. 配備担当が現在のSitesソースのHEADとSite versionを控える。
2. 候補SHA（その時点のGitHub `main`）をチェックアウトし、`npm run release:plan -- --base 992fdd0c50ad5316dd8621b94ddffd271844ef19`を実行する。`992fdd0`はGitHubへ移管した最初のコミットで、Siteの現在の版に最も近いGitHub側の基準。ただしSite側に移管後の独自変更があれば、この分類には現れない。
3. その不足を補うのが§3の`preflight`。Site側にしかないファイルと内容の違うファイルを、共通の基準がない前提で1件ずつ判断する（差分を「不要」と決めつけない）。
4. 2026-11-15時点の`main`（`7f9e5fc`）で試すと、判定は`data`になる。理由は`app/rival-app.tsx`の保存内容に`declarationRule`と`lessonAttempts`が加わったこと。追加された項目は旧版のコードでは無視されるため、新版の保存データを旧版が読めなくなることはない。ただし旧版に戻した後に保存すると、追加項目（回答記録・規則の設定）は失われる。承認記録の`rollbackPlan`にこの点を書く。実際の判定は、リリースする最新SHAで再実行して確かめる。
5. 以降は通常の手順に従う。

## リリース記録

| 日付 | GitHub SHA | Site version | 判定 | preflight（未判断0件の確認） | 判断の件数 | verify | アクセス事後確認 | 動作確認 | 戻し先 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| （未実施） | | | | | | | | | |
