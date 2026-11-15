# Claude Codeへの入口 — 棋友 / KIYU

このプロジェクトは**動く試作第1号**から、数日・数ヶ月・数年かけて育てる将棋学習／ライバルAIアプリへ移行中。ユーザーは本格開発の主体をClaude Codeへ預ける予定。

**最初に必ず** `AGENTS.md`、`docs/PRODUCT_VISION.md`、`docs/ARCHITECTURE.md`、`docs/ENGINE_INTEGRATION_PLAN.md`、`docs/PUBLIC_RELEASE_CHECKLIST.md`、`docs/ledger/README.md`、`docs/ledger/WORK_ITEMS.md`、`docs/ledger/DECISIONS.md`、`docs/ledger/SESSION_LOG.md`、`docs/OPERATIONS.md` を読み、`git status` と実際のソースを照合する。

## 現時点の重要事項

- 盤・駒・UI、最低限の合法手処理、4段階の弱いヒューリスティックAI、6教材、ルールベース会話、履歴保存が存在する。
- **強い将棋エンジン・人間らしいレーティング制御・生成会話・体系的な初心者〜有段教材はまだない**。Lv.4の棋力が低いというユーザーフィードバックがある。
- 現行サイトはChatGPT Sites上の**本人限定の非公開試作**。GitHub正本は**Publicソース**（`setisunyuma/kifu-rival`、空repo作成確認済み、移管・Claude cloneの実測は未確認）。GitHubにpushしてもSite本番は更新されない。
- GitHubでは**ブランチ→PR→読取専用CI→条件付き自動`squash merge`**を基本運用とする。変更前に[`docs/AUTOMERGE_POLICY.md`](docs/AUTOMERGE_POLICY.md)を読む。認証・DB・依存関係・OSS/権利・公開権限・GitHub Actionsの変更などは自動対象から除外される。
- **Publicソースに現実の棋譜・会話・個人メール・鍵を含めない**。`LICENSE` は未決定で、第三者エンジンのGPL条件とは別の判断。CIには本番Secretsを渡さない。
- 私的な記録を保存するブラウザlocalStorage／D1の互換性を壊さない。移行は後方互換とバックアップ手順を設ける。

## Claudeに期待する作業

1. ユーザーの到達目標を `docs/PRODUCT_VISION.md` から把握し、既存を壊さず小さなマイルストーンで開発する。
2. 最初の技術的優先事項は、**将棋ルール／棋譜の正確性**と、**USI対応の強い将棋エンジンの候補比較**。エンジンを独立したアダプター／プロセスに分け、人間らしい棋力・棋風を`rival policy`で制御する構造が方針として承認済み。特定のGPLエンジンや評価関数を取り込む前に、ライセンス・結合形態・性能・スマホ/Worker適合・運用費を一次資料と実測で検証する。
3. 「人間らしさ」はランダム悪手ではなく、局面理解・実力適応・戦型選択・棋風の一貫性で設計し、数値評価する。
4. 教材は `講義 → 盤上練習 → 実戦 → 感想戦 → 定着確認` を基本単位にし、対局で見えた弱点を適切な教材へ結ぶ。
5. AI会話で分からない局面は分からないと答える。勝敗はデータを根拠にする。人格設定や長期記憶はユーザーが管理・消去できる設計にする。
6. 完了時に**コードと台帳を同じコミットで更新**する。作業を横断する場合はID付きの依存関係を記録する。中断時は次に何をすべきか1つ以上残す。
7. Claude Codeのクラウド環境では`main`に直接pushせず、作業ブランチにpushしPRを作る。CIが通れば許可条件内のみ自動マージされる。GitHubプロキシのGraphQL制限等でPR作成を完了できない場合はREST経路を確認し、勝手な直接pushで代替しない。

## 初回セッションの推奨手順

```sh
git status --short --branch
npm ci
npm run ledger:check
npm run public:check
npm run test:unit
npm run lint
npx tsc --noEmit
npm run build
```

その後、台帳 `KIF-010`（ルール正確性）または `KIF-020`（エンジン選定）を小さく進め、エビデンスと残課題を残す。**GitHub Public方針は決定済み**だが、Siteの外部公開・新規の有料契約・コスト上限増加・実データの外部送信は事前相談する。

## 引継ぎ時に必ず書くサマリー

```text
最終コミット:
完了済みIDと検証証拠:
作業中／ブロック中のID:
設計・予算・権限上の未決事項:
データ／本番環境への影響:
次担当が最初に実行するコマンドとタスク:
```

共通の正本は `docs/ledger/`。ChatGPTもClaudeも同じ形式で更新する。
