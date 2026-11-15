# 意思決定記録（ADR）

状態の違い: `ACCEPTED`=ユーザー指示に基づく決定、`PROPOSED`=未承認案、`SUPERSEDED`=後続の決定に置換。決定の取消しも履歴を消さず、新ADRから参照する。

## ADR-001 — アプリの主題
- Status: ACCEPTED
- Date: 2026-11-15
- Decision: **将棋を共に強くなる長期ライバルAIと、絶対初心者から有段者までの教材モードを統合する。**
- Reason: ユーザーが対戦相手の人間味・オールラウンダー性、学習の段階性、共に成長する感覚を明確に希望。
- Consequence: 棋力/対話/教材/履歴を独立実装しても、最終的に一つの体験へ統合する必要がある。

## ADR-002 — UIの方向
- Status: ACCEPTED
- Date: 2026-11-15
- Decision: 大人びた、スタイリッシュだがどこか和風。視認性と操作性を最優先する。
- Reason: 試作の駒表示や幼い印象にユーザーが違和感を示し、方向を明示的に選択。
- Consequence: 盤面や駒は遊び心より識別性と一貫性を優先し、スマホで必ずQA。

## ADR-003 — 試作第1号の位置付け
- Status: ACCEPTED
- Date: 2026-11-15
- Decision: 現行サイトはアルファ試作品。少し触る分には有用だったが、これをベースに数ヶ月・数年単位で開発する。
- Reason: ユーザーの今回の依頼。
- Consequence: 未実装を完成と表示しない。データ・URLを残し、安全な移管・反復を優先。

## ADR-004 — 長期台帳とAI交代
- Status: ACCEPTED
- Date: 2026-11-15
- Decision: Claude CodeとChatGPTの双方が読んで更新できるリポジトリ内の共通台帳を設ける。
- Reason: 複数AI・複数回の開発・長期間の中断でも、重要な指示・承認・検証を失わないため。
- Consequence: 状態と検証証拠を台帳へ追記。新セッション／新担当も共通規約を読む。

## ADR-005 — 将棋エンジン構成候補
- Status: SUPERSEDED
- Date: 2026-11-15
- Decision: 強い将棋エンジンと人間らしい着手選択層を分け、実装前にライセンス／実行環境を比較する。
- Reason: 現簡易AIの弱さを直す一方、ユーザーが望む人間らしさを作るため。
- Consequence: 技術・コスト検証なしに特定エンジン導入を既成事実にしない。ユーザーが後に基本方針を承認（ADR-008）。

## ADR-006 — ソースの移管候補
- Status: SUPERSEDED
- Date: 2026-11-15
- Decision: ユーザー管理のprivate GitHubリポジトリをClaude Codeとのソース共有・レビューの正本とし、ChatGPT Sitesのプライベート公開を別工程とする。
- Reason: Claudeが継続的にclone/commitでき、ChatGPTと同じ台帳を保守しやすい。
- Consequence: 現状GitHubリポジトリがないので `KIF-002` はBLOCKED。作成・権限の確認まで移行完了と宣言しない。private repo案は後にPublicへ変更（ADR-007）。

## ADR-007 — GitHub Public／実行Site Privateの分離
- Status: ACCEPTED
- Date: 2026-11-15
- Decision: 開発ソースと共通台帳を置くGitHubは**Public**とする。一方、ChatGPT Sites上で本人が使う棋友の実行アプリは、引き続き**本人限定のPrivate**とする。
- Reason: ユーザーが公開ソースと無償CIを利用できる方針を明示的に選択。利用対象が本人でも、GitHub repoをPrivateにする必然性はないと判断。
- Consequence: GitHub Publicへ移管する前に機密・個人データ・権利の点検を行う。Siteのアクセス権を変更しない。Public化だけで他者への著作権ライセンス付与やGPL義務の消滅にはならない。`KIF-002`, `KIF-062`。

## ADR-008 — USIエンジンとライバル制御層の分離
- Status: ACCEPTED
- Date: 2026-11-15
- Decision: 強い外部将棋エンジンに局面解析を担当させ、USI adapterを介して接続する設計を基本とする。棋風・難易度・人間らしい手の選び方は別の`rival policy`層とする。オープンソースの利用を検討するが、**特定エンジン・評価関数・実行先は採用未決**。
- Reason: 現在Lv.4ですら弱いことへの改善要求と、人間らしく共に成長するライバルを両立させるため。
- Consequence: ソースのGPL対応、評価データ等の個別権利、USIによる結合実態、性能・月額費用を導入前に点検する。単なるプロセス分離をライセンス免責とみなさない。`KIF-020`, `KIF-021`, `KIF-024`。

## ADR-009 — 安全なPRの無人マージ
- Status: ACCEPTED
- Date: 2026-11-15
- Decision: Claude CodeでブランチとPRを作成し、GitHub Actionsで適切な検証を経た**本人の低・中リスク変更のみ自動`squash merge`**する。認証・DB・公開設定・依存関係・第三者権利・自動化ルール等は除外し、Private Siteへの自動デプロイもしない。
- Reason: ユーザーが長期開発の主体をClaude Codeへ移し、マージ等も可能な限り自動で行いたいと明示。
- Consequence: `docs/AUTOMERGE_POLICY.md`, `KIF-063`に詳細。GitHub上での実動作とmain保護規則を確認するまで自動化完了と記録しない。

## ADR-010 — 初回引継ぎ後の運用判断（2026-11-15）
- Status: ACCEPTED
- Date: 2026-11-15
- Decision: (1) GitHubリポジトリはPublic、ChatGPT SiteはPrivateを維持する。(2) 既存コミットに含まれる個人メールアドレスは公開のままでよく、履歴の書換えはしない。(3) マージ済みブランチの自動削除を推奨する（GitHub設定はユーザー操作）。過去のブランチを一括削除する必要はない。(4) GPLエンジンを**リポジトリ外の一時環境**へダウンロードし、実行・計測する研究作業を許可する。第三者のコード・バイナリ・評価関数のリポジトリへの追加、本番導入、ユーザーへの配布、有料サービスの契約は別途判断とする。(5) 持将棋・入玉は日本将棋連盟の現行規定を確認したうえでClaudeが推奨仕様を出し、重大な選択だけユーザーが判断する。(6) 優先順位はKIF-003（リリース手順）→KIF-010（終局判定）→KIF-020（エンジン実測）。
- Reason: PR #7・#8の結果を受けたユーザーの指示（ChatGPT側でもPR #8の自動マージとCI成功を確認済み）。
- Consequence: `KIF-003`, `KIF-010`, `KIF-020`, `KIF-024`。エンジンの実測結果は台帳と`docs/ENGINE_INTEGRATION_PLAN.md`へ記録し、第三者物はコミットしない。`Q-009`, `Q-010`を解決。
