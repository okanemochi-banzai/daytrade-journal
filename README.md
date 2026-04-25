# 📊 Daytrade Journal

スマホ完結でデイトレを振り返るための、ビルド不要の最小構成サイト。

[**🌐 Live Demo**](#) ← GitHub Pages を有効化したらここに自分のURLを書く

---

## ✨ 特徴

- ✅ **ビルド不要** — `index.html` 1枚 + CSV だけ
- ✅ **SBI証券のCSV対応** — 約定履歴をそのまま読み込めます（Shift-JIS自動対応）
- ✅ **GitHub Pages対応** — リポジトリにプッシュするだけで公開
- ✅ **モバイルファースト** — スマホブラウザでサクサク動作
- ✅ **複数銘柄に自動対応** — どの銘柄でも勝率・ペイオフレシオを計算

---

## 🚀 セットアップ（5分）

### 1. このリポジトリをForkする
画面右上の「Fork」ボタンから自分のアカウントにコピー。

### 2. GitHub Pagesを有効化
1. リポジトリの **Settings** → **Pages** を開く
2. **Source** を `Deploy from a branch` に設定
3. **Branch** を `main` / `(root)` に設定
4. 数分待つと `https://あなたのID.github.io/daytrade-journal/` で公開される

### 3. CSVをアップロードする
SBI証券の約定履歴CSVを、リポジトリの `data/` フォルダに以下の命名で配置：

```
data/2026-04-24.csv
```

ファイル名は **`YYYY-MM-DD.csv`** 形式にすると、その日付のページが自動表示されます。

---

## 📱 SBI証券のCSV取得方法（スマホから）

スマホアプリには出力機能がないので、**ブラウザでPC版サイト**を使います。

1. Safari/Chromeで `sbisec.co.jp` にログイン（PC版表示で）
2. 「口座管理」→「取引履歴」→「約定履歴」
3. 期間を指定して「照会」
4. 「CSVダウンロード」ボタンをタップ
5. ファイル（`SaveFile_xxxxxx.csv`）が保存される
6. リネームしてGitHubにアップロード

### スマホからGitHubにアップする方法

- **GitHub公式アプリ**：リポジトリ→`data/`→「Add file」→「Upload files」
- **ブラウザ**：github.comでも同じ操作が可能
- **Working Copy（iOS）**：高機能Gitクライアント

---

## 📂 リポジトリ構成

```
daytrade-journal/
├── index.html           # メインアプリ（これ1ファイルで動く）
├── data/
│   ├── 2026-04-24.csv   # SBIからダウンロードしたCSV
│   └── ...
└── README.md
```

---

## 🔧 表示の切り替え

ブラウザのURLパラメータで読み込みCSVを指定できます：

```
https://あなたのID.github.io/daytrade-journal/?csv=data/2026-04-24.csv
```

未指定の場合、以下の順で自動探索：
1. `data/{今日の日付}.csv`
2. `data/2026-04-24.csv`（サンプル）
3. `data/latest.csv`

---

## 🎯 今後の拡張アイデア

- [ ] 価格データを Yahoo Finance API から自動取得 → ローソク足表示
- [ ] 移動平均線・ボリンジャーバンド表示
- [ ] 複数日の累計損益チャート
- [ ] カレンダーUI で過去の振り返り一覧
- [ ] 月次・年次サマリー
- [ ] 銘柄別の勝率分析
- [ ] CSV → JSON 変換のビルドスクリプト（GitHub Actions）

---

## 🐛 動かないとき

- **CSVが文字化けする** → SBIのCSVは Shift-JIS。本ツールは自動対応していますが、別の証券会社のCSVは別途パーサが必要
- **GitHub Pagesで表示されない** → Settings → Pages の設定確認、5〜10分待つ
- **スマホからファイルアップロードできない** → GitHub公式アプリを使うのがおすすめ

---

## 📄 License

MIT — お好きに使って改造してください。
