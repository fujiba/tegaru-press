/**
 * @fileoverview A caller script to invoke the Tegaru Press library.
 * @version 3.0.0
 * Major architectural change: This script is now responsible for parsing the
 * document into a data array, which is then passed to the library.
 */

const LIB = TegaruPress;

function onOpen() {
  DocumentApp.getUi()
    .createMenu("サイト更新")
    .addItem("GitHubへPush", "main")
    .addItem("Markdownプレビュー", "previewMarkdown")
    .addSeparator()
    .addItem("フロントマターを挿入", "insertFrontMatter")
    .addSeparator()
    .addItem("設定", "showSettingsDialog")
    .addToUi();
}

function main() {
  const doc = DocumentApp.getActiveDocument();
  const tabs = doc.getTabs ? doc.getTabs() : [];
  const flatTabs = _flattenTabs(tabs);

  if (flatTabs.length > 1) {
    // 複数タブがある場合は選択ダイアログを表示
    const htmlTemplate = HtmlService.createTemplateFromFile("TabSelectionDialog");
    htmlTemplate.tabs = flatTabs;
    htmlTemplate.action = "push";
    const htmlOutput = htmlTemplate.evaluate().setWidth(400).setHeight(350);
    DocumentApp.getUi().showModalDialog(htmlOutput, "Pushするタブを選択");
  } else {
    // タブがない、または1つだけの場合は直接実行
    _executePushForTabs(null);
  }
}

/**
 * Executes the push operation for the selected tabs.
 * This function is called from the TabSelectionDialog.
 * @param {Array<string>|null} selectedTabIds An array of tab IDs, or null if no tabs.
 */
function _executePushForTabs(selectedTabIds) {
  try {
    const allDataObjects = [];
    const doc = DocumentApp.getActiveDocument();
    const tabs = doc.getTabs ? doc.getTabs() : [];

    if (selectedTabIds && selectedTabIds.length > 0) {
      // Process selected tabs
      selectedTabIds.forEach((tabId) => {
        const documentData = _buildDocumentData(tabId);
        if (!documentData.frontMatter.file_path) {
          const tabTitle = _findTabById(tabs, tabId).getTitle();
          throw new Error(
            `タブ「${tabTitle}」のフロントマターに 'file_path' がありません。`
          );
        }
        allDataObjects.push(documentData);
      });
    } else {
      // Process the single document body
      const documentData = _buildDocumentData(null);
      if (!documentData.frontMatter.file_path) {
        throw new Error(
          "フロントマターに 'file_path' が設定されていません。ドキュメント先頭のテーブルを確認してください。"
        );
      }
      allDataObjects.push(documentData);
    }

    if (allDataObjects.length === 0) {
      throw new Error("Pushするコンテンツがありません。");
    }

    const settings = PropertiesService.getDocumentProperties().getProperties();
    LIB.push(allDataObjects, settings);
    DocumentApp.getUi().alert(`${allDataObjects.length}個のコンテンツのPushが完了しました。`);
  } catch (e) {
    Logger.log(e);
    DocumentApp.getUi().alert(`エラーが発生しました:\n${e.message}`);
  }
}

function previewMarkdown() {
  const doc = DocumentApp.getActiveDocument();
  const tabs = doc.getTabs ? doc.getTabs() : [];
  const flatTabs = _flattenTabs(tabs);

  if (flatTabs.length > 0) {
    const htmlTemplate = HtmlService.createTemplateFromFile("TabSelectionDialog");
    htmlTemplate.tabs = flatTabs;
    htmlTemplate.action = "preview";
    const htmlOutput = htmlTemplate.evaluate().setWidth(400).setHeight(350);
    DocumentApp.getUi().showModalDialog(htmlOutput, "プレビューするタブを選択");
  } else {
    _executePreviewForTab(null);
  }
}

/**
 * Executes the preview operation for a single selected tab.
 * @param {string|null} selectedTabId The ID of the tab to preview.
 */
function _executePreviewForTab(selectedTabId) {
  try {
    // The dialog passes an array, but this function expects a single ID or null.
    // Handle both cases for robustness.
    const tabId = Array.isArray(selectedTabId)
      ? selectedTabId[0]
      : selectedTabId;
    const documentData = _buildDocumentData(tabId);
    const markdownContent = LIB.getMarkdown(documentData);
    if (!markdownContent || markdownContent.trim() === "---") {
      DocumentApp.getUi().alert("ドキュメントが空です。");
      return;
    }
    const escapedContent = markdownContent
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const htmlOutput = HtmlService.createHtmlOutput(
      `<pre style="white-space: pre-wrap; word-wrap: break-word;">${escapedContent}</pre>`
    )
      .setWidth(600)
      .setHeight(450);
    DocumentApp.getUi().showModalDialog(htmlOutput, "Markdown プレビュー");
  } catch (e) {
    Logger.log(e);
    DocumentApp.getUi().alert(
      `プレビュー中にエラーが発生しました:\n${e.message}`
    );
  }
}

/**
 * Action handler for inserting a front matter table.
 */
function insertFrontMatter() {
  try {
    _insertFrontMatterTable();
    DocumentApp.getUi().alert("フロントマターのテンプレートを挿入しました。");
  } catch (e) {
    Logger.log(e);
    DocumentApp.getUi().alert(
      `フロントマター挿入中にエラーが発生しました:\n${e.message}`
    );
  }
}

/**
 * Parses the active Google Doc into a serializable data array.
 * @param {string|null} tabId The ID of the tab to parse. If null, parses the main document body.
 * @returns {{frontMatter: object, documentData: Array<object>}} An object containing front matter and document data.
 * @private
 */
function _buildDocumentData(tabId) {
  const doc = DocumentApp.getActiveDocument();
  let body;
  if (tabId) {
    const tab = _findTabById(doc.getTabs(), tabId);
    if (!tab) throw new Error(`指定されたタブ（ID: ${tabId}）が見つかりません。`);
    body = tab.asDocumentTab().getBody();
  } else {
    body = doc.getBody();
  }

  const numChildren = body.getNumChildren();
  const frontMatter = {};
  const documentData = [];
  let contentStartIndex = 0;

  // 1. Find front matter table and content start index
  for (let i = 0; i < numChildren; i++) { // This loop should only find the first table
    const child = body.getChild(i);
    if (
      child.getType() === DocumentApp.ElementType.PARAGRAPH &&
      child.asParagraph().getText().trim() === ""
    ) {
      continue; // Skip empty paragraphs at the beginning
    }
    if (child.getType() === DocumentApp.ElementType.TABLE) {
      const table = child.asTable();
      const startRow = table.getRow(0).getNumCells() === 3 ? 1 : 0; // Accommodate old and new table formats
      for (let r = 1; r < table.getNumRows(); r++) {
        const row = table.getRow(r);
        if (row.getNumCells() < 2) continue;
        const key = row.getCell(0).getText().trim();
        const value = row.getCell(1).getText().trim();
        if (key) {
          frontMatter[key] = value;
        }
      }
      contentStartIndex = i + 1;
    }
    break; // Stop after the first non-empty element
  }

  // 2. Parse document content
  for (let i = contentStartIndex; i < numChildren; i++) {
    const child = body.getChild(i);
    let elementData = null;

    switch (child.getType()) {
      case DocumentApp.ElementType.PARAGRAPH:
        const paragraph = child.asParagraph();
        // Check for image first
        const img = paragraph.findElement(DocumentApp.ElementType.INLINE_IMAGE);
        if (img) {
          const imgEl = img.getElement().asInlineImage();
          const blob = imgEl.getBlob();
          if (blob) {
            elementData = {
              type: "IMAGE",
              bytes: blob.getBytes(),
              contentType: blob.getContentType(),
              alt: imgEl.getAltDescription(),
            };
          }
        } else if (paragraph.getText().trim() !== "") { // Process as text if no image
          elementData = {
            type: "PARAGRAPH",
            text: _processTextAttributes(paragraph.asText()),
            heading: paragraph.getHeading().toString(),
          };
          // Ensure that even after processing, we don't add empty paragraphs.
          // The `text` property is now an array of segments.
          const combinedText = elementData.text.map(s => s.text).join("");
          if (!combinedText || combinedText.trim() === "") {
            elementData = null;
          }
        }
        break;

      case DocumentApp.ElementType.LIST_ITEM:
        const listItem = child.asListItem();
        if (listItem.getText().trim() !== "") {
          const glyph = listItem.getGlyphType();
          elementData = {
            type: "LIST_ITEM",
            text: _processTextAttributes(listItem.asText()),
            nestingLevel: listItem.getNestingLevel(),
            isNumbered:
              glyph === DocumentApp.GlyphType.NUMBER ||
              glyph === DocumentApp.GlyphType.LATIN_UPPER ||
              glyph === DocumentApp.GlyphType.LATIN_LOWER,
          };
        }
        break;
    }

    if (elementData) {
      documentData.push(elementData);
    }
  }

  return { frontMatter, documentData };
}

/**
 * Processes text attributes (bold, italic) for a text element.
 * This function now returns an array of text segments with their attributes.
 * @param {Text} textElement The text element from the document.
 * @returns {Array<Object>} An array of objects, e.g., [{text, attributes}].
 * @private
 */
function _processTextAttributes(textElement) {
  const text = textElement.getText();
  if (text === null || text.trim() === "") return [{ text: text, attributes: {} }];

  const attributeIndices = textElement.getTextAttributeIndices();
  const segments = [];
  let lastIndex = 0;

  // Process segments based on style changes
  for (let i = 0; i < attributeIndices.length; i++) {
    const startIndex = attributeIndices[i];
    const segment = text.substring(lastIndex, startIndex);
    const attributes = textElement.getAttributes(lastIndex);
    // We only care about a few attributes, so let's filter them.
    const relevantAttributes = {
      [DocumentApp.Attribute.BOLD]: attributes[DocumentApp.Attribute.BOLD],
      [DocumentApp.Attribute.ITALIC]: attributes[DocumentApp.Attribute.ITALIC],
      [DocumentApp.Attribute.LINK_URL]: attributes[DocumentApp.Attribute.LINK_URL],
    };
    if (segment) {
      segments.push({ text: segment, attributes: relevantAttributes });
    }
    lastIndex = startIndex;
  }

  // Process the last segment
  const lastSegment = text.substring(lastIndex);
  if (lastSegment) {
    const attributes = textElement.getAttributes(lastIndex);
    const relevantAttributes = {
      [DocumentApp.Attribute.BOLD]: attributes[DocumentApp.Attribute.BOLD],
      [DocumentApp.Attribute.ITALIC]: attributes[DocumentApp.Attribute.ITALIC],
      [DocumentApp.Attribute.LINK_URL]: attributes[DocumentApp.Attribute.LINK_URL],
    };
    segments.push({ text: lastSegment, attributes: relevantAttributes });
  }

  return segments;
}

/**
 * Inserts a template table for front matter at the beginning of the document.
 * @private
 */
function _insertFrontMatterTable() {
  const body = DocumentApp.getActiveDocument().getBody();

  // Check if a table already exists at the beginning of the document.
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (
      child.getType() === DocumentApp.ElementType.PARAGRAPH &&
      child.asParagraph().getText().trim() === ""
    ) {
      continue; // Skip empty paragraphs
    }
    if (child.getType() === DocumentApp.ElementType.TABLE) {
      throw new Error("このドキュメントには既にフロントマターテーブルが存在します。");
    }
    // Stop checking after the first non-empty, non-table element.
    break;
  }

  // Hugoの一般的なフロントマターをベースにした3列のテンプレート
  const tableData = [
    ["キー", "値", "説明"],
    [
      "file_path",
      "",
      "サイトのルートからのファイルパス (例: posts/my-first-post.md)",
    ],
    ["title", "", "記事のタイトル"],
    ["subtitle", "", "記事のサブタイトル（任意）"],
    ["description", "", "SEOや検索結果に表示される説明文"],
    ["summary", "", "記事一覧などで表示される短い要約"],
    ["authors", "", "著者名 (複数名はカンマ区切り)"],
    ["tags", "", "タグ (複数指定はカンマ区切り)"],
    ["categories", "", "カテゴリ (複数指定はカンマ区切り)"],
    [
      "date",
      "",
      "公開日時 (例: 2023/10/27 10:00)。柔軟に解釈します。空欄の場合はPush時の日時。",
    ],
    ["draft", "false", "'true'にすると下書き扱いになります"],
  ];

  // Insert table at the top of the document body.
  const table = body.insertTable(0, tableData);
  body.insertParagraph(1, ""); // Add a blank line after the table for spacing.

  // Style the table for better visibility
  const headerRow = table.getRow(0);
  for (let i = 0; i < headerRow.getNumCells(); i++) {
    const cell = headerRow.getCell(i);
    cell.setBackgroundColor("#F3F3F3"); // Light gray background
    const paragraph = cell.getChild(0).asParagraph();
    paragraph.setBold(true);
  }

  // Style the description column to be less prominent
  for (let i = 1; i < table.getNumRows(); i++) {
    const cell = table.getRow(i).getCell(2); // 3rd column
    const paragraph = cell.getChild(0).asParagraph();
    paragraph.setForegroundColor("#666666");
    paragraph.setItalic(true);
  }

  table.setBorderColor("#DDDDDD");
}

/**
 * Recursively flattens the tab structure into a single array.
 * @param {Array<DocumentTab>} tabs The array of tabs from doc.getTabs().
 * @param {number} [level=0] The current indentation level.
 * @returns {Array<Object>} A flat list of tab info objects ({id, title}).
 * @private
 */
function _flattenTabs(tabs, level = 0) {
  if (!tabs || tabs.length === 0) return [];
  let flatList = [];
  const indent = "  ".repeat(level);
  tabs.forEach((tab) => {
    flatList.push({ id: tab.getId(), title: indent + tab.getTitle() });
    const childTabs = tab.getChildTabs();
    if (childTabs.length > 0) {
      flatList = flatList.concat(_flattenTabs(childTabs, level + 1));
    }
  });
  return flatList;
}

/**
 * Finds a tab by its ID within a nested tab structure.
 * @param {Array<DocumentTab>} tabs The array of tabs to search.
 * @param {string} tabId The ID of the tab to find.
 * @returns {DocumentTab|null} The found tab object or null.
 * @private
 */
function _findTabById(tabs, tabId) {
  for (const tab of tabs) {
    if (tab.getId() === tabId) return tab;
    const foundInChild = _findTabById(tab.getChildTabs(), tabId);
    if (foundInChild) return foundInChild;
  }
  return null;
}

// --- UI Functions ---

function showSettingsDialog() {
  const htmlTemplate = HtmlService.createTemplateFromFile("SettingsDialog");
  htmlTemplate.settings =
    PropertiesService.getDocumentProperties().getProperties();
  const htmlOutput = htmlTemplate.evaluate().setWidth(400).setHeight(550);
  DocumentApp.getUi().showModalDialog(htmlOutput, "設定");
}

function saveSettings(formObject) {
  const docProps = PropertiesService.getDocumentProperties();
  const currentSettings = docProps.getProperties();
  const newSettings = { ...currentSettings, ...formObject };
  if (!formObject.GITHUB_TOKEN) {
    newSettings.GITHUB_TOKEN = currentSettings.GITHUB_TOKEN || "";
  }
  docProps.setProperties(newSettings);
  return true;
}
