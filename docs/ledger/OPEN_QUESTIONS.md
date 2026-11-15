# 未決事項／承認待ち

重要な決定があるまで技術調査・既存データを触らない実験・ドキュメント整備は可能。ただし外部への公開・費用発生・破壊的変更へ勝手に進まない。

| ID | 状態 | 確認事項 | オーナー | 影響する作業 | 次の確認 |
| --- | --- | --- | --- | --- | --- |
| Q-001 | RESOLVED | Claudeが接続する**Public GitHub repo**の作成とURL。可視性はADR-007で解決済み | User | KIF-002, KIF-003, KIF-061 | 2026-11-15 GitHubコネクタで`setisunyuma/kifu-rival`のPublic・管理権限・size=0を確認。ソース移管・Claude cloneはKIF-002で別途検証 |
| Q-002 | OPEN | 棋力の対象帯と難易度調整（例えば棋力の目標、使用する強さ基準） | User / Claude | KIF-022 | 実力測定のプロトコルを先に提案 |
| Q-003 | OPEN | USI分離方針は採用済み。具体的なエンジン・実行場所・付属データライセンスの選択 | Claude調査 → User判断 | KIF-020, KIF-021, KIF-024 | 候補比較・実測・個別ライセンスレビューの後、選択 |
| Q-004 | OPEN | 会話LLMの提供元、月額コスト上限、送信可能な棋譜／会話の範囲 | User | KIF-040, KIF-041 | 費用・データ設計を提示して選択 |
| Q-005 | OPEN | 長期記憶の保持期間、削除/エクスポート、機器間同期 | User | KIF-041, KIF-050 | プライバシーとバックアップ方針を提示 |
| Q-006 | OPEN | 大規模教材の品質監修と外部棋譜・問題集の権利処理 | Claude調査 → User判断 | KIF-030, KIF-031 | 原著作物の無断転載をしない。自作・許諾済みデータの経路を比較 |
| Q-007 | RESOLVED | GitHub Publicは認めるが、試作Site自体を外部公開するか | User | KIF-003 | **当面は本人限定Private**（ADR-007）。将来外部公開を検討するときは新たな承認を取る |
| Q-008 | OPEN | 棋友が独自に書いたコードのルート`LICENSE`を何にするか | User / Claude提案 | KIF-002, KIF-024 | Publicでも著作権の利用許諾は自動で付与されない。外部エンジンの条件と将来像を照合して判断 |
| Q-009 | OPEN | 自動マージのGitHub Actions実行、workflow_runの`base.sha`実測、`main`のruleset設定・検証 | ChatGPT / Claude | KIF-061, KIF-063 | 最初の同一repo安全PR・要手動PRを実地検証し、GitHub SettingsでPR必須・`verify`必須のrulesetを設定 |

`OPEN` のままでも実装できるタスクを切り分け、無用な停止を避ける。決着したら `RESOLVED` としてADRへの参照を追加し、行は削除しない。
