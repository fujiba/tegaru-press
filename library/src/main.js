/**
 * @fileoverview Google Docs to GitHub Markdown Publisher - Library
 * @version 4.3.0
 * Refactored to separate concerns into multiple files for better maintainability.
 * This file now acts as the main entry point and orchestrator.
 */

// NOTE: 実装ロジックは以下のファイルに分離されました：
// - Security.js: 暗号化/復号化
// - Settings.js: 設定管理
// - DocumentParser.js: ドキュメント解析
// - MarkdownBuilder.js: Markdown生成
// - GitHubApi.js: GitHub通信

/**
 * Main function to execute the push process. (Public API)
 * @param {GoogleAppsScript.Document.Document} doc The Google Document object to process.
 * @param {Array<string>|null} selectedTabIds An array of tab IDs to push. If null, the main body is used.
 */
function push(doc, selectedTabIds) {
  // Settings.jsから呼び出し（復号対象のトークンが必要なため内部用を使う）
  const settings = getSettingsInternal_();

  // DocumentParser.jsから呼び出し
  const allDataObjects = buildAllDocumentData_(doc, selectedTabIds);

  if (allDataObjects.length === 0) {
    throw new Error("Pushするコンテンツがありません。");
  }

  // 下のローカル関数呼び出し
  pushDataObjects_(allDataObjects, settings);
}

/**
 * Processes and pushes an array of data objects to GitHub.
 * @private
 */
function pushDataObjects_(dataObjects, settings) {
  const allFilesToCommit = [];
  const contentRoot = settings.CONTENT_ROOT_PATH || "";

  dataObjects.forEach((dataObject) => {
    if (!dataObject.frontMatter.file_path) {
      throw new Error("An item was passed without a 'file_path' in its front matter.");
    }

    const finalPath = [contentRoot, dataObject.frontMatter.file_path].filter(Boolean).join("/");
    const markdownFilePrefix = finalPath
      .split("/")
      .pop()
      .replace(/\.[^/.]+$/, "");
    const imageSubDir = settings.IMAGE_PATH || "images";
    const markdownDir = finalPath.includes("/")
      ? finalPath.substring(0, finalPath.lastIndexOf("/"))
      : "";

    // MarkdownBuilder.jsから呼び出し
    const { markdown, images } = convertDataToMarkdown_(
      dataObject,
      markdownDir,
      imageSubDir,
      markdownFilePrefix,
    );

    if (!markdown) return; // Skip empty sections

    // 画像ファイルの追加
    images.forEach((imageFile) => {
      allFilesToCommit.push({
        path: imageFile.path,
        content: imageFile.bytes,
        isBinary: true,
      });
    });

    // Markdownファイルの追加
    allFilesToCommit.push({
      path: finalPath,
      content: markdown,
      isBinary: false,
    });
  });

  if (allFilesToCommit.length === 0) {
    throw new Error("No content to push.");
  }

  const commitMessage =
    settings.COMMIT_MESSAGE || `Update ${allFilesToCommit.length} file(s) from Google Docs`;

  // GitHubApi.jsから呼び出し
  pushFilesAsSingleCommit_(allFilesToCommit, commitMessage, settings);
}

/**
 * Returns the generated Markdown for preview purposes. (Public API)
 * @param {GoogleAppsScript.Document.Document} doc The Google Document object to process.
 * @param {string|null} selectedTabId The ID of the tab to preview.
 * @return {string} The generated Markdown content.
 */
function getMarkdown(doc, selectedTabId) {
  // DocumentParser.jsから呼び出し
  const dataObject = buildDocumentData_(doc, selectedTabId);
  // MarkdownBuilder.jsから呼び出し
  const { markdown } = convertDataToMarkdown_(dataObject, "", "images", "preview");
  return markdown;
}

// --- Execution Functions (Called from Caller Handlers) ---

/**
 * フロントマターのテンプレートテーブルをドキュメントに挿入する実行関数。
 * @param {object} formObject UIから渡されるフォームデータ { title: string, date: string }
 */
function executeInsertFrontMatter(formObject) {
  try {
    const { title, date } = formObject;
    if (!title || !date) {
      throw new Error("タイトルと公開日時を入力してください。");
    }

    // --- データ生成ロジック ---
    const dateObj = new Date(date);
    const formattedDate = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyyMMdd");
    const slug = title
      .toLowerCase()
      .replace(/\s+/g, "-") // スペースをハイフンに置換
      .replace(/[\\/?%*:|"<>.]/g, "-") // ファイルパスとして不適切な文字をハイフンに置換
      .replace(/--+/g, "-") // 連続するハイフンを1つにまとめる
      .replace(/^-+|-+$/g, ""); // 先頭と末尾のハイフンを削除
    const filePath = [`${formattedDate}-${slug}`, "index.md"].filter(Boolean).join("/");
    const formattedDateTime = Utilities.formatDate(
      dateObj,
      Session.getScriptTimeZone(),
      "yyyy/MM/dd HH:mm:ss",
    );
    // --- データ生成ロジックここまで ---

    const body = DocumentApp.getActiveDocument().getBody();

    // 既存のテーブルチェック
    if (body.getChild(0).getType() === DocumentApp.ElementType.TABLE) {
      throw new Error("このドキュメントには既にフロントマターテーブルが存在します。");
    }

    const tableData = [
      ["キー", "値", "説明"],
      ["file_path", filePath, "サイトのルートからのファイルパス (例: posts/my-post.md)(*必須)"],
      ["title", title, "記事のタイトル(*必須)"],
      ["subtitle", "", "記事のサブタイトル（任意）"],
      ["description", "", "SEOや検索結果に表示される説明文(任意)"],
      ["summary", "", "記事一覧などで表示される短い要約(任意)"],
      ["authors", "", "著者名 (複数名はカンマ区切り)(任意)"],
      ["tags", "", "タグ (複数指定はカンマ区切り)(任意)"],
      ["categories", "", "カテゴリ (複数指定はカンマ区切り)(任意)"],
      [
        "date",
        formattedDateTime,
        "公開日時 (例: 2023/10/27 10:00)。空欄の場合はPush時の日時。(*必須)",
      ],
      ["draft", "false", "'true'にすると下書き扱いになります(*必須)"],
    ];

    const table = body.insertTable(0, tableData);
    body.insertParagraph(1, ""); // テーブルの後に空の段落を挿入

    // スタイル設定
    const headerRow = table.getRow(0);
    for (let i = 0; i < headerRow.getNumCells(); i++) {
      const cell = headerRow.getCell(i);
      cell.setBackgroundColor("#F3F3F3");
      cell.getChild(0).asParagraph().setBold(true);
    }

    for (let i = 1; i < table.getNumRows(); i++) {
      const cell = table.getRow(i).getCell(2);
      const paragraph = cell.getChild(0).asParagraph();
      paragraph.setForegroundColor("#666666");
      paragraph.setItalic(true);
    }

    table.setBorderColor("#DDDDDD");

    // タイトルを見出し1として挿入
    const h1 = body.insertParagraph(2, title);
    h1.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  } catch (e) {
    DocumentApp.getUi().alert(`フロントマターの挿入中にエラーが発生しました:\n${e.message}`);
  }
}

/**
 * TabSelectionDialogから呼び出されるPush実行関数。 (Public API for google.script.run)
 * @param {Array<string>|null} selectedTabIds 選択されたタブIDの配列。
 */
function executePushFromDialog(selectedTabIds) {
  try {
    const doc = DocumentApp.getActiveDocument(); // このコンテキストでdocを取得
    push(doc, selectedTabIds);
    DocumentApp.getUi().alert("コンテンツのPushが完了しました。");
  } catch (e) {
    Logger.log(e);
    DocumentApp.getUi().alert(`Push中にエラーが発生しました:\n${e.message}`);
  }
}

/**
 * TabSelectionDialogから呼び出されるプレビュー実行関数。
 * (Public API for google.script.run)
 * @param {string|null} selectedTabId 選択された単一のタブID。
 */
function executePreviewFromDialog(selectedTabId) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const tabId = Array.isArray(selectedTabId) ? selectedTabId[0] : selectedTabId;

    // MarkdownBuilder.jsから呼び出し
    const { markdown, images } = getPreviewData_(doc, tabId);

    if (!markdown || markdown.trim() === "---") {
      DocumentApp.getUi().alert("ドキュメントが空か、フロントマターしかありません。");
      return;
    }

    const imagePayload = images.map((image) => {
      let mimeType = "image/jpeg";
      if (image.path.toLowerCase().endsWith(".png")) {
        mimeType = "image/png";
      } else if (image.path.toLowerCase().endsWith(".gif")) {
        mimeType = "image/gif";
      }
      return {
        path: `./${image.path}`,
        data: `data:${mimeType};base64,${Utilities.base64Encode(image.bytes)}`,
      };
    });

    // HTMLテンプレートをファイルから読み込む！ここが今回の外出しポイント！
    const template = HtmlService.createTemplateFromFile("PreviewDialog");
    template.content = markdown;
    template.images = JSON.stringify(imagePayload);

    const htmlOutput = template.evaluate().setWidth(1050).setHeight(750);
    DocumentApp.getUi().showModalDialog(htmlOutput, "Markdown プレビュー");
  } catch (e) {
    Logger.log(e);
    DocumentApp.getUi().alert(`プレビュー中にエラーが発生しました:\n${e.message}`);
  }
}
