/**
 * @fileoverview Google Docs to GitHub Markdown Publisher - Library
 * @version 4.0.0
 * Major architectural change: The library now accepts a Google Docs object
 * directly and handles all parsing and processing internally.
 */

/**
 * Main function to execute the push process. (Public API)
 * @param {GoogleAppsScript.Document.Document} doc The Google Document object to process.
 * @param {Array<string>|null} selectedTabIds An array of tab IDs to push. If null, the main body is used.
 */
function push(doc, selectedTabIds) {
  const settings = PropertiesService.getDocumentProperties().getProperties();
  const allDataObjects = _buildAllDocumentData(doc, selectedTabIds);

  if (allDataObjects.length === 0) {
    throw new Error("Pushするコンテンツがありません。");
  }

  _pushDataObjects(allDataObjects, settings);
}

/**
 * Processes and pushes an array of data objects to GitHub.
 */
function _pushDataObjects(dataObjects, settings) {
  const allFilesToCommit = [];
  const contentRoot = settings.CONTENT_ROOT_PATH || "";

  dataObjects.forEach((dataObject) => {
    if (!dataObject.frontMatter.file_path) {
      // This should be caught by the caller, but as a safeguard:
      throw new Error(
        "An item was passed without a 'file_path' in its front matter."
      );
    }

    const finalPath = [contentRoot, dataObject.frontMatter.file_path]
      .filter(Boolean)
      .join("/");
    const markdownFilePrefix = finalPath
      .split("/")
      .pop()
      .replace(/\.[^/.]+$/, "");
    const imageSubDir = settings.IMAGE_PATH || "images";
    const markdownDir = finalPath.includes("/")
      ? finalPath.substring(0, finalPath.lastIndexOf("/"))
      : "";

    const { markdown, images } = _convertDataToMarkdown(
      dataObject,
      markdownDir,
      imageSubDir,
      markdownFilePrefix
    );

    if (!markdown) return; // Skip empty sections

    // Add images for this section to the main list
    images.forEach((imageFile) => {
      allFilesToCommit.push({
        path: imageFile.path,
        content: imageFile.bytes,
        isBinary: true,
      });
    });

    // Add the markdown file for this section to the main list
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
    settings.COMMIT_MESSAGE ||
    `Update ${allFilesToCommit.length} file(s) from Google Docs`;
  _pushFilesAsSingleCommit(allFilesToCommit, commitMessage, settings);
}

/**
 * Returns the generated Markdown for preview purposes. (Public API)
 * @param {GoogleAppsScript.Document.Document} doc The Google Document object to process.
 * @param {string|null} selectedTabId The ID of the tab to preview.
 * @return {string} The generated Markdown content.
 */
function getMarkdown(doc, selectedTabId) {
  const dataObject = _buildDocumentData(doc, selectedTabId);
  const { markdown } = _convertDataToMarkdown(
    dataObject,
    "",
    "images",
    "preview"
  );
  return markdown;
}

// --- Settings Functions (Public API for Caller) ---

/**
 * 設定を取得します。
 * (Public API)
 * @returns {object} 保存されている設定オブジェクト。
 */
function getSettings() {
  return PropertiesService.getDocumentProperties().getProperties();
}

/**
 * 設定をドキュメントプロパティに保存します。(UIから呼ばれる)
 * (Public API)
 * @param {object} formObject HTMLフォームから渡される設定オブジェクト。
 * @returns {boolean} 成功したかどうか。
 */
function saveSettings(formObject) {
  const docProps = PropertiesService.getDocumentProperties();
  const currentSettings = docProps.getProperties();
  const newSettings = { ...currentSettings, ...formObject };
  // トークンが空で送信された場合、既存の値を上書きしない
  if (!formObject.GITHUB_TOKEN) {
    newSettings.GITHUB_TOKEN = currentSettings.GITHUB_TOKEN || "";
  }
  docProps.setProperties(newSettings);
  return true;
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
    const settings = PropertiesService.getDocumentProperties().getProperties();
    const contentRoot = settings.CONTENT_ROOT_PATH || "";
    const dateObj = new Date(date);
    const formattedDate = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyyMMdd");
    const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const filePath = [`${formattedDate}-${title}`, "index.md"].filter(Boolean).join("/");
    const formattedDateTime = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
    // --- データ生成ロジックここまで ---

    const body = DocumentApp.getActiveDocument().getBody();

    // 既存のテーブルチェック
    if (body.getChild(0).getType() === DocumentApp.ElementType.TABLE) {
      throw new Error("このドキュメントには既にフロントマターテーブルが存在します。");
    }

    const tableData = [
      ["キー", "値", "説明"],
      ["file_path", filePath, "サイトのルートからのファイルパス (例: posts/my-post.md)"],
      ["title", title, "記事のタイトル"],
      ["subtitle", "", "記事のサブタイトル（任意）"],
      ["description", "", "SEOや検索結果に表示される説明文"],
      ["summary", "", "記事一覧などで表示される短い要約"],
      ["authors", "", "著者名 (複数名はカンマ区切り)"],
      ["tags", "", "タグ (複数指定はカンマ区切り)"],
      ["categories", "", "カテゴリ (複数指定はカンマ区切り)"],
      ["date", formattedDateTime, "公開日時 (例: 2023/10/27 10:00)。空欄の場合はPush時の日時。"],
      ["draft", "false", "'true'にすると下書き扱いになります"],
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
  const doc = DocumentApp.getActiveDocument(); // このコンテキストでdocを取得
  push(doc, selectedTabIds);
  DocumentApp.getUi().alert("コンテンツのPushが完了しました。");
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
    const markdownContent = getMarkdown(doc, tabId);

    if (!markdownContent || markdownContent.trim() === "---") {
      DocumentApp.getUi().alert("ドキュメントが空か、フロントマターしかありません。");
      return;
    }

    // テンプレートを使用してコンテンツを安全にエスケープします
    const template = HtmlService.createTemplate('<pre style="white-space: pre-wrap; word-wrap: break-word;"><?= content ?></pre>');
    template.content = markdownContent;
    const htmlOutput = template.evaluate().setWidth(600).setHeight(450);
    DocumentApp.getUi().showModalDialog(htmlOutput, "Markdown プレビュー");

  } catch (e) {
    Logger.log(e);
    DocumentApp.getUi().alert(`プレビュー中にエラーが発生しました:\n${e.message}`);
  }
}

// --- Helper Functions (Public API for Caller) ---

/**
 * 整形済みのタブリストを返します。UI表示のためにCallerから呼び出されます。
 * @param {GoogleAppsScript.Document.Document} doc ドキュメントオブジェクト
 * @returns {Array<object>} UI表示用に整形されたタブのリスト
 */
function getFlattenedTabs(doc) {
  const tabs = doc.getTabs ? doc.getTabs() : [];
  return _flattenTabs(tabs);
}

// --- Data Conversion Logic (Internal) ---
/**
 * Builds data objects for all specified tabs or the main body.
 * @private
 */
function _buildAllDocumentData(doc, selectedTabIds) {
  const allDataObjects = [];
  const tabs = doc.getTabs ? doc.getTabs() : [];

  if (selectedTabIds && selectedTabIds.length > 0) {
    selectedTabIds.forEach((tabId) => {
      const documentData = _buildDocumentData(doc, tabId);
      if (!documentData.frontMatter.file_path) {
        const tabTitle = _findTabById(tabs, tabId).getTitle();
        throw new Error(
          `タブ「${tabTitle}」のフロントマターに 'file_path' がありません。`
        );
      }
      allDataObjects.push(documentData);
    });
  } else {
    const documentData = _buildDocumentData(doc, null);
    if (!documentData.frontMatter.file_path) {
      throw new Error(
        "フロントマターに 'file_path' が設定されていません。ドキュメント先頭のテーブルを確認してください。"
      );
    }
    allDataObjects.push(documentData);
  }
  return allDataObjects;
}

/**
 * Parses a Google Doc body/tab into a serializable data object.
 * @private
 */
function _buildDocumentData(doc, tabId) {
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

  // 1. Find front matter table
  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    if (
      child.getType() === DocumentApp.ElementType.PARAGRAPH &&
      child.asParagraph().getText().trim() === ""
    ) {
      continue;
    }
    if (child.getType() === DocumentApp.ElementType.TABLE) {
      const table = child.asTable();
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
    break;
  }

  // 2. Parse document content
  for (let i = contentStartIndex; i < numChildren; i++) {
    const child = body.getChild(i);
    let elementData = null;

    switch (child.getType()) {
      case DocumentApp.ElementType.PARAGRAPH:
        const paragraph = child.asParagraph();
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
        } else if (paragraph.getText().trim() !== "") {
          elementData = {
            type: "PARAGRAPH",
            text: _processTextAttributes(paragraph.asText()),
            heading: paragraph.getHeading().toString(),
          };
          const combinedText = elementData.text.map((s) => s.text).join("");
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
 * Processes text attributes (bold, italic, link) for a text element.
 * @private
 */
function _processTextAttributes(textElement) {
  const text = textElement.getText();
  if (text === null || text.trim() === "") return [{ text: text, attributes: {} }];

  const attributeIndices = textElement.getTextAttributeIndices();
  const segments = [];
  let lastIndex = 0;

  for (let i = 0; i < attributeIndices.length; i++) {
    const startIndex = attributeIndices[i];
    const segment = text.substring(lastIndex, startIndex);
    const attributes = textElement.getAttributes(lastIndex);
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
 * Recursively flattens the tab structure into a single array for UI display.
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
 * Converts the data object from the caller into a complete Markdown file content.
 * @private
 */
function _convertDataToMarkdown(
  dataObject,
  markdownBaseDir,
  imageSubDir,
  markdownFilePrefix
) {
  const { frontMatter, documentData } = dataObject;
  const images = [];
  let imageCounter = 0;

  let frontMatterString = "";
  if (frontMatter && Object.keys(frontMatter).length > 0) {
    frontMatterString += "---\n";

    // Handle date: Parse user input or set to current ISO 8601 time if empty.
    if (frontMatter.date === undefined || frontMatter.date === "") {
      frontMatter.date = new Date().toISOString();
    } else {
      const parsedDate = new Date(frontMatter.date);
      // Check if the parsed date is valid.
      if (!isNaN(parsedDate.getTime())) {
        frontMatter.date = parsedDate.toISOString();
      } // If parsing fails, the original string is kept, which might cause an error in the SSG, alerting the user.
    }

    for (const key in frontMatter) {
      const value = frontMatter[key];
      const arrayKeys = ["tags", "authors", "categories"];

      if (arrayKeys.includes(key)) {
        frontMatterString += `${key}:\n`;
        if (value && value.includes(",")) {
          value.split(",").forEach((item) => {
            frontMatterString += `  - "${item.trim()}"\n`;
          });
        }
      } else if (key === "draft" && (value === "true" || value === "false")) {
        frontMatterString += `${key}: ${value}\n`; // Don't quote boolean values
      } else {
        frontMatterString += `${key}: "${value}"\n`;
      }
    }
    frontMatterString += "---\n\n";
  }

  const markdownBody = documentData.reduce((acc, element, index) => {
    let markdownChunk = "";
    switch (element.type) {
      case "PARAGRAPH":
        switch (element.heading) {
          case "HEADING1":
            markdownChunk = `# ${_applyMarkdownToSegments(element.text)}`;
            break;
          case "HEADING2":
            markdownChunk = `## ${_applyMarkdownToSegments(element.text)}`;
            break;
          case "HEADING3":
            markdownChunk = `### ${_applyMarkdownToSegments(element.text)}`;
            break;
          default:
            markdownChunk = _applyMarkdownToSegments(element.text);
        }
        break;
      case "LIST_ITEM":
        const indent = "  ".repeat(element.nestingLevel || 0);
        const marker = element.isNumbered ? "1." : "-";
        markdownChunk = `${indent}${marker} ${_applyMarkdownToSegments(element.text)}`;
        break;
      case "IMAGE":
        imageCounter++;
        const extension = element.contentType.split("/")[1].replace("jpeg", "jpg");
        const imageName = `${markdownFilePrefix}_${imageCounter}.${extension}`;
        const linkPath = `./${imageSubDir}/${imageName}`;
        const uploadPath = (markdownBaseDir ? `${markdownBaseDir}/` : "") + `${imageSubDir}/${imageName}`;
        images.push({ path: uploadPath, bytes: element.bytes });
        markdownChunk = `!${element.alt || imageName}`;
        break;
    }

    if (!markdownChunk) {
      return acc; // If the current chunk is empty, do nothing.
    }
    if (!acc) {
      return markdownChunk; // If accumulator is empty (first element), just return the chunk.
    }

    // Determine the separator. Use a single newline between consecutive list items.
    const prevElement = documentData[index - 1];
    const separator = (prevElement && prevElement.type === "LIST_ITEM" && element.type === "LIST_ITEM") ? "\n" : "\n\n";
    return `${acc}${separator}${markdownChunk}`;
  }, "");

  return { markdown: frontMatterString + markdownBody, images: images };
}

/**
 * Applies markdown styling to a text segment based on its attributes.
 * @param {Array<Object>} textSegments An array of text segments with attributes.
 * @returns {string} The fully styled markdown text.
 * @private
 */
function _applyMarkdownToSegments(textSegments) {
  // Handle plain string for backward compatibility or if data is malformed.
  if (!textSegments || !Array.isArray(textSegments)) return textSegments || "";

  return textSegments.map(segment => {
    let styledText = segment.text;
    const attributes = segment.attributes || {};
    if (attributes["BOLD"] && attributes["ITALIC"]) {
      styledText = `***${styledText}***`;
    } else if (attributes["BOLD"]) {
      styledText = `**${styledText}**`;
    } else if (attributes["ITALIC"]) {
      styledText = `*${styledText}*`;
    }
    if (attributes["LINK_URL"]) {
      styledText = `[${styledText}](${attributes["LINK_URL"]})`;
    }
    return styledText;
  }).join("");
}

/**
 * Finds a tab by its ID within a nested tab structure.
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


// --- Git Trees API Implementation (Internal) ---
/**
 * Pushes multiple files to GitHub as a single atomic commit.
 * @private
 */
function _pushFilesAsSingleCommit(files, commitMessage, settings) {
  const { GITHUB_USER, GITHUB_REPO, GITHUB_TOKEN } = settings;
  const branch = settings.BRANCH_NAME || "main";

  const repoName = GITHUB_REPO.split("/")
    .pop()
    .replace(/\.git$/, "");
  const apiBase = `https://api.github.com/repos/${GITHUB_USER}/${repoName}`;

  const refData = __githubApiRequest(
    `${apiBase}/git/refs/heads/${branch}`,
    "GET",
    null,
    GITHUB_TOKEN
  );
  const latestCommitSha = refData.object.sha;
  const commitData = __githubApiRequest(
    `${apiBase}/git/commits/${latestCommitSha}`,
    "GET",
    null,
    GITHUB_TOKEN
  );
  const baseTreeSha = commitData.tree.sha;

  const treeElements = files.map((file) => {
    const blobData = __githubApiRequest(
      `${apiBase}/git/blobs`,
      "POST",
      {
        content: file.isBinary
          ? Utilities.base64Encode(file.content)
          : Utilities.base64Encode(file.content, Utilities.Charset.UTF_8),
        encoding: "base64",
      },
      GITHUB_TOKEN
    );

    return { path: file.path, mode: "100644", type: "blob", sha: blobData.sha };
  });

  const newTreeData = __githubApiRequest(
    `${apiBase}/git/trees`,
    "POST",
    {
      base_tree: baseTreeSha,
      tree: treeElements,
    },
    GITHUB_TOKEN
  );

  const newCommitData = __githubApiRequest(
    `${apiBase}/git/commits`,
    "POST",
    {
      message: commitMessage,
      tree: newTreeData.sha,
      parents: [latestCommitSha],
    },
    GITHUB_TOKEN
  );

  __githubApiRequest(
    `${apiBase}/git/refs/heads/${branch}`,
    "PATCH",
    {
      sha: newCommitData.sha,
    },
    GITHUB_TOKEN
  );
}

/**
 * A generic helper function to make requests to the GitHub API.
 * @private
 */
function __githubApiRequest(url, method, payload, token) {
  const options = {
    method: method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
    contentType: "application/json",
    muteHttpExceptions: true,
  };
  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode >= 200 && responseCode < 300) {
    return JSON.parse(responseBody);
  } else {
    throw new Error(
      `GitHub API Error (${url}, Code: ${responseCode}): ${responseBody}`
    );
  }
}
