/**
 * Document Parsing Logic
 * Googleドキュメントの構造解析とデータ抽出を担当します。
 */

/**
 * Helper: 整形済みのタブリストを返します。
 * @param {GoogleAppsScript.Document.Document} doc ドキュメントオブジェクト
 * @returns {Array<object>} UI表示用に整形されたタブのリスト
 */
function getFlattenedTabs(doc) {
  const tabs = doc.getTabs ? doc.getTabs() : [];
  return _flattenTabs(tabs);
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