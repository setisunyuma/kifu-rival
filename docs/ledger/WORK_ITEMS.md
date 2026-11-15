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
- Status: IN_PROGRESS
- Priority: P0
- Owner: ChatGPT → Claude
- Depends: KIF-001
- Acceptance: ユーザー管理の**Public** GitHubリポジトリを作り、安全な最新ソース・全台帳・テストを移管し、Claude Codeでcloneできることを確認。実行Siteは本人限定のPrivateを保ち、差分・同期責任を明確化。
- Evidence: ユーザーのPublic承認（ADR-007）。`setisunyuma/kifu-rival`（ID 1458595649、Public、本人admin可）は作成当初`size=0`。2026-11-15に検証済みスナップショット147ファイルを新Git履歴のコミット`992fdd0c50ad5316dd8621b94ddffd271844ef19`として移管し、GitHub tree APIで147ファイルを照合。初回CI [run 43696606531](https://github.com/setisunyuma/kifu-rival/actions/runs/43696606531)成功、PR #1も自動マージ成功。**Claude Codeクラウドからのclone/PR操作は未検証**。
- Next: Claude Codeクラウドで当該Public repoを選んでcloneし、PR作成・最新mainの取得を確認。GitHubと非公開Siteの同期はKIF-003。

## KIF-003 — GitHubとSitesの安全なリリース経路
- Status: BACKLOG
- Priority: P0
- Owner: Unassigned
- Depends: KIF-002
- Acceptance: GitHubのレビュー済みコミットから非公開Sitesへ反映する手順、バージョン付与、データ保全、ロールバックが再現できる。
- Evidence: GitHub pushだけではChatGPT Sitesの公開版が変わらない。
- Next: 現行Sitesソース保存機能と新Public GitHubの差分同期方法を文書化し、Private Siteへの非破壊の更新で実験する。

## KIF-010 — 将棋ルール・合法手の完全性
- Status: READY
- Priority: P0
- Owner: Unassigned
- Depends: none
- Acceptance: 王手回避、成り、駒打ち、打ち歩詰め、千日手、連続王手の千日手、持将棋、終局判定等の仕様を確定し、相互に独立したテスト局面と回帰テストを用意する。
- Evidence: `lib/shogi.ts` は基本の合法手を持つが完全な公式ルールの検証はない。`tests/shogi.spec.ts` あり。
- Next: ルールの不足ケースと現テストの網羅性を列挙し、最小のテスト追加から開始する。

## KIF-011 — 棋譜／盤面の相互運用とデータ移行
- Status: BACKLOG
- Priority: P1
- Owner: Unassigned
- Depends: KIF-010
- Acceptance: 安定した局面形式、USI/SFEN/棋譜インポート・エクスポート、バージョン付きデータ移行、往復テスト。
- Evidence: 現状は `Game` と `usi`、D1のUSI文字列配列のみ。外部との完全な往復機能はない。
- Next: 保存・解析・エンジン接続に必要な最小形式を提案する。

## KIF-020 — 強い将棋エンジンの比較・採用判断
- Status: READY
- Priority: P0
- Owner: Claude
- Depends: none（KIF-010の検証と並行して調査可能。統合はKIF-010の結果を待つ）
- Acceptance: 複数の候補について強さ、棋譜形式、iPhone/Cloudflare適合、推論遅延、ライセンス、保守、費用、オフライン可能性を実測／一次資料で比較し、採用候補と理由を提示する。
- Evidence: 現 `chooseRivalMove` は浅い読みで、Lv.4も弱いとのユーザー評価。採用エンジンは未決。
- Next: `docs/ENGINE_INTEGRATION_PLAN.md` に従い、USI/別プロセス案を出発点に複数エンジンを比較する。ライセンスや費用が不明な候補は本番統合しない。

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
- Evidence: Secretsとデプロイ権限を渡さない `.github/workflows/verify.yml` を追加。GitHub初回pushの[run 43696606531](https://github.com/setisunyuma/kifu-rival/actions/runs/43696606531)とPR #1の[run 43696850845](https://github.com/setisunyuma/kifu-rival/actions/runs/43696850845)はいずれも`verify`成功。main rulesetは未作成、基本E2Eも未導入。
- Next: GitHub SettingsでmainのPR必須・`verify`必須・force push禁止を設定し、ブラウザE2E検証を追加してから `VERIFIED` とする。

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
- Evidence: `.github/workflows/guarded-auto-merge.yml`と`scripts/guarded-auto-merge.mjs`を実装、単体テスト4件追加（全体17件PASS）。GitHub Publicへ移管後、PR #1のCI [run 43696850845](https://github.com/setisunyuma/kifu-rival/actions/runs/43696850845)成功→[Guarded auto-merge run 43696911543](https://github.com/setisunyuma/kifu-rival/actions/runs/43696911543)成功→squash commit `a1fb7f516487fb4092f601169a482a7463dd79ff`、本人操作なしでマージ済み。要手動のPR #2は`[manual]`で自動マージ保留となり、ログに`Manual review`を確認（[run 43697230268](https://github.com/setisunyuma/kifu-rival/actions/runs/43697230268)）。PR #2はその後、CIと差分を確認して手動squash merge。main rulesetは未完了。
- Next: GitHub Settingsでmain Ruleset（PR必須・verify必須・force push禁止）を設定。要手動PRの保留挙動はPR #2で実地確認済み。Claude CodeクラウドからのPR発行確認を実施。CIイベントのbase SHA欠落ケースは安全停止のまま検証する。
