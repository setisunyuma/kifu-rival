# Claude Codeへ渡す引継ぎ票

作成日: 2026-11-15。**現行は試作第1号**。Claudeが長期開発を担い、ChatGPTも同じソース・台帳へ参加する。

## 引継ぐもの

- `README.md` — アプリ概要、導線、開発コマンド
- `AGENTS.md` / `CLAUDE.md` — 共通ルール・Claudeの着手順
- `docs/PRODUCT_VISION.md` — ユーザー確認済みの最終目標
- `docs/ARCHITECTURE.md` — いま動くもの／未実装／データ構造
- `docs/ENGINE_INTEGRATION_PLAN.md` — USIエンジン層、人間的ライバル層の分離、GPL・付属データの確認条件
- `docs/PUBLIC_RELEASE_CHECKLIST.md` — GitHub Public、Site Privateを維持し機密／権利を点検する手順
- `docs/ROADMAP.md` — 長期の依存関係と段階
- `docs/OPERATIONS.md` — 非公開SitesとGitHubの切り分け、環境、リリース／復旧
- `docs/ledger/` — **ID付きの共有台帳**、意思決定、未決事項、証拠、セッションログ
- `app/`, `lib/`, `db/`, `drizzle/`, `tests/`, `public/` 等 — 動くソース
- `.github/workflows/verify.yml`, `scripts/check-public-release.mjs` — Public GitHub向けSecretsなし検査（本番デプロイなし）
- `.github/workflows/guarded-auto-merge.yml`, `scripts/guarded-auto-merge.mjs`, `docs/AUTOMERGE_POLICY.md` — 本人の同一repo PRを検証成功後、安全な範囲のみ無人`squash merge`（本番デプロイなし）

## 受け渡しの現在地

- **方針は確定**: GitHubソース＝**Public**。ChatGPT Sitesのアプリ＝**本人限定のPrivate**。GitHubへpushするだけではSiteが更新・公開されない。
- **実施済み**: `setisunyuma/kifu-rival`はPublic。147ファイルのソースを新履歴で移管し、GitHub Actionsの初回`verify`成功とPR #1の無人`squash merge`成功を確認。**未完了**: Claude CodeクラウドからのcloneとPR操作、GitHub Rulesetの設定・拒否系PRの実地検証。GitHubとPrivate Siteは独立している。
- **渡す現物**: Gitに追跡した最新の**ソース全体を収めたZIP**。ClaudeにはZIPを読み込ませるか、ZIPの内容をPublic GitHubリポジトリに初回commitした後でリポジトリURLを渡す。SiteのURLだけではソースを受け取れない。
- **ライセンス**: プロジェクト自身のルート`LICENSE`未選択（Q-008）。YaneuraOu/Apery等は本体と評価関数・定跡を独立して確認し、USI別プロセス構成でもGPL対応が自動的に不要になるわけではない。

## Claude Code開始用プロンプト（そのまま渡せる）

> あなたは将棋アプリ「棋友 / KIYU」の長期開発担当です。これは試作第1号から数年単位で育てるプロジェクトです。公開GitHub `setisunyuma/kifu-rival` または添付ソースを正本として、最初に `AGENTS.md`, `CLAUDE.md`, `docs/AUTOMERGE_POLICY.md`, `docs/PRODUCT_VISION.md`, `docs/ARCHITECTURE.md`, `docs/ENGINE_INTEGRATION_PLAN.md`, `docs/PUBLIC_RELEASE_CHECKLIST.md`, `docs/ROADMAP.md`, `docs/OPERATIONS.md`, `docs/ledger/` 全体を読んでください。`git status` と実コード、台帳を照合してください。ユーザーの目標は「初心者から有段者まで、オールラウンドで人間らしい棋力を持つライバルと共に成長し、会話・棋譜・教材がつながるアプリ」です。デザインは大人びた和モダン。今のAIはLv.4でも弱く、教材は6題、チャットはルールベースです。完成していると決めつけないでください。GitHubソースはPublic、実行Siteは本人限定のPrivateで、GitHub pushとSiteデプロイは別工程です。**`main`に直接pushせず、作業ブランチで小さく実装し、PRを開く。CIが通れば安全な対象だけ自動で`squash merge`するため、許可条件に該当する際は手動マージの催促を不要とする。非対象の変更は誤魔化さず手動確認として残す。** 最初に `npm ci`、`public:check`、`ledger:check`、単体テスト、lint、型検査、buildを行い、既存データを守りながら `KIF-010` と `KIF-020` の調査・小さな実装から着手してください。USI対応エンジンは独立アダプター、人間らしい着手は別ポリシー層に分けます。特定のGPLエンジンや重みの採用・配布は、原典のライセンス、結合、実行場所、性能、費用の確認後に提案してください。課金、Siteの外部公開、個人データ送信、不可逆なデータ操作は改めて承認を求めます。着手・中断・検証完了のたびに同じリポジトリの台帳を更新し、変更と同じコミットに入れてください。セッション末尾に最終SHA、合格したテスト、未完・次の一手を明記してください。公開・デプロイが未実施なのに完了と誤報しないこと。

## 最初の一週間に推奨する行動（固定締切ではない）

1. ソース・台帳の整合性チェック。UIと棋譜を壊さないことを確認。
2. 将棋ルール不足とテストケースの整理。安全に小さな追加テストを実装。
3. USI将棋エンジン候補の技術比較（別プロセス/外部エンジン/ブラウザWASMの違い）、GPL・評価関数等のライセンスと費用を調査。
4. 最小の対局強度改善を評価するテスト対局と計測方針を提案。
5. 変更IDと証拠、今週の成果と次の一手を台帳に残す。

## 注意事項

- Public GitHubへの現在スナップショット移管と最初のPR自動マージは成功。Claude Codeクラウドにリポジトリを選ばせ、cloneとPR操作を確認する。旧SitesのGit履歴は公開GitHubへ持ち込まなかった。単なるPrivate Site URLではソースをcloneできない。
- この引継ぎ票自体は**Claudeがソースを受領済みである証拠ではない**。受領・初期テスト完了は `KIF-002` に記録する。
- ChatGPT側はプロダクト設計やQAに参加し続けられる。二つのAIが独立に別の台帳を作らず、必ず同じ `docs/ledger/` を編集する。
