# 作業一覧 — 棋友 / KIYU

更新: 2026-11-15。状態は**現行コードと確認済み証拠**の範囲で付ける。`P0`は直近のリスク除去、`P1`は中核、`P2`は拡張。

## KIF-001 — 試作第1号の長期引継ぎ基盤
- Status: VERIFIED
- Priority: P0
- Owner: ChatGPT
- Depends: none
- Acceptance: 共通規約・製品仕様・構成・運用・台帳・Claude引継ぎをソースへ同梱し、検証・保存する。
- Evidence: 2026-11-15、14文書と17作業IDを台帳検査で確認。ユニット13件、型チェック、lint、build、diff check全成功。Sites専用ソースリポジトリへコミット `6444285dbbaeaf71d9a617ee7d6aa249a90abc9b` をpush済み。`SESSION_LOG.md`参照。
- Next: 最新ソースZIPを渡す。Public GitHub確立（KIF-002）と継続運用（KIF-003）へ進む。

## KIF-002 — Claude Codeが扱えるPublic GitHub正本の確立
- Status: VERIFIED
- Priority: P0
- Owner: ChatGPT → Claude
- Depends: KIF-001
- Acceptance: ユーザー管理の**Public** GitHubリポジトリを作り、安全な最新ソース・全台帳・テストを移管し、Claude Codeでcloneできることを確認。実行Siteは本人限定のPrivateを保ち、差分・同期責任を明確化。
- Evidence: ユーザーのPublic承認（ADR-007）。`setisunyuma/kifu-rival`（ID 1458595649、Public、本人admin可）は作成当初`size=0`。2026-11-15に検証済みスナップショット147ファイルを新Git履歴のコミット`992fdd0c50ad5316dd8621b94ddffd271844ef19`として移管し、GitHub tree APIで147ファイルを照合。初回CI [run 43696606531](https://github.com/setisunyuma/kifu-rival/actions/runs/43696606531)成功、PR #1も自動マージ成功。**Claude Codeクラウドからのclone/PR操作は未検証**。
- Evidence (Claude, 2026-11-15): Claude Codeクラウド環境で`setisunyuma/kifu-rival`のclone・`git fetch origin main`に成功（HEAD=origin/main=`0a6fd4e29b61df020573959547d3b3b08a5d5a3c`、作業ブランチ`claude/kiyu-shogi-app-handoff-0v2q7j`）。GitHub MCPの認証ユーザーは`setisunyuma`。Node 22.23.4 / npm 10.9.9で`npm ci`、`ledger:check`、`public:check`（147/145）、unit 17/17、lint、`tsc --noEmit`、build、`git diff --check`すべてPASS。ローカルコミット作者はClaude用のnoreplyアドレス（個人メールではない）。PR作成と自動マージの結果は`SESSION_LOG`の後続記録で確認する。
- Evidence (Claude, 2026-11-15, PR作成後): Claude CodeクラウドからGitHub MCPで[PR #7](https://github.com/setisunyuma/kifu-rival/pull/7)を作成（API上の作成者`setisunyuma`、同一repo）。修正push後の[CI run 43703535608](https://github.com/setisunyuma/kifu-rival/actions/runs/43703535608)成功→[Guarded auto-merge run 43703597934](https://github.com/setisunyuma/kifu-rival/actions/runs/43703597934)成功→`merged_by=github-actions[bot]`、squash commit `8fba021fee1c849218eeb2cf550a4c560f1fcd52`。マージ後に最新mainをfetchして作業ブランチを再作成。**clone・PR作成・最新main取得の受入条件を実地確認**。Private Siteの公開範囲はClaudeから操作・確認できない（Sites権限なし）ため、ChatGPTによるversion 5時点の確認（本人のみ・外部0）を根拠とし、GitHub側の操作では変化しない。
- Next: なし（本IDは完了）。GitHubと非公開Siteの同期はKIF-003。

## KIF-003 — GitHubとSitesの安全なリリース経路
- Status: IN_PROGRESS
- Priority: P0
- Owner: Claude → ChatGPT
- Depends: KIF-002
- Acceptance: GitHubのレビュー済みコミットから非公開Sitesへ反映する手順、バージョン付与、データ保全、ロールバックが再現できる。
- Evidence: GitHub pushだけではChatGPT Sitesの公開版が変わらない。
- Evidence (Claude, 2026-11-15): 手順書`docs/RELEASE.md`と支援スクリプト`scripts/release.mjs`（`release:plan`=差分を`none/app/runtime/data`に分類し`data`は終了コード2で停止、`release:manifest`=SHA固定の全ファイルSHA-256、`release:verify`=Sitesソースとの一致検証）を追加。単体テスト6件（`tests/release.spec.ts`。`package.json`はスクリプトだけの変更なら`none`、依存関係・engines等の変更なら`runtime`）。リハーサル: `6002ddd`のマニフェスト（147ファイル）と`git archive`展開物の照合がOK、1ファイル改ざんでMISMATCHを確認。移管直後の`992fdd0`から`6002ddd`までの配信物の変更は`lib/shogi.ts`のみ（`app`判定）。**ClaudeにはSites配備権限がないため、実際のSite反映・ロールバックは未実施**。
- Next: ChatGPT（Sites権限保持者）が`docs/RELEASE.md`の§初回リリースを実施し、Site versionとGitHub SHAの対応・`verify`結果・アクセス設定の事後確認を記録する。成功を確認してから`VERIFIED`とする。アプリ内にビルドSHAを表示する案（Siteで今どの版が動いているかを画面で確認できる）を次の改善候補とする。

## KIF-010 — 将棋ルール・合法手の完全性
- Status: IN_PROGRESS
- Priority: P0
- Owner: Claude
- Depends: none
- Acceptance: 王手回避、成り、駒打ち、打ち歩詰め、千日手、連続王手の千日手、持将棋、終局判定等の仕様を確定し、相互に独立したテスト局面と回帰テストを用意する。
- Evidence: `lib/shogi.ts` は基本の合法手を持つが完全な公式ルールの検証はない。`tests/shogi.spec.ts` あり。
- Evidence (Claude, 2026-11-15): 既存実装を調査し、王手回避・成り・駒打ち・打ち歩詰めは概ね正しいが**千日手が未実装**（`result: "draw"`が一度も設定されない）と確認。`lib/shogi.ts`に千日手（同一局面＝盤・持ち駒・手番の4回目で引分け、初回出現以降の自分の着手が全て王手なら王手側の負け）、SFEN出力`toSfen`／入力`fromSfen`、後方互換な任意フィールド`Game.positionLog`を追加。`tests/shogi.spec.ts`に16件追加（全33件PASS）: perft 1〜3手=30/900/25470（公表値と一致）、最大合法手数局面=593手（公表値と一致）、SFEN往復と不正入力、合駒・取り・玉移動の王手回避、両王手、ピン、成りの任意/強制/不可（先後）、打ち場所制限（先後）、と金のある筋の二歩不成立、成駒を取ると生駒で持ち駒、打ち歩詰め（禁止）と対照（逃げ道あり・突き歩詰め・香打ち詰めは合法）、千日手引分け、連続王手の千日手、旧保存形式の互換。ミューテーション5種（打ち歩詰め判定除去、桂の行き所、連続王手判定除去、4回→5回、二歩の成駒扱い）を全てテストが検出。
- Evidence (Claude, 2026-11-15, 第2回): 日本将棋連盟「対局規則」第2章第8〜10条（制定2024-06-07、最終改定2025-10-01）と連盟FAQの原文を`www.shogi.or.jp`から確認し、`docs/ARCHITECTURE.md`に規則対応表と推奨仕様を記録。`playMove`に500手持将棋（王手中は連続王手が途切れるまで延期）を追加。入玉宣言の判定`checkDeclaration`（`jsa`=31点勝ち/24〜30点引分け、`amateur27`=先手28・後手27）と全駒点数`materialPoints`を純関数で追加し、画面・AIには未接続。テスト6件追加（全39件PASS）。ミューテーション8種（31→30、24→23、敵陣外の駒を数える、王手を無視、500手判定除去、王手中も500手で終了、後手も28点必要）を全検出。
- Evidence (Claude, 2026-11-15, 第3回): `validatePosition`を追加（二歩、行き所のない駒、駒数の上限、玉が各1枚、手番でない側への王手）。**既存教材「はじめての一手詰」（`rook-mate`）の局面に後手の二歩（6筋・4筋）があることを検出**し、詰みに無関係な6二・4二の歩を削除して修正（レッスンIDは不変で学習記録に影響なし、詰みのテストはPASS）。テスト2件追加（全41件PASS）、ミューテーション3種を全検出。
- Remaining: 入玉宣言の画面・AI接続（推奨仕様をユーザー判断待ち、Q-011）、合意による24点法、先後交代の再戦、SFEN取込時に`validatePosition`を必須にする（KIF-011）、ステイルメイトの扱いの明文化。
- Next: Q-011の判断を受けて入玉宣言を画面とAIへ接続する。判断待ちの間は、教材の全局面を`validatePosition`で検査するテストを教材追加のたびに維持する（KIF-031）。

## KIF-011 — 棋譜／盤面の相互運用とデータ移行
- Status: BACKLOG
- Priority: P1
- Owner: Unassigned
- Depends: KIF-010
- Acceptance: 安定した局面形式、USI/SFEN/棋譜インポート・エクスポート、バージョン付きデータ移行、往復テスト。
- Evidence: 現状は `Game` と `usi`、D1のUSI文字列配列のみ。外部との完全な往復機能はない。
- Next: 保存・解析・エンジン接続に必要な最小形式を提案する。

## KIF-020 — 強い将棋エンジンの比較・採用判断
- Status: IN_PROGRESS
- Priority: P0
- Owner: Claude
- Depends: none（KIF-010の検証と並行して調査可能。統合はKIF-010の結果を待つ）
- Acceptance: 複数の候補について強さ、棋譜形式、iPhone/Cloudflare適合、推論遅延、ライセンス、保守、費用、オフライン可能性を実測／一次資料で比較し、採用候補と理由を提示する。
- Evidence: 現 `chooseRivalMove` は浅い読みで、Lv.4も弱いとのユーザー評価。採用エンジンは未決。
- Evidence (Claude, 2026-11-15): 机上調査第1回を`docs/ENGINE_INTEGRATION_PLAN.md`に記録。YaneuraOu本家、shielune/YaneuraOu（WASM配布フォーク、Cloudflare Workers用シングルスレッド版あり）、Fairy-Stockfish（公式WASM npm）、Apery Rust、dlshogi、`yaneuraou.wasm`を一次資料で比較。全てGPL-3.0系。評価関数の権利は候補ごとに未確認点が残る。**ビルド・実測・取込みは未実施**。
- Evidence (Claude, 2026-11-15, 実測第1回): ADR-010の許可に基づきリポジトリ外でYaneuraOu駒得版（`2bc64b4`）とFairy-Stockfish（`014b077`、手作り評価／CC0の将棋NNUE）をビルド・実行し、66局を対局。現行Lv.4は3エンジンに0勝18敗。YaneuraOu駒得版はFairy手作り評価に9勝3敗、Fairy NNUEは両者に12勝0敗。全手を棋友の`legalMoves`で検証して**不正手0件**。速度・メモリ・ブラウザWASM（Chromium）の実測、評価関数の権利（Fairy将棋NNUEは配布ページの記載でCC0、YaneuraOuのNNUEは公開入手経路なし）を`docs/ENGINE_INTEGRATION_PLAN.md`に記録。再現用ハーネスを`tests/engine-bench/`に追加（自作コードのみ、CI対象外）。**iPhone実測と採用判断は未実施**。
- Next: (1) ユーザーにQ-003（採用候補）の判断を依頼。第一候補は「Web Workerで動く評価関数ファイル不要のエンジン」。(2) YaneuraOu駒得版のWASM化とブラウザでの比較。(3) iPhone Safari用の最小テストページで実機計測（ユーザーの協力が必要）。ライセンスや費用が不明な候補は本番統合しない。

## KIF-021 — 棋力を上げるエンジン接続試作
- Status: BACKLOG
- Priority: P1
- Owner: Unassigned
- Depends: KIF-020, KIF-011
- Acceptance: 入力局面から検証済み合法手と候補評価を返し、Lv.4が明らかな単純悪手を避ける。低性能環境の遅延・失敗時の振る舞いも測る。
- Evidence: 未着手。
- Next: KIF-020で採用した候補で独立アダプターを試作。

## KIF-022 — 人間らしい適応棋力・レベル評価
- Status: BACKLOG
- Priority: P1
- Owner: Unassigned
- Depends: KIF-021
- Acceptance: 技量帯別の対局成績と指し手品質を計測し、棋風の一貫性を保ちながら人間にあり得るミスをする。各レベルの実力説明は実測に基づく。
- Evidence: 現4レベルは弱いヒューリスティックと乱数のみ。
- Next: ユーザーの体感と対局テストに基づく棋力調整仕様を提案。

## KIF-023 — オールラウンドな戦型・棋風
- Status: BACKLOG
- Priority: P1
- Owner: Unassigned
- Depends: KIF-021
- Acceptance: 異なる居飛車・振り飛車・急戦・持久戦の選択と対応ができ、選択理由／棋風をログで説明できる。
- Evidence: 定跡選択は未実装。
- Next: 候補戦型とユーザーレベル別の出現分布を提案。

## KIF-024 — 第三者エンジンの権利・再配布条件レビュー
- Status: BACKLOG
- Priority: P0
- Owner: Claude
- Depends: KIF-020
- Acceptance: エンジン本体と評価関数・定跡・重み・ライブラリごとの権利表示とライセンスを特定し、想定するプロセス間連携・WASM配布・サーバー利用ごとの義務を一次資料で確認、採用と配布条件をユーザーが判断できる資料にする。
- Evidence: `docs/ENGINE_INTEGRATION_PLAN.md` に候補と一般的なGPL注意点を記載。特定バージョンを選んだ審査・法的結論は未実施。
- Evidence (Claude, 2026-11-15): Fairy-Stockfishの将棋NNUE（`shogi-9ab5e57f31d0.nnue`、2026-11-03）は公式配布ページに「2026年以降のネットワークはCC0」と記載。YaneuraOuのNNUE評価関数は支援者向け配布で、公開の入手経路・再配布条件を確認できない。評価関数ファイル不要の構成（YaneuraOu駒得版・Fairy手作り評価）はエンジン本体のGPLv3のみが論点。詳細は`docs/ENGINE_INTEGRATION_PLAN.md`。
- Next: KIF-020の候補と実装/配布方式が決まったら個別ライセンス監査を行う。必要なら専門家の判断を仰ぐ。

## KIF-030 — 入門〜有段までのカリキュラム体系
- Status: READY
- Priority: P1
- Owner: Unassigned
- Depends: none（技能マップ設計は独立可能。個々の問題検証はKIF-010を待つ）
- Acceptance: 技能マップ、前提関係、講義／練習／実戦／感想戦／定着確認の設計、初心者と有段者の出口基準を明文化する。
- Evidence: `lib/lessons.ts` は固定6レッスン。段階3〜6は制作予定表示のみ。
- Next: 入門・基本手筋・序盤・中盤・終盤・詰将棋・戦型ごとのスキル一覧を設計する。

## KIF-031 — 検証済み教材と問題バンク
- Status: BACKLOG
- Priority: P1
- Owner: Unassigned
- Depends: KIF-030, KIF-021
- Acceptance: 各問題に盤面・唯一/複数解・根拠・解説・難度・検証方法があり、指し手の正しさを自動検証できる。
- Evidence: 6題はコードに定数として実装。教材の大規模検証はまだない。
- Next: 問題スキーマとテストハーネスを作る。

## KIF-032 — 適応学習・実戦復習の循環
- Status: BACKLOG
- Priority: P2
- Owner: Unassigned
- Depends: KIF-031, KIF-011
- Acceptance: 対局の弱点→講義／練習→再対局→遅延復習の流れが履歴に基づき成立し、難しさを上げるだけの機構にならない。
- Evidence: 現在は完了フラグのみ。
- Next: スキル別習熟度と復習スケジューラーを提案。

## KIF-040 — 盤面に根拠を持つ自由会話
- Status: BACKLOG
- Priority: P1
- Owner: Unassigned
- Depends: KIF-011, KIF-021
- Acceptance: 自然言語LLMが対局結果・盤面・解析結果を正確に参照し、未知は未知と答え、対局中と感想戦を分ける。プロンプト注入とAPI費用の制御を備える。
- Evidence: 現 `lib/rival-chat.ts` は正規表現の定型応答。LLM未使用。
- Next: モデル選択・月間上限・データ送信の範囲をユーザーと決定する。

## KIF-041 — 継続するライバルの人格・記憶
- Status: BACKLOG
- Priority: P2
- Owner: Unassigned
- Depends: KIF-040, KIF-050
- Acceptance: 会話・棋譜から許可された事実だけを長期参照し、同じ相棒として一貫した会話ができ、ユーザーが記憶を閲覧・修正・消去できる。
- Evidence: 現状長期会話の正しい再利用は未実装。
- Next: 記憶分類・保存期限・削除権限を仕様化する。

## KIF-050 — データ安全性・同期・エクスポート
- Status: READY
- Priority: P0
- Owner: Unassigned
- Depends: none
- Acceptance: 対局・教材・会話の保存失敗を検知でき、バックアップ／復元／移行検証が可能。ユーザーがデータのエクスポートと削除を実行できる設計。
- Evidence: localStorageとD1の部分同期。API書込失敗をクライアントが無視する箇所がある。
- Next: 既存データ形式の契約テストと、非破壊のエクスポート案を作る。

## KIF-060 — モバイル盤面・和モダンUIの回帰防止
- Status: READY
- Priority: P1
- Owner: Unassigned
- Depends: none
- Acceptance: iPhone主要幅で盤が収まり、駒・成り・持ち駒・タップ・スクロールが安定。視覚差分とアクセシビリティ基準を確認する。
- Evidence: 2026-11-15試作のモバイル表示を確認。過去に盤の桁崩れ・駒の視認性問題があった。
- Next: 幅320/375/390/430pxと拡大文字のスクリーンショット回帰を自動化。

## KIF-061 — 自動テスト・CIとリリースゲート
- Status: IN_PROGRESS
- Priority: P0
- Owner: ChatGPT → Claude
- Depends: KIF-002
- Acceptance: TypeScript、lint、ユニット、基本E2E、台帳検査、ビルドがPRごとに走り、失敗時にmerge/公開を防ぐ。
- Evidence: Secretsとデプロイ権限を渡さない `.github/workflows/verify.yml` を追加。GitHub初回pushの[run 43696606531](https://github.com/setisunyuma/kifu-rival/actions/runs/43696606531)とPR #1の[run 43696850845](https://github.com/setisunyuma/kifu-rival/actions/runs/43696850845)はいずれも`verify`成功。main Ruleset `Protect main`有効化とPR #5の保護下自動マージを確認。基本E2Eは未導入。
- Next: mainのPR必須・`verify`必須・force push禁止は`Protect main`で設定・PR #5で検証済み。ブラウザE2E検証を追加してから `VERIFIED` とする。

## KIF-062 — Publicソースの機密・ライセンス公開点検
- Status: VERIFIED
- Priority: P0
- Owner: ChatGPT
- Depends: none
- Acceptance: 最新スナップショットで `npm run public:check` が成功し、追跡ファイル、現在のGit著者情報、SiteのPrivate設定、成果物と第三者権利に関する未監査範囲を記録。新たにPublicへ移管する対象を明確にする。
- Evidence: `docs/PUBLIC_RELEASE_CHECKLIST.md`, `scripts/check-public-release.mjs` を追加。2026-11-15最新snapshot候補は143追跡ファイル/141テキストで静的スキャンPASS、現行5コミット著者は自動化用の`Codex`のみ。独立表示のPrivate Site（本人のみ・外部0）をSites接続で確認。画像はアプリ内のアバターとSVGアイコンのみ、画像の実内容を目視。ユニット13件・lint・型検査・buildはPASS。**Git過去履歴や画像権利の法的保証を意味しない**。`SESSION_LOG`参照。
- Next: 初回Public GitHubにはこの最新ZIP**スナップショットだけ**を新履歴としてコミット。CI実行とGitHubの表示・アクセスをKIF-002で再確認し、将来の追加資産も同じ検査を通す。

## KIF-063 — Claude PRの検証・条件付き無人マージ
- Status: IN_PROGRESS
- Priority: P0
- Owner: ChatGPT → Claude
- Depends: KIF-002, KIF-061
- Acceptance: 本人の同一repo PRがCI全成功・現行head/base・変更範囲・サイズを満たす場合に無人`squash merge`される。一方、フォーク・失敗CI・古いコミット・インフラ/DB/公開設定変更等は自動マージされない。`main`のPR/CI保護、GitHubでの実地動作が確認でき、Private Siteを自動デプロイしない。
- Evidence: `.github/workflows/guarded-auto-merge.yml`と`scripts/guarded-auto-merge.mjs`を実装、単体テスト4件追加（全体17件PASS）。GitHub Publicへ移管後、PR #1のCI [run 43696850845](https://github.com/setisunyuma/kifu-rival/actions/runs/43696850845)成功→[Guarded auto-merge run 43696911543](https://github.com/setisunyuma/kifu-rival/actions/runs/43696911543)成功→squash commit `a1fb7f516487fb4092f601169a482a7463dd79ff`、本人操作なしでマージ済み。要手動のPR #2は`[manual]`で自動マージ保留となり、ログに`Manual review`を確認（[run 43697230268](https://github.com/setisunyuma/kifu-rival/actions/runs/43697230268)）。PR #2はその後、CIと差分を確認して手動squash merge。main Ruleset `Protect main`を有効化し、PR #5で必須`verify`成功と保護下無人マージ成功を確認。
- Evidence (Claude, 2026-11-15): Claude CodeクラウドからGitHub MCP（認証`setisunyuma`）で台帳のみの同一repo PRを作成中。**draft PRは`assessMerge`で拒否され、かつ`verify.yml`の`pull_request`既定typesに`ready_for_review`が無いためdraft→Ready化後にCIが再実行されず自動マージされない**とコードから判明。そのため自動マージ検証PRは非draftで作成する。結果は後続記録。
- Evidence (Claude, 2026-11-15, 結果): Claude作成PR #7で、初回CI失敗時に`Guarded auto-merge`が`skipped`（[run 43703224226](https://github.com/setisunyuma/kifu-rival/actions/runs/43703224226)）、修正後のCI成功で無人squash merge（[run 43703597934](https://github.com/setisunyuma/kifu-rival/actions/runs/43703597934)、`8fba021`）を実地確認。**失敗CIでのマージ拒否**と**Claude Codeクラウド発PRの無人マージ**は確認済み。`Automatically delete head branches`は無効のようで、マージ後もheadブランチが残る（過去の`claude/*`ブランチ7本が残存）。
- Remaining: フォークPR・古いhead・base SHA欠落の各拒否ケースは単体テストのみで実地未確認。
- Next: CIイベントのbase SHA欠落ケースは安全停止のまま観察する。draft運用を許すなら`verify.yml`に`ready_for_review`追加を手動PRで提案（`.github/`は自動対象外）。draft運用を許すなら`verify.yml`に`ready_for_review`追加を手動PRで提案（`.github/`は自動対象外）。
