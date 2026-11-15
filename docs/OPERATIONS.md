# 開発・保存・リリース・復旧手順

最終確認: 2026-11-15。実際の環境・サービスの仕様は変わり得るため、実行直前に再確認すること。

## 現行の配置

- **本人限定のPrivate Site**: <https://kifu-rival-2026.timelyoasis5.chatgpt.site>。公開状態と許可ユーザーはSites設定で再確認する。
- **ChatGPT Sites project ID**: `appgprj_6af9475ecefc8191bb8a9c7e275528b0`
- **確認済みSite version**: 4（本改訂前に確認。更新後はSESSION_LOGを優先）
- **実行基盤**: Cloudflare Worker（Vinext/Next.js）、D1 binding `DB`
- **開発ソース**: このリポジトリ。初期ローカルGitには `origin` が未設定だった。
- **Claude Code用GitHub**: `setisunyuma/kifu-rival`（**Public、147ファイル移管/初回CI・PR自動マージ成功**）。Claude Codeクラウドからのcloneは未検証。`KIF-002`参照。
- **Public/Private境界**: ソースGitHubは公開、棋友を遊ぶSiteは本人限定。GitHubの可視性変更でSiteの権限を変更してはならない。

## ローカル開発

1. Node.js `>=22.13.0`、Gitを使用。秘密をGitへ追加しない。
2. `npm ci` で固定依存関係を取得する。Sitesの管理Linux環境では提供されたインストールスクリプトに従う。
3. `npm run dev`。認証の挙動はローカルと本番で異なる場合がある（元README内のSIWC説明を参照）。
4. `npm run test:unit`, `npm run ledger:check`, `npm run public:check`, `npm run lint`, `npx tsc --noEmit`。
5. `npm run build`。ChatGPT Sitesでのビルドと公開は該当Sitesスキルの手順を利用し、ローカルGitHub pushだけで本番が変わると考えない。

## データ保全

- `localStorage`: `kifu-rival.v1`。現在の盤、レベル、教材完了、対局、会話の一部が入る。
- `D1`: `games`, `lesson_progress`, `conversations`。認証IDで所有者を区分する。
- バックアップは**未実装**。本番DBをエクスポートできる手段を確認する前に destructive migration を行わない。クラウド記録だけで現在盤面を復元できるという保証もない。
- 新しいリリースが既存データに影響する場合、旧形式の読込テスト→バックアップ方法→移行・ロールバック手順→ユーザー確認、の順で進める。

## 非公開Sitesリリース（ChatGPT側担当）

**正式な手順は [RELEASE.md](RELEASE.md)**（KIF-003）。要点は次のとおり。

1. GitHub `main`の候補SHAについて `npm run release:plan -- --base <前回リリースSHA>` で変更を分類する。`data`判定（D1・hosting binding・認証・localStorageキー）は承認とバックアップがそろうまで配備しない。
2. `npm run release:manifest` で候補SHAの全ファイルのハッシュを取り、Sitesソースへ反映したあと `release:verify` で一致を確認する。一致しなければデプロイしない。
3. Sites公式のビルド経路でPrivateのままデプロイし、アクセス設定の事後確認とスマホでの動作確認を行う。手動でCloudflareへ同じWorkerを上書きしない。
4. Site versionとGitHub SHAの対応を台帳とRELEASE.mdの記録表に残す。ロールバックはSiteの直前versionへ戻す。

**Claude Code環境にはChatGPT Sitesの配備権限がない**（2026-11-15確認）。Claudeは候補SHA・分類・マニフェストの準備までを行い、配備は権限を持つ側が行う。

## GitHubへの移管（初回スナップショットの移管とCIは成功済み）

1. **作成・移管確認済み**: `setisunyuma/kifu-rival`はPublic。最初は`size=0`の空repoだったが、現在スナップショット147ファイルを新Git履歴で移管し、初回`Source validation`成功とPR #1自動マージ成功を確認済み。既存ソースにREADME/ignoreがあり、`LICENSE`はQ-008で未決。
2. `npm run public:check` と [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md) に従って**実際に公開するスナップショット**を点検する。Git履歴全体は未監査のため、初回のGitHubインポートでは過去履歴を公開せず**検査済みZIPの内容だけ**を新しい履歴へcommitすることを推奨。`git push --mirror` や全履歴の無確認pushは禁止。
3. GitHub権限を持つ環境（ユーザーのローカルPCかClaude CodeのGitHub連携）で、空リポジトリをcloneし、提供されたZIPを展開して**ZIP内の`kiyu/`の中身**をcloneしたリポジトリのルートにコピーする。`AGENTS.md`、`CLAUDE.md`、`.github/workflows/verify.yml`、`.openai/hosting.json`、隠しファイルも含める。Gitに元からある`.git/`は残し、ZIPからGit履歴・鍵・ランタイム成果物を取り込まない。
4. `git status`で内容を確認→`npm ci`→`npm run public:check`→`npm run ledger:check`→`npm run test:unit`→`npm run lint`→`npx tsc --noEmit`→`npm run build`。合格後、`git add .`→`git commit`→`git push`。デプロイ鍵を使わない公開ソースCIの実行結果を確認する。
5. Claude CodeがPublicリポジトリをcloneできること、台帳を読めること、PRまたはコミットを書ける権限が必要なときは自分のGitHub連携を使うことを確認する。`KIF-002`の受入証拠を追記する。
6. 以後 **GitHub=開発ソース・台帳の正本 / Private ChatGPT Sites=試作版の実行先**。Claudeは作業ブランチとPRを作り、CIに通った限定変更は`docs/AUTOMERGE_POLICY.md`に従い自動マージする。Site更新は権限のあるChatGPT側と同期・明示的デプロイする。同期経路確立前に両者を独立して別々に編集しない。

この環境のGitHubコネクタには新規リポジトリ作成操作がなく、`gh`のログインも確認できなかったが、その後ユーザーのGitHub接続で**Public repo・ソース移管・GitHub Actions成功を確認済み**。**main Ruleset `Protect main`は有効化済み、PR #5で保護下の無人マージ成功を確認。Claude Codeクラウドからのclone/PRのみ別途確認が必要**。GitHub Publicの無料CI枠は権利・実行条件の最新公式情報を適用し、予期しない有料機能は承認なしで有効にしない。

## 自動マージの運用と独立したリリース

- `.github/workflows/verify.yml`: PRの検査。実行コードはPRのものなので、`GITHUB_TOKEN`は読取専用で、Site秘密情報・デプロイ資格情報を渡さない。
- `.github/workflows/guarded-auto-merge.yml`: CI成功後、GitHub Actions `workflow_run`の書込権限で**mainの信頼済みコードだけを実行**。PR頭・base両SHA、対象パス、作成者、CIの出どころを照合し、`scripts/guarded-auto-merge.mjs`からGitHub RESTの`squash merge`を実行。条件に該当しなければ保留する。
- 設定・例外・操作手順は[`AUTOMERGE_POLICY.md`](AUTOMERGE_POLICY.md)。**マージ済みPR ≠ 非公開Siteへのデプロイ**。本番反映は`KIF-003`の手順を別に確立する。
- GitHub Ruleset `Protect main`（ID `27308076`）を2026-11-15に有効化。`main`のPR・`verify`必須、削除・force push禁止をGitHub APIで照合。PR #5の`verify`成功→無人マージ成功を実地確認済み。Claude CodeクラウドからのPR操作とSiteへの独立リリース経路は未確認。

## Git履歴・ロールバック

- 公開とロールバックの対象はSite versionとGit SHAを対で記録。Gitを戻すだけでは本番DBもSiteも戻らない。
- `git reset --hard` や強制push、DBテーブル削除を標準手順にしない。失敗時は元コミットから修正または回復用コミットを作る。
- `docs/ledger/SESSION_LOG.md` に実際の操作・確認方法・残るリスクを残す。

## コストと認証

現在の試作では外部LLMは実装していない。APIキーをブラウザへ埋め込まない。将来エンジンやLLMに課金・利用規約が生じる場合は、ユーザーに月次上限・データ送信範囲を確認する。**ChatGPTの購読とAPI課金は別**として予算を管理する。
