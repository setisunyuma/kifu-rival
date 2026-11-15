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
