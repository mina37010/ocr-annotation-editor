# OCR Annotation Editor

IIIF Presentation API 3.0 ManifestまたはPDFと、全ページ統合OCR TSVをブラウザ内で校正するReact SPAです。元Manifest、PDF、TSVは変更せず、校正結果を新しい統合TSVまたはIIIF AnnotationCollection JSONとして出力します。

## 必要環境

- Node.js 20以降
- npm 10以降
- URLから読む場合はManifest、PDF、TSV、IIIF Image APIサーバーからブラウザへのCORS許可

## 起動

```bash
npm install
npm run dev
```

`http://localhost:5174`を開き、`IIIF Manifest`または`PDF`を選んで、画像入力とOCR TSVを指定します。ファイル選択とURL指定の両方に対応します。

## ビルドとテスト

```bash
npm test
npm run test:e2e
npm run build
npm run preview
```

テストは以下を確認します。

- 指定された実Manifestの42 CanvasとImageService3解析
- PDFのページ描画とTSVページ対応
- Canvas範囲外への配置防止
- Canvas座標、`target #xywh`、`source_*`の同期
- ID重複の拒否
- タブ、改行、引用符、未知列を含むTSVラウンドトリップ
- ファイル読込、双方向選択、編集、Undo/Redo、TSVダウンロードのブラウザ操作

## TSV

TSVの各行を1 Annotationとして扱います。Manifestモードでは`canvas_id`をCanvas `id`と完全一致で結合します。PDFモードではTSVの`page`列でPDFページを特定し、そのページに記録された既存`canvas_id`をページIDとして維持します。OCR行のないPDFページだけ`urn:pdf:<PDFのSHA-256>/page/<ページ番号>`形式の内部IDを使用します。

入力列の順序と未知の追加列を維持します。`source_x/source_y/source_w/source_h`列が存在する場合、文字領域の変更時に画像寸法とCanvas寸法の比率から再計算します。`cell_*`は文字領域を変更しても更新しません。同じPDFページに複数の`canvas_id`があるTSVや、同じ`canvas_id`を複数ページで使うTSVは読み込みを拒否します。

出力例:

```text
ocr_all_pages_corrected.tsv
ocr_all_pages_corrected.annotations.json
```

## 操作

- `V`: 選択・領域移動
- `N`: 領域追加
- `M`: マージ開始
- `R`: 並び替え開始
- `Enter`: マージ／並び替えを確定
- `Esc`: マージ／並び替えを中止
- `←` / `→`: ページ移動
- `Ctrl/Cmd + Z`: Undo
- `Ctrl/Cmd + Shift + Z`または`Ctrl/Cmd + Y`: Redo
- `Ctrl/Cmd + E`: TSV書き出し
- `Delete` / `Backspace`: 選択領域を削除

テキストはフォーカスを外すか`Ctrl/Cmd + Enter`で確定します。画像上の枠と右一覧は`annotation_id`で同期します。

マージでは先頭に選んだAnnotation IDと追加列を残します。2件以上を順に選択して`結合`を押します。`Esc`で中止、`Enter`でも結合できます。

並び替えでは2件以上を希望する順番で選択して`適用`を押します。未選択のAnnotationは移動しません。変更した順番はTSVの行順、JSON出力、IndexedDB自動保存へ反映されます。

## 自動保存

編集状態はManifest IDまたはPDFのSHA-256と、入力TSVのSHA-256を組み合わせたキーでIndexedDBへ保存します。同じ入力を再度開くと復元確認が表示されます。TSV書き出しまでは「未出力」として扱い、タブを閉じる際に警告します。

## CORS

URL指定のManifest、PDF、TSV、Image Serviceのいずれも、アプリのOriginからのGETを許可する必要があります。CORSで拒否された場合は画面下部または読込ダイアログにエラーを表示します。

ローカルApacheの例:

```apache
Header set Access-Control-Allow-Origin "http://localhost:5174"
```

運用環境では許可Originを実際の配信元へ変更してください。

## データ保護

- ManifestとPDFは読取専用で、アプリから書き換えません。
- 入力TSVを上書きするAPIはありません。
- 削除した行は編集履歴に残り、Undoできますが、TSV出力からは除外されます。
- 別プロジェクト読込時に未エクスポート変更がある場合は確認します。
