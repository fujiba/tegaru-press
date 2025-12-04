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
 * Refactored to orchestrate smaller helper functions.
 * @private
 */
function _buildDocumentData(doc, tabId) {
  const body = _getBodyFromDocOrTab(doc, tabId);
  const { frontMatter, contentStartIndex } = _extractFrontMatter(body);
  const documentData = _parseBodyContent(body, contentStartIndex);

  return { frontMatter, documentData };
}

/**
 * Retrieves the Body object from either a specific tab or the main document.
 * @private
 */
function _getBodyFromDocOrTab(doc, tabId) {
  if (tabId) {
    const tab = _findTabById(doc.getTabs(), tabId);
    if (!tab) throw new Error(`指定されたタブ（ID: ${tabId}）が見つかりません。`);
    return tab.asDocumentTab().getBody();
  }
  return doc.getBody();
}

/**
 * Extracts front matter from the beginning of the document body.
 * @private
 */
function _extractFrontMatter(body) {
  const numChildren = body.getNumChildren();
  const frontMatter = {};
  let contentStartIndex = 0;

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    // Skip empty paragraphs at the start
    if (
      child.getType() === DocumentApp.ElementType.PARAGRAPH &&
      child.asParagraph().getText().trim() === ""
    ) {
      continue;
    }
    // Check if the first non-empty element is a table (Front Matter)
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
    // Stop after checking the first significant element
    break;
  }
  return { frontMatter, contentStartIndex };
}

/**
 * Iterates through the body content starting from the given index and parses elements.
 * @private
 */
function _parseBodyContent(body, startIndex) {
  const numChildren = body.getNumChildren();
  const documentData = [];

  for (let i = startIndex; i < numChildren; i++) {
    const child = body.getChild(i);
    const elementData = _parseElement(child);
    if (elementData) {
      documentData.push(elementData);
    }
  }
  return documentData;
}

/**
 * Parses a single document element (Paragraph, List Item, or Table) into a data object.
 * @private
 */
function _parseElement(child) {
  let elementData = null;
  const type = child.getType();

  switch (type) {
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

    case DocumentApp.ElementType.TABLE:
      const table = child.asTable();
      const tableRows = [];
      for (let r = 0; r < table.getNumRows(); r++) {
        const row = table.getRow(r);
        const rowData = [];
        for (let c = 0; c < row.getNumCells(); c++) {
          const cell = row.getCell(c);
          let cellSegments = [];
          // Process all children in the cell (mainly paragraphs)
          for (let k = 0; k < cell.getNumChildren(); k++) {
            const cellChild = cell.getChild(k);
            if (cellChild.getType() === DocumentApp.ElementType.PARAGRAPH) {
              const segments = _processTextAttributes(cellChild.asParagraph().asText());
              if (k > 0) {
                cellSegments.push({ text: "\n", attributes: {} });
              }
              cellSegments = cellSegments.concat(segments);
            }
          }
          rowData.push(cellSegments);
        }
        tableRows.push(rowData);
      }
      if (tableRows.length > 0) {
        elementData = {
          type: "TABLE",
          rows: tableRows
        };
      }
      break;
  }

  return elementData;
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