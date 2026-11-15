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
