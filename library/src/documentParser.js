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
  return flattenTabs_(tabs);
}

/**
 * Recursively flattens the tab structure into a single array for UI display.
 * @private
 */
function flattenTabs_(tabs, level = 0) {
  if (!tabs || tabs.length === 0) return [];
  let flatList = [];
  const indent = "  ".repeat(level);
  tabs.forEach((tab) => {
    const title = tab.getTitle();
    if (title.trim().startsWith("[NOSYNC")) {
      // 更新対象外タブはスキップ
      return;
    }
    flatList.push({ id: tab.getId(), title: indent + tab.getTitle() });
    const childTabs = tab.getChildTabs();
    if (childTabs.length > 0) {
      flatList = flatList.concat(flattenTabs_(childTabs, level + 1));
    }
  });
  return flatList;
}

/**
 * Finds a tab by its ID within a nested tab structure.
 * @private
 */
function findTabById_(tabs, tabId) {
  for (const tab of tabs) {
    if (tab.getId() === tabId) return tab;
    const foundInChild = findTabById_(tab.getChildTabs(), tabId);
    if (foundInChild) return foundInChild;
  }
  return null;
}

/**
 * Builds data objects for all specified tabs or the main body.
 * @private
 */
function buildAllDocumentData_(doc, selectedTabIds) {
  const allDataObjects = [];
  const tabs = doc.getTabs ? doc.getTabs() : [];

  if (selectedTabIds && selectedTabIds.length > 0) {
    selectedTabIds.forEach((tabId) => {
      const documentData = buildDocumentData_(doc, tabId);
      if (!documentData.frontMatter.file_path) {
        const tabTitle = findTabById_(tabs, tabId).getTitle();
        throw new Error(`タブ「${tabTitle}」のフロントマターに 'file_path' がありません。`);
      }
      allDataObjects.push(documentData);
    });
  } else {
    const documentData = buildDocumentData_(doc, null);
    if (!documentData.frontMatter.file_path) {
      throw new Error(
        "フロントマターに 'file_path' が設定されていません。ドキュメント先頭のテーブルを確認してください。",
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
function buildDocumentData_(doc, tabId) {
  const body = getBodyFromDocOrTab_(doc, tabId);
  const { frontMatter, contentStartIndex } = extractFrontMatter_(body);
  const documentData = parseBodyContent_(body, contentStartIndex);

  return { frontMatter, documentData };
}

/**
 * Retrieves the Body object from either a specific tab or the main document.
 * @private
 */
function getBodyFromDocOrTab_(doc, tabId) {
  if (tabId) {
    const tab = findTabById_(doc.getTabs(), tabId);
    if (!tab) throw new Error(`指定されたタブ（ID: ${tabId}）が見つかりません。`);
    return tab.asDocumentTab().getBody();
  }
  return doc.getBody();
}

/**
 * Extracts front matter from the beginning of the document body.
 * @private
 */
function extractFrontMatter_(body) {
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
function parseBodyContent_(body, startIndex) {
  const numChildren = body.getNumChildren();
  const documentData = [];

  for (let i = startIndex; i < numChildren; i++) {
    const child = body.getChild(i);
    const elementData = parseElement_(child);
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
function parseElement_(child) {
  let elementData = null;
  const type = child.getType();

  switch (type) {
    case DocumentApp.ElementType.PARAGRAPH: {
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
          text: processTextAttributes_(paragraph.asText()),
          heading: paragraph.getHeading().toString(),
        };
        const combinedText = elementData.text.map((s) => s.text).join("");
        if (!combinedText || combinedText.trim() === "") {
          elementData = null;
        }
      }
      break;
    }

    case DocumentApp.ElementType.LIST_ITEM: {
      const listItem = child.asListItem();
      if (listItem.getText().trim() !== "") {
        const glyph = listItem.getGlyphType();
        elementData = {
          type: "LIST_ITEM",
          text: processTextAttributes_(listItem.asText()),
          nestingLevel: listItem.getNestingLevel(),
          isNumbered:
            glyph === DocumentApp.GlyphType.NUMBER ||
            glyph === DocumentApp.GlyphType.LATIN_UPPER ||
            glyph === DocumentApp.GlyphType.LATIN_LOWER,
        };
      }
      break;
    }
    case DocumentApp.ElementType.TABLE: {
      const table = child.asTable();
      const tableRows = [];
      for (let r = 0; r < table.getNumRows(); r++) {
        const row = table.getRow(r);
        const rowData = [];
        for (let c = 0; c < row.getNumCells(); c++) {
          const cell = row.getCell(c);
          const cellSegments = [];
          // Process all children in the cell (mainly paragraphs)
          for (let k = 0; k < cell.getNumChildren(); k++) {
            const cellChild = cell.getChild(k);
            if (cellChild.getType() === DocumentApp.ElementType.PARAGRAPH) {
              const segments = processTextAttributes_(cellChild.asParagraph().asText());
              if (k > 0) {
                cellSegments.push({ text: "\n", attributes: {} });
              }
              cellSegments.push(...segments);
            }
          }
          rowData.push(cellSegments);
        }
        tableRows.push(rowData);
      }
      if (tableRows.length > 0) {
        elementData = {
          type: "TABLE",
          rows: tableRows,
        };
      }
      break;
    }
  }

  return elementData;
}

/**
 * Processes text attributes (bold, italic, link) for a text element.
 * @private
 */
function processTextAttributes_(textElement) {
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
