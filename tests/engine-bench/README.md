# エンジン実測ハーネス（KIF-020、手動実行）

CIや`npm run test:unit`では実行しない。**第三者のエンジン・評価関数はこのリポジトリに入れない**（ADR-010）。リポジトリ外の一時ディレクトリでビルド・取得し、パスを環境変数で渡す。

- 各エンジンは独立したUSIプロセスとして起動する。
- エンジンの指し手はすべて棋友の`legalMoves`で合法性を検証し、勝敗は棋友の`playMove`で判定する。不正手は`illegal:<engine>:<move>`として記録する（ルール実装の相互検証を兼ねる）。
- 比較条件: 1スレッド、ハッシュ64MB、`go movetime`固定、短い序盤6種を先後入替えで使用。

## 2026-11-15の実行条件

| 項目 | 値 |
| --- | --- |
| マシン | Claude Codeクラウド、4 vCPU（AVX2/AVX-512/BMI2）、16GB |
| YaneuraOu | `yaneurao/YaneuraOu` `2bc64b48827a`（2026-11-14）。`make normal COMPILER=g++ TARGET_CPU=AVX2 YANEURAOU_EDITION=YANEURAOU_ENGINE_MATERIAL`（評価関数ファイル不要の駒得版） |
| Fairy-Stockfish | `fairy-stockfish/Fairy-Stockfish` `014b0775c0e2`（2026-11-15）。`make build ARCH=x86-64-bmi2 largeboards=yes` |
| 将棋NNUE | `shogi-9ab5e57f31d0.nnue`（Fabian Fichter、2026-11-03、配布ページの記載でCC0）。SHA-256先頭がファイル名と一致 |

## 実行

```sh
KIFU_YANEURAOU=<path>/YaneuraOu-by-gcc KIFU_FAIRY=<path>/stockfish KIFU_FAIRY_NNUE=<path>/shogi-9ab5e57f31d0.nnue \
  node tests/engine-bench/run.mjs          # 全66局（約50分）
node tests/engine-bench/run.mjs --quick    # 各対戦2局
```

結果は`.sites-runtime/engine-bench/out/`（Git管理外）。

## 自作USIアダプターを使うWASM試作（2026-11-16）

`lib/engine/usi-adapter.ts`と`lib/engine/rival-policy.ts`を実際のWASMに接続する。第三者の配布物は**リポジトリ外**に置く。通常のunit/CIは偽の通信相手でアダプターを検証し、このパッケージをダウンロードしない。アプリの通常ビルドにはエンジンもこの計測ページも入らない。

例（リポジトリのルートで実行）:

```sh
# 作業用ディレクトリはリポジトリ外。インストール用scriptは実行しない。
engine_lab=$(mktemp -d)
npm pack fairy-stockfish-nnue.wasm@1.1.12 --ignore-scripts --pack-destination "$engine_lab"
tar -xzf "$engine_lab/fairy-stockfish-nnue.wasm-1.1.12.tgz" -C "$engine_lab"

# 1スレッド、Hash16MB、NNUE無効、MultiPV3。合成の3序盤を先後入替え。
KIFU_FAIRY_WASM_DIR="$engine_lab/package" \
  node tests/engine-bench/run-wasm-prototype.mjs --games 6 --movetime 100

# PCのローカル計測ページ。Ctrl+Cで停止。
KIFU_FAIRY_WASM_DIR="$engine_lab/package" \
  node tests/engine-bench/browser-preview.mjs
```

Node 24.22.1で実測。Node側では`wasmBinary`に読み込んだバイト列を渡し、古いラッパーの`fetch(file:)`を使わない。結果は`.sites-runtime/engine-prototype/results.json`へ保存する。初回測定の要約は[`wasm-prototype-results.json`](./wasm-prototype-results.json)に固定している。そこにある6勝0敗はNode WASMでの結果で、ブラウザ・iPhoneでの測定結果ではない。Lv.4は既存アルゴリズムのままなので、思考時間を等しくした比較ではない。

### PCブラウザでの操作

`http://127.0.0.1:8879/`を開く。サーバーはループバックだけで待ち受け、COOP/COEPを設定し、計測用の自作コードと指定したエンジンだけを配信する。棋友のlocalStorage・D1・APIには接続しない。

1. 「0.1秒解析」「0.5秒解析」「1秒解析」で初期局面の候補手と評価を確認する。初回だけ起動時間がかかる。
2. 解析中に「操作の応答を確認」を押し、回数が増えるか確認する。
3. 解析中に「中断」を押す。次の解析は新しいWorkerを作り直す。
4. コンソールで`await window.kiyuEngineProbe.cancellationProbe()`を実行すると、5秒の探索を25ms後に中断して応答時間を測る。その後`await window.kiyuEngineProbe.probe(100)`で再起動を確認できる。

各解析は合成の初期局面のみ。`strong`/`balanced`/`practice`の選択結果は仮設定の比較で、段級位ではない。PCブラウザの応答性とiPhone実機での起動・電池・発熱は別に測定する。iPhoneからPCのHTTPのLANアドレスへ接続するだけでは`SharedArrayBuffer`の要件を満たさないため、信頼されたHTTPSとCOOP/COEPの計測環境が別途必要になる。

### 検証する異常系

アダプターは不正な着手・入玉宣言、古い局面の結果、期限超過、通信失敗を拒否する。中断時にUSIの`stop`だけで再利用せずWorkerごと終了するのは、識別子のない遅延`bestmove`を次の要求へ混ぜないためである。新しいWorkerを作れば再開できる。通常の対局は`position startpos moves ...`、独自開始局面は手数フィールド付き`position sfen ...`を送る。独自開始局面以前の履歴はエンジンへ渡せないため、終局は引き続き棋友側で判定する。

配布物をユーザーへ提供する前に、[`ENGINE_INTEGRATION_PLAN.md`](../../docs/ENGINE_INTEGRATION_PLAN.md)の採用・権利・実機確認の残条件を満たす。`npm pack`したエンジンや展開先はコミットしない。

## 強さのベンチマーク（2026-11-18、KIF-022）

`run-strength-bench.mjs`は、アプリと同じ`EngineRival`と着手選択層を使い、2人の対局者を**16種の序盤×先後入替え（既定32局）**で対局させ、全着手を深い参照探索で採点する。旧`run-policy-ladder.mjs`（3序盤・6局、思考時間で制御）を置き換えた。エンジンはリポジトリ外。

```sh
KIFU_FAIRY_WASM_DIR=/path/outside/repo/package \
  node tests/engine-bench/run-strength-bench.mjs --pair tier:balanced:tier:practice \
  [--purpose win|close-game|finish-practice] [--style balanced|active|solid] \
  [--audit-nodes 200000] [--jobs 4] [--openings 16] [--max-plies 256] [--source <lib/を含む別ディレクトリ>]
```

- 対局者: `tier:<強さ>[/<棋風>[/<目的>]]`（アプリの設定）、`nodes:<N>`（N局面読んだエンジンの最善手。基準点）、`builtin:<1-4>`（内蔵AI。乱数は手ごとに固定の種）。
- **再現性**: 探索は局面数（nodes）で打ち切り、1スレッド・手ごとにハッシュを消去するので、同じ条件なら機械や負荷に関係なく同じ棋譜になる。時間の安全上限に達した探索は`capHits`に数える（0なら完全に再現）。
- **採点**: `--audit-nodes`を付けると、各局面を参照探索（MultiPV1）で評価し、着手の損失＝着手前の評価＋着手後の相手側評価（cp、詰みは±(10000−手数)）を計算する。既に大差（±2000以上）の局面は除き、平均損失（1手1000で頭打ち）、150以上（疑問手）、300以上（悪手）、1000以上（大悪手）の件数を出す。棋風の確認用に取る手・王手・成り・打つ手の割合も出す。
- 成績は引分け・手数打切りを0.5勝とし、95%区間はWilsonの近似。Elo差は勝率からの換算で、段級位ではない。
- 結果は`.sites-runtime/engine-bench/strength/<label>.json`（Git管理外。全棋譜・着手ごとの損失を含む）。要約は`docs/INTEGRATION_STATUS.md` §4。

## 設定どうしの対局（2026-11-16、KIF-022。旧方式・置換済み）

旧`run-policy-ladder.mjs`は、3序盤×先後の6局を思考時間で制御して対局させていた。思考時間は機械と負荷で変わり再現できず、局数も少なかったため、2026-11-18に上記`run-strength-bench.mjs`へ置き換えて削除した。当時の結果（本気が他の2設定に各6勝0敗、互角と練習は3勝3敗）は`docs/INTEGRATION_STATUS.md` §4の履歴として残す。
