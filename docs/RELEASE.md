# GitHub `main` → Private Site リリース手順（KIF-003）

作成: 2026-11-15（Claude）。**正本はGitHub `main`**、実行先は本人限定のPrivate ChatGPT Site。GitHubへのマージではSiteは変わらない。Siteへの反映は、Sites権限を持つ側（現状はChatGPT）が以下の手順で**明示的に**行う。

この手順は公開範囲・課金・D1スキーマを変えない。変える必要が出たら中断し、ユーザーの承認を取る。

## 役割

| 役割 | 担当 | できること／できないこと |
| --- | --- | --- |
| 準備 | Claude（GitHub書込権限あり） | リリース候補SHAの選定、`release plan`と`manifest`の作成、台帳記録。**Sitesへの配備権限はない** |
| 配備 | ChatGPT（Sites権限あり） | Sitesソースへの反映、`verify`、ビルド、Privateのままデプロイ、アクセス設定の確認、ロールバック |
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
| `none` | 文書・テスト・CIのみ。配信物は変わらない | 配備は任意 |
| `app` | 画面・将棋ロジック・教材の変更 | 通常リリース。§2へ |
| `runtime` | API・Worker・依存関係・ビルド設定・配信ファイルの削除 | `npm run build`と`npm start`でビルド済みWorkerを確認してから§2へ |
| `data` | D1マイグレーション・スキーマ・hosting binding・認証・localStorageキーの変更 | **中断**（終了コード2）。§データ の条件をユーザーが承認するまで配備しない |

## 2. マニフェスト作成（準備担当）

候補SHAをクリーンにチェックアウトした状態で実行する。

```sh
npm run release:manifest -- --out outputs/release-<short-sha>.json
```

`outputs/`はGit管理外。マニフェストは追跡ファイル全件のSHA-256で、コミットSHAを含む。秘密情報は入らないが、Siteの実データも入らない。配備担当へはファイルを渡すか、同じコマンドを配備側で再実行してもらう（決定的なので同じ結果になる）。

## 3. Sitesソースへの反映と照合（配備担当）

1. Public GitHubから候補SHAを取得する（`git clone https://github.com/setisunyuma/kifu-rival` → `git checkout <sha>`、または同SHAのアーカイブ）。
2. Sitesソースのチェックアウトへ内容を反映する。**削除されたファイルも反映する**（例: `rsync -a --delete --exclude .git --exclude node_modules --exclude .sites-runtime --exclude .wrangler <github-checkout>/ <sites-checkout>/`）。Sites側の`.git`は残す。
3. 照合する。

```sh
node scripts/release.mjs verify outputs/release-<short-sha>.json --root <sites-checkout>
```

`verify: OK`以外ならデプロイしない。`extra`（Sitesにだけ存在するファイル）が出たら、Sites側で独自に編集された内容がある可能性がある。**GitHubを正本とするため、必要な変更はGitHubへPRで取り込んでから**やり直す。

4. Sitesソースにコミットする。メッセージに`GitHub <full-sha>`を含める。

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
2. `--base`には、GitHubへ移管した最初のコミット`992fdd0c50ad5316dd8621b94ddffd271844ef19`を使い、変更の分類を確認する。移管後の変更は主に文書・CI・`lib/shogi.ts`（千日手）・テストで、D1やAPIの変更はない（2026-11-15時点。実行時に再確認する）。
3. §3の`verify`で`extra`や`changed`を見て、Sites側にしかない変更がないか確かめる。ある場合はGitHubへ取り込んでからやり直す。
4. 以降は通常の手順に従う。

## リリース記録

| 日付 | GitHub SHA | Site version | 判定 | verify | アクセス事後確認 | 動作確認 | 戻し先 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| （未実施） | | | | | | | |
