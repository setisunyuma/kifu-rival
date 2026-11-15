# セッションログ（追記式）

直近が上でも下でも読めるよう、**新しい記録は末尾へ追記する**。消去・過去の完了報告の書換えはしない。訂正は次の項目で行う。

## 2026-11-15 — 試作第1号から長期開発基盤へ

- Actor: ChatGPT
- Base commit: `b36f009c9ff98564465dad0b29bb71594c093077`（変更着手時のクリーンな `main`）
- Scope: `KIF-001`, `KIF-002`。既存ユーザー体験の改変なし。文章、台帳、自動検査、引継ぎの整備。
- Observed: 現行は非公開ChatGPT Site version 3、対局AIは簡易評価／浅い読み、教材6題、定型会話、localStorage＋D1部分保存。Lv.4棋力不足のユーザーフィードバックあり。
- Transfer investigation: GitHubの接続ユーザーには棋友専用repoなし。新規repo作成APIなし。`gh auth status` 未ログイン。**ClaudeへのGitHubハンドオフ未完了**。
- Validation: 検査・コミット／Sites保存はこの記録作成時点で未実行。結果は後続ログに追記する。
- Data impact: DBと既存の棋譜は触っていない。公開範囲は非公開維持。
- Next: 文書と台帳を検証・保存、ソース引継ぎ用の安全なアーカイブを準備。`Q-001` のprivate GitHub repoができたら移管する。

## 2026-11-15 — 引継ぎ文書・台帳の検証とSitesソース保存

- Actor: ChatGPT
- Work item: `KIF-001` は受入条件を満たし `VERIFIED`。`KIF-002` はBLOCKEDのまま。
- Tests: `npm run ledger:check` = 14文書/17作業ID OK、`npm run test:unit` = 13/13 PASS、`npx tsc --noEmit` = PASS、`npm run lint` = PASS、`git diff --check` = PASS、Sites build helper = PASS。
- Source storage evidence: Git `6444285dbbaeaf71d9a617ee7d6aa249a90abc9b` をChatGPT Sitesソースの`main`にpush成功。GitHubではなくSites専用ソースであることに注意。
- Browser GitHub attempt: GitHub UIはサインインを要求。認証情報を要求・入力せず中断。`gh auth status`未ログイン、GitHub connectorにrepo作成機能なし。ユーザーによるprivate repo作成待ち。
- Data impact: DBの変更なし、既存対局・会話の消去なし。UIの挙動に変更なし。
- Pending after this entry: この記録を含む最終アーカイブの保存・非公開サイト配備・移管用ソーススナップショット作成。実際の結果は後続の引継ぎ報告で確認する。

## 2026-11-15 — Public GitHub方針・Private Site維持・USI設計ゲート

- Actor: ChatGPT
- Base commit: `c12c645d070a7bd34b1958aedb4dcff5170367dd`（Sites source `main`、version 4。着手時の作業ツリーはクリーン）
- User decisions: GitHubソースは**Public**、アプリのChatGPT Siteは**本人限定のPrivate**を維持（ADR-007）。USI engine adapter／人間らしい棋風制御を分離し、OSS候補のライセンス審査を行う方針（ADR-008）。特定エンジン・ルートLICENSEは未選定。
- Scope: 運用・Claude引継ぎ・ロードマップ・共通規約・台帳を公開方針へ更新。エンジン採用レビュー資料、Publicファイル監査、SecretsなしGitHub Actions CIを追加。**対局・教材・会話の実装やD1スキーマ、本人のデータには変更なし**。
- GitHub status: 2026-11-15現在、接続先`setisunyuma`の12リポジトリに棋友は存在せず、作成APIなし。**KIF-002未完了**。Public化の承認と実際のリポジトリ公開操作は異なる。
- Security baseline: `npm run public:check` は143追跡ファイル・141テキストでPASS。Git著者履歴5件はすべて自動化用の`Codex`。典型的な個人メール・トークン・秘密鍵がないことを静的確認。追跡画像は`public/kiyu-rival-portrait-v2.webp`（人物風アプリ用アバター、実画像目視）と`public/favicon.svg`（棋のアイコン）。**この点検は過去履歴の完全監査・著作権の鑑定ではない**ため、Public GitHubには点検済み最新スナップショットを新規履歴でimportする。
- Site access: Sites APIで `access_mode=custom`、許可ユーザー1人、外部ユーザー0を確認。GitHubソースPublicはSite公開設定変更の許可ではない。
- Validation: `npm run public:check` PASS、`npm run ledger:check`=16文書/19ID PASS、`npm run test:unit`=13/13 PASS、`npm run lint` PASS、`npx tsc --noEmit` PASS、`npm run build` PASS、`git diff --check` PASS。GitHub Actionsの本番CIはリポジトリ未作成のため**未実行**。
- Remaining: 検証済みソースのSitesへの保存とZIP提供は、この記録の次の作業。保存後の正確なSHA・Site versionは後続ログまたは納品報告で更新する。`KIF-061`はGitHub CI未実行でIN_PROGRESS、`KIF-002`はBLOCKED。

## 2026-11-15 — Public準備版のPrivate Site保存を確認

- Actor: ChatGPT
- Source commit: `d2b445e3e657cfc230bdb2b620fddf1d2631307f` をChatGPT Sites専用ソースの`main`へ保存。
- Deployment: Private Siteへのデプロイ **version 5 成功**。デプロイ後にSites APIで `access_mode=custom` / 利用許可1人 / 外部0人を再確認。**実行SiteをPublicへ変更していない**。
- Source changes: 機能コード・DB内容を変更せず、公開方針・Claude引継ぎ・CI・GPL評価ゲート・台帳を追加。`KIF-062`は既存スナップショットに限り `VERIFIED`、`KIF-061`はGitHub CI未稼働なので `IN_PROGRESS`。
- Handoff: GitHub Publicリポジトリは依然未作成（`KIF-002=BLOCKED`）。最終ZIPを作って内容を検証し、`setisunyuma/kifu-rival`の作成後は過去Git履歴を含めず新履歴に取り込む。
- Next: 本項を含む最終ソースのコミットをSitesへ保存、Privateのまま再デプロイ。最新HEADからZIPを出力し、ユーザーへClaude Code用の受け渡し内容と必要な一手を知らせる。

## 2026-11-15 — Public repo作成確認と安全なPR自動マージ実装

- Actor: ChatGPT
- Base commit: `43efdccfa8da54abb35e947a7c08c97b0316d019`（ChatGPT Sitesソースの`main`、開始時clean）。この履歴全体のPublic再利用は未監査であり、新Public repoに過去履歴をpushしない。
- Discovery: GitHub connector `get_repo`で`setisunyuma/kifu-rival`、Public、repo ID `1458595649`、admin/write権限、`size=0`を確認。以前の「未作成」はその時点の記録であり、今は作成済み。
- User intent: Claude Codeによる長期開発でマージ等を自動化する。ADR-009に受入範囲を確定。Private Siteの外部公開・DB変更・新課金は許可されていない。
- Scope: `workflow_run`によるCI成功後の条件付き無人`squash merge`。信頼済みmainのみcheckout、PRコードをprivileged workflowで実行しない。本人・同一repo・非draft・最新head/base・許可パス/サイズを全確認し、REST mergeのhead SHAを固定。ハイリスク変更は自動化対象外。
- Verification at writing: 自動マージ条件の単体テスト4件を追加し、全体17件PASS。**GitHub CIでの本番実行・安全PR自動マージ・main ruleset設定はまだ未実施**。外部へのGitHubソース公開操作・追加の回帰テスト結果は後続の記録で追記する。
- Data impact: アプリ本体・D1・棋譜・Site公開権限への操作なし。GitHubの自動マージはPrivate Siteデプロイとは独立。
- Next: 公開対象スナップショットを追加検査し、新Public repoへ初回import。Github Actionsで実際の動作を確認し、branch protectionを設定する。

## 2026-11-15 — Public GitHub初回インポートとCI実行を確認

- Actor: ChatGPT
- GitHub source: `setisunyuma/kifu-rival`（Public）の`main`へ、旧SitesのGit履歴を持ち込まない検査済みスナップショット147ファイルをコミット `992fdd0c50ad5316dd8621b94ddffd271844ef19` として登録。GitHub tree APIの再読込で147ファイル・truncated=falseを確認。
- CI evidence: `Source validation`の初回push実行 [run 43696606531](https://github.com/setisunyuma/kifu-rival/actions/runs/43696606531) は`verify`ジョブ成功。`npm ci`, `public:check`, `ledger:check`, unit, lint, typecheck, buildの各ステップがすべて成功。
- Auto-merge experiment: この追記だけの同一repo PRを使い、`workflow_run`のデータと自動マージ判定を実地検証する。PR作成・マージはこの記録時点ではまだ未確認。
- Pending: Claude Codeクラウドからのclone/PR作成確認、保護rulesetの設定、Private Siteの同期経路。これらは成功を確認するまで完了扱いしない。

## 2026-11-15 — PR #1の自動マージが成功

- Actor: ChatGPT
- Pull request: [PR #1](https://github.com/setisunyuma/kifu-rival/pull/1) は`docs/ledger/SESSION_LOG.md`だけを追記。本人`setisunyuma`作成・同一repoブランチ。変更ファイル数1、削除・重要設定変更なし。
- Evidence: [Source validation run 43696850845](https://github.com/setisunyuma/kifu-rival/actions/runs/43696850845) が成功後、[Guarded auto-merge run 43696911543](https://github.com/setisunyuma/kifu-rival/actions/runs/43696911543)が`squash merge`を実行して成功。GitHub PRは`merged=true`、merge commit `a1fb7f516487fb4092f601169a482a7463dd79ff`。初回CIのpush runから起動した自動マージJobは意図どおりskipped。
- Validation: GitHub APIの`workflow_run`ではPRのhead・base SHA、検証元workflowパス、同一repoを確認でき、PRの現在のtest merge commitとも照合できた。17単体テストはPASS。**本当に無人マージされた事実を確認した**。
- Remaining: 高リスクPR拒否の実地確認は単体テストのみ。main rulesetはGitHub API上空配列で、GitHub管理画面はログイン要求のため未設定。Claude Codeクラウドからのclone/PR、ChatGPT Sitesへの同期も未確認。Private Siteのアクセス権・DBは変更していない。
- Next: 本文書・Claude引継ぎ・作業台帳を実施済みの状態に更新し、PRに記録。管理権限のあるGitHubブラウザでmain Rulesetを設定する。

## 2026-11-15 — PR #2の要手動レビュー判定を確認

- Actor: ChatGPT
- Pull request: [PR #2](https://github.com/setisunyuma/kifu-rival/pull/2) は`AGENTS.md`・`CLAUDE.md`など指示書を含む8件の文書更新、タイトルに`[manual]`。`Source validation`の[run 43697172307](https://github.com/setisunyuma/kifu-rival/actions/runs/43697172307)は成功。
- Refusal evidence: [Guarded auto-merge run 43697230268](https://github.com/setisunyuma/kifu-rival/actions/runs/43697230268)の実行ログに`Manual review: PR #2: Manual review explicitly requested`と出力され、PRは`merged=false`のまま停止。除外経路を実際に検証。
- Manual follow-up: 内容とCIを確認し、SHA固定の手動squash mergeを実行。結果コミット`7ca63192dceb91c4b57a677717f376d9c7dd254e`。自動ガードによるマージではない。
- Remaining: `main` Rulesetは未設定、Claude Codeクラウドからのclone/PR発行は未確認。`KIF-063`はIN_PROGRESSのまま。サイトの非公開設定・デプロイは不変。

## 2026-11-15 — Rulesetの有効化後に自動マージを再検証

- Actor: ChatGPT
- GitHub setting: `setisunyuma/kifu-rival`のRuleset `Protect main`（ID `27308076`）をAPIで確認。`active`、default branch対象、pull_request必須・承認数0・必要チェック`verify`・branch deletion禁止・force push禁止・Squashのみ・strict status checksはOFF・bypassなし。
- Experiment: この台帳追記のみを安全な同一repo PRとして提案。`Source validation`と`Guarded auto-merge`が**保護ルール適用後**も動くかを確認する。PR作成時点ではマージ成功を未確認とし、結果は別記録で追記する。
- Scope: ChatGPT SitesのPrivate設定、D1、実際の棋譜、デプロイには変更なし。Claude Codeクラウドの接続は引き続き未確認。

## 2026-11-15 — Ruleset保護下のPR #5自動マージ成功

- Actor: ChatGPT
- Ruleset evidence: `Protect main`（ID `27308076`）は`active`、default branch対象、PR必須・承認数0・必須チェック`verify`（GitHub Actions）・ブランチ削除/force push禁止・Squashのみ・最新ブランチ強制OFF・bypassなし。API再読込で確認。
- Smoke test: [PR #5](https://github.com/setisunyuma/kifu-rival/pull/5)はこの台帳だけを追記した本人の同一repo PR。[Source validation run 43700912594](https://github.com/setisunyuma/kifu-rival/actions/runs/43700912594)で`verify`成功後、[Guarded auto-merge run 43700962737](https://github.com/setisunyuma/kifu-rival/actions/runs/43700962737)成功、`merged=true`。無人Squashコミットは`c18b26f5a43ad604c4ec7de7fac01bc073dab124`。
- Interpretation: **ルール保護と自動マージの両立を実地検証**。ただしClaude Codeクラウドでのclone/PR発行は未検証、ChatGPT Private Siteには自動デプロイしていない。`KIF-063`はIN_PROGRESSを維持。
