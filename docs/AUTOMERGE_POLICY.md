# 棋友の自動PRマージ — Claude Code / ChatGPT共通

開始: 2026-11-15。ユーザーは**安全な変更のPR作成・検証・マージを可能な限り無人化**する方針を承認（ADR-009）。公開GitHubの`main`が開発正本であり、本人限定のChatGPT Siteへのデプロイとは別。

## 無人で進む経路

1. Claude Code（またはChatGPT）が`main`から作業ブランチを作る。**`main`に直接pushしない**。作業IDと証拠を`docs/ledger`に保存する。
2. 本人のGitHubアカウントによる**同一リポジトリ内PR**を開く。`Source validation`が読取専用で公開・台帳・17単体テスト・lint・型・buildを実行する。
3. CI成功イベントを受ける`Guarded auto-merge`は、**信頼済み`main`からのみ**コードを読み込む。PR由来のコードや成果物をprivileged jobへ持ち込まない。
4. `scripts/guarded-auto-merge.mjs` がPRとCIの双方のAPI情報を照合し、下記条件をすべて満たす場合だけRESTの`sha`指定で`squash merge`する。元ブランチの削除はGitHub設定に委ねる。
5. **GitHubにマージされてもChatGPT Siteは自動で変わらない**。SiteのPrivate権限・D1・実棋譜はそのまま。

## 自動マージの条件（すべて必須）

- 検証元は`.github/workflows/verify.yml`、`pull_request`由来の**成功**run。
- PR作成者は`setisunyuma`、head/baseとも`setisunyuma/kifu-rival`、baseは`main`。フォークや他人のPRは自動マージしない。
- draftでなく、GitHubがmergeableを確認できる。PRに`manual-review`/`no-auto-merge`ラベル、または`[manual]`タイトルがない。
- CI実行時のhead SHAとbase SHAが現在のPRと**完全一致**。GitHubがCI payloadにbase SHAを載せない場合、**保留**する。
- GitHubの現在のテストマージコミットの親が現在のbase・headと一致。
- 変更ファイル数は30以内、追加＋削除行は合計1200以内、削除/名称変更なし。
- 編集対象は `README.md`、一部の`app/*.tsx` / CSS、`components/`、`hooks/`、既存の`lib/shogi.ts` / `lib/lessons.ts` / `lib/rival-chat.ts` / `lib/utils.ts`、`tests/`、一部の設計書・作業台帳。実装とテストは同じPRに含める。

**常に手動のPR承認/マージが必要**: `.github/`（自動化自身）、`scripts/`、`AGENTS.md`、`CLAUDE.md`、`docs/OPERATIONS.md`、`docs/PRODUCT_VISION.md`、`docs/ledger/DECISIONS.md`、認証、API、DB、マイグレーション、Worker、`package.json`/lockfile、公開設定、`LICENSE`、外部エンジンや未監査の新ライブラリ・画像等。コード中の正確な判定は`scripts/guarded-auto-merge.mjs`を正本とする。

**品質の限界**: 全CI成功は将棋ルールの完全性・UI実機確認・ライセンス適法性を証明しない。新機能を本番公開する前に変更種別に応じた検証と最終承認を行う。`KIF-060`等のE2Eが未完のため、現段階で自動マージ対象は限定している。

## Claudeへの具体的指示

- タスクごとに`claude/<短い説明>`等の作業ブランチを切り、必ずPRを作る。手動クリックを前提にせず、まずCIと自動マージの結果を確認する。
- 自動マージ条件を満たせないPRは**失敗ではない**。PRを残したまま、何の条件で止まったかと次の判断を`SESSION_LOG`に書く。拒否された条件を迂回するために変更を偽装・分割しない。
- CI失敗時は修正コミットをpushし、再検証する。すでに走った古いCIの成功結果を再利用しない。
- エンジンの採用・第三者コード、データ破壊、課金、Site外部公開は従来どおり本人の判断を要求する。
- マージ後に次の作業へ移る際は`main`最新を取得し、重複作業や並行ブランチ間の衝突を解消する。共有台帳は`main`にある記録だけを正本とする。

## GitHub設定の二重防御

推奨（GitHub Freeの**Publicリポジトリ**で利用可能）：`Settings → Rules → Rulesets`で`main`に対し、**PR経由の変更必須**、**`verify`ステータスの成功必須**、force push禁止、branch削除禁止を有効にする。初回CIで`verify`が現れてから実際のチェック名を選択する。手動レビューを全件必須にすると無人マージは止まるため、機密・高リスクのレビュー要件は本自動化の許可条件と運用で代替し、追加の保護を希望する場合は方針を更新する。

`Settings → General → Pull Requests`の`Automatically delete head branches`を有効にするとマージ後の不要ブランチを自動削除できる（自動化スクリプト自身は削除しない）。GitHubの`Allow auto-merge`は各PRで有効化が必要な**別方式**であり、この`squash merge`ワークフローの動作には不要。

## 導入検証状態

2026-11-15、GitHubへの147ファイルimport・初回CI・本人作成の安全PR #1について**`Source validation`成功→`Guarded auto-merge`成功→squash merge**を実地確認した。GitHubの`workflow_run` payloadではhead/base SHAが取得できた。詳細は`SESSION_LOG.md`を参照。

またPR #2（`[manual]`、重要指示書を含む）ではCIが成功しても自動マージを保留し、実行ログで`Manual review`を確認した。その後に内容を確認し手動マージした。PR #3の台帳更新はCI成功後に自動マージされた。

ただし**main Rulesetの保護、Claude Codeクラウドからの実操作**は未完了。これらの条件がすべて終わるまで`KIF-063`を`VERIFIED`にしない。GitHubの`workflow_run`でbase SHAが欠落する別ケースは意図的に保留する。**CI成功やマージ済みの範囲を誇張しない**。
