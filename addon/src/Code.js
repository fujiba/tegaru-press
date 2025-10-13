/**
 * @fileoverview Google Workspace Add-on implementation for Tegaru Press.
 * This file handles the Card-based UI for the add-on sidebar.
 * This version re-implements multi-tab selection and ensures the 'last_pushed'
 * timestamp logic is correct.
 */

const LIB = TegaruPress;

/**
 * Renders the add-on homepage when a user opens it in Google Docs.
 * @param {Object} e The event object.
 * @return {Card} The card to display.
 */
function onDocsHomepage(e) {
  return createMainCard();
}

/**
 * Creates the main card for the add-on, with checkboxes for each tab.
 * @returns {Card} The main card UI.
 */
function createMainCard() {
  const doc = DocumentApp.getActiveDocument();
  const tabs = doc.getTabs();
  const flatTabs = _flattenTabs(tabs);

  // FEATURE: Use CHECK_BOX for multi-select
  const tabSelection = CardService.newSelectionInput()
    .setFieldName("selected_tabs") // Use plural name for multi-select
    .setTitle("更新するタブを選択（複数選択可）")
    .setType(CardService.SelectionInputType.CHECK_BOX);

  if (flatTabs.length > 0) {
    flatTabs.forEach((tabInfo) => {
      tabSelection.addItem(tabInfo.title, tabInfo.id, false);
    });
  } else {
    tabSelection.addItem("（タブがありません）", "", true).setDisabled(true);
  }

  const pushAction = CardService.newAction()
    .setFunctionName("handlePushAction")
    .setParameters({});
  const previewAction = CardService.newAction()
    .setFunctionName("handlePreviewAction")
    .setParameters({});
  const insertFrontMatterAction = CardService.newAction()
    .setFunctionName("handleInsertFrontMatterAction")
    .setParameters({});
  const settingsAction = CardService.newAction().setFunctionName(
    "handleSettingsAction"
  );

  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("Tegaru Press"))
    .addSection(
      CardService.newCardSection()
        .addWidget(tabSelection)
        .addWidget(
          CardService.newButtonSet().addButton(
            CardService.newTextButton()
              .setText("選択したタブをPush") // Reflects multi-select capability
              .setOnClickAction(pushAction)
              .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          )
        )
        .addWidget(
          CardService.newButtonSet()
            .addButton(
              CardService.newTextButton()
                .setText("Markdownプレビュー")
                .setOnClickAction(previewAction)
            )
            .addButton(
              CardService.newTextButton()
                .setText("フロントマターを挿入")
                .setOnClickAction(insertFrontMatterAction)
            )
            .addButton(
              CardService.newTextButton()
                .setText("設定")
                .setOnClickAction(settingsAction)
            )
        )
    )
    .build();

  return card;
}

/**
 * Action handler for the "Push" button. Handles multiple selected tabs.
 * @param {Object} e The event object.
 * @returns {ActionResponse}
 */
function handlePushAction(e) {
  try {
    if (!e || !e.formInputs || !e.formInputs.selected_tabs) {
      throw new Error(
        "UIからタブ情報を取得できませんでした。ページを再読み込みしてお試しください。"
      );
    }
    const selectedTabIds = e.formInputs.selected_tabs;
    if (!selectedTabIds || selectedTabIds.length === 0) {
      throw new Error("更新するタブを1つ以上選択してください。");
    }

    // FEATURE: Generate timestamp before processing files.
    const timestamp = new Date().toLocaleString("ja-JP");
    const allDataObjects = [];

    // FEATURE: Handle multiple selected tabs.
    selectedTabIds.forEach((tabId) => {
      const { frontMatter, documentData } = _buildDocumentData(tabId);
      if (!frontMatter.file_path) {
        const tabTitle = _findTabById(
          DocumentApp.getActiveDocument().getTabs(),
          tabId
        ).getTitle();
        throw new Error(
          `タブ「${tabTitle}」のフロントマターに 'file_path' がありません。`
        );
      }
      // FEATURE: Add the correct timestamp to the data being pushed.
      frontMatter.last_pushed = timestamp;
      allDataObjects.push({ frontMatter, documentData });
    });

    const settings = PropertiesService.getDocumentProperties().getProperties();

    // Pass the array of data objects to the library.
    LIB.push(allDataObjects, settings);

    // FEATURE: Update the document's timestamp after a successful push.
    selectedTabIds.forEach((tabId) => {
      _updateLastPushedTimestamp(tabId, timestamp);
    });

    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(
          `${selectedTabIds.length}個のタブのPushが完了しました。`
        )
      )
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(`エラー: ${err.message}`)
      )
      .build();
  }
}

/**
 * Action handler for previewing. Only previews the first selected tab.
 * @param {Object} e The event object.
 * @returns {ActionResponse}
 */
function handlePreviewAction(e) {
  try {
    if (!e || !e.formInputs || !e.formInputs.selected_tabs) {
      throw new Error(
        "UIからタブ情報を取得できませんでした。ページを再読み込みしてお試しください。"
      );
    }
    const selectedTabIds = e.formInputs.selected_tabs;
    if (!selectedTabIds || selectedTabIds.length === 0) {
      throw new Error("プレビューするタブを選択してください。");
    }
    if (selectedTabIds.length > 1) {
      return CardService.newActionResponseBuilder()
        .setNotification(
          CardService.newNotification().setText(
            "プレビューは1つのタブしか選択できません。"
          )
        )
        .build();
    }
    const selectedTabId = selectedTabIds[0];

    const { frontMatter, documentData } = _buildDocumentData(selectedTabId);
    const markdownContent = LIB.getMarkdown({ frontMatter, documentData });

    const card = createPreviewCard(markdownContent);
    const navigation = CardService.newNavigation().pushCard(card);
    return CardService.newActionResponseBuilder()
      .setNavigation(navigation)
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(
          `プレビュー生成エラー: ${err.message}`
        )
      )
      .build();
  }
}

/**
 * Action handler for inserting front matter. Only works for a single selected tab.
 * @param {Object} e The event object.
 * @returns {ActionResponse}
 */
function handleInsertFrontMatterAction(e) {
  try {
    if (!e || !e.formInputs || !e.formInputs.selected_tabs) {
      throw new Error(
        "UIからタブ情報を取得できませんでした。ページを再読み込みしてお試しください。"
      );
    }
    const selectedTabIds = e.formInputs.selected_tabs;
    if (!selectedTabIds || selectedTabIds.length === 0) {
      throw new Error("フロントマターを挿入するタブを選択してください。");
    }
    if (selectedTabIds.length > 1) {
      return CardService.newActionResponseBuilder()
        .setNotification(
          CardService.newNotification().setText(
            "フロントマターの挿入は1つのタブしか選択できません。"
          )
        )
        .build();
    }
    const selectedTabId = selectedTabIds[0];

    _insertFrontMatterTable(selectedTabId);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(
          "フロントマターのテンプレートを挿入しました。"
        )
      )
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(`エラー: ${err.message}`)
      )
      .build();
  }
}

// --- 以下、変更のないヘルパー関数とUI関数 ---

function _getActiveTabId(doc, tabs) {
  const selection = doc.getSelection();
  if (!selection) return null;
  const rangeElements = selection.getRangeElements();
  if (rangeElements.length === 0) return null;
  const cursorElement = rangeElements[0].getElement();
  function findTabForElement(tabs) {
    for (const tab of tabs) {
      const tabBody = tab.asDocumentTab().getBody();
      if (isElementInBody(cursorElement, tabBody)) return tab.getId();
      const childResult = findTabForElement(tab.getChildTabs());
      if (childResult) return childResult;
    }
    return null;
  }
  function isElementInBody(element, body) {
    let parent = element.getParent();
    while (parent) {
      if (parent.equals(body)) return true;
      parent = parent.getParent();
    }
    return false;
  }
  return findTabForElement(tabs);
}

function _buildDocumentData(tabId) {
  const doc = DocumentApp.getActiveDocument();
  const tab = _findTabById(doc.getTabs(), tabId);
  if (!tab) throw new Error(`指定されたタブ（ID: ${tabId}）が見つかりません。`);
  const tabBody = tab.asDocumentTab().getBody();
  const frontMatter = {};
  const documentData = [];
  const allElements = [];
  for (let i = 0; i < tabBody.getNumChildren(); i++) {
    allElements.push(tabBody.getChild(i));
  }
  let contentStartIndex = 0;
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    if (
      el.getType() === DocumentApp.ElementType.PARAGRAPH &&
      el.asParagraph().getText().trim() === ""
    )
      continue;
    if (el.getType() === DocumentApp.ElementType.TABLE) {
      const table = el.asTable();
      let startRow = 0;
      if (table.getNumRows() > 0 && table.getRow(0).getNumCells() === 1)
        startRow = 1;
      for (let r = startRow; r < table.getNumRows(); r++) {
        const row = table.getRow(r);
        if (row.getNumCells() < 2) continue;
        const key = row.getCell(0).getText().trim().toLowerCase();
        const value = row.getCell(1).getText().trim();
        if (key) frontMatter[key] = value;
      }
      contentStartIndex = i + 1;
    }
    break;
  }
  for (let i = contentStartIndex; i < allElements.length; i++) {
    const element = allElements[i];
    let elementData = null;
    switch (element.getType()) {
      case DocumentApp.ElementType.PARAGRAPH:
        const p = element.asParagraph();
        const img = p.findElement(DocumentApp.ElementType.INLINE_IMAGE);
        if (img) {
          const imgEl = img.getElement().asInlineImage();
          elementData = {
            type: "IMAGE",
            bytes: imgEl.getBlob().getBytes(),
            contentType: imgEl.getBlob().getContentType(),
            alt: imgEl.getAltDescription(),
          };
        } else if (p.getText().trim() !== "") {
          elementData = {
            type: "PARAGRAPH",
            text: _processTextAttributes(p.asText()),
            heading: p.getHeading().toString(),
          };
        }
        break;
      case DocumentApp.ElementType.LIST_ITEM:
        const li = element.asListItem();
        elementData = {
          type: "LIST_ITEM",
          text: _processTextAttributes(li.asText()),
          nestingLevel: li.getNestingLevel(),
          isNumbered: li.getGlyphType() === DocumentApp.GlyphType.NUMBER,
        };
        break;
    }
    if (elementData) documentData.push(elementData);
  }
  return { frontMatter, documentData };
}

function _insertFrontMatterTable(tabId) {
  const doc = DocumentApp.getActiveDocument();
  const tab = _findTabById(doc.getTabs(), tabId);
  if (!tab) throw new Error(`指定されたタブ（ID: ${tabId}）が見つかりません。`);
  const tabBody = tab.asDocumentTab().getBody();
  for (let i = 0; i < tabBody.getNumChildren(); i++) {
    const child = tabBody.getChild(i);
    if (
      child.getType() === DocumentApp.ElementType.PARAGRAPH &&
      child.asParagraph().getText().trim() === ""
    )
      continue;
    if (child.getType() === DocumentApp.ElementType.TABLE)
      throw new Error("このタブには既にフロントマターテーブルが存在します。");
    break;
  }
  const tableData = [
    ["▼ サイト制御用の設定です（このテーブルは消さないでください）", ""],
    ["file_path", ""],
    ["title", ""],
    ["tags", ""],
    ["last_pushed", ""],
  ];
  const table = tabBody.insertTable(0, tableData);
  const headerRow = table.getRow(0);
  headerRow.merge();
  const headerCell = headerRow.getCell(0);
  headerCell.setBackgroundColor("#FFF2CC");
  headerCell
    .getChild(0)
    .asParagraph()
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
}

function _updateLastPushedTimestamp(tabId, timestamp) {
  const doc = DocumentApp.getActiveDocument();
  const tab = _findTabById(doc.getTabs(), tabId);
  if (!tab) return;
  const tabBody = tab.asDocumentTab().getBody();
  for (let i = 0; i < tabBody.getNumChildren(); i++) {
    const child = tabBody.getChild(i);
    if (child.getType() === DocumentApp.ElementType.TABLE) {
      const table = child.asTable();
      let startRow = 0;
      if (table.getNumRows() > 0 && table.getRow(0).getNumCells() === 1)
        startRow = 1;
      for (let j = startRow; j < table.getNumRows(); j++) {
        const key = table.getRow(j).getCell(0).getText().trim().toLowerCase();
        if (key === "last_pushed") {
          table.getRow(j).getCell(1).setText(timestamp);
          return;
        }
      }
      break;
    }
    if (
      child.getType() === DocumentApp.ElementType.PARAGRAPH &&
      child.asParagraph().getText().trim() !== ""
    )
      break;
  }
}

function _flattenTabs(tabs, level = 0) {
  let flatList = [];
  const indent = "  ".repeat(level);
  tabs.forEach((tab) => {
    flatList.push({ id: tab.getId(), title: indent + tab.getTitle() });
    const childTabs = tab.getChildTabs();
    if (childTabs.length > 0)
      flatList = flatList.concat(_flattenTabs(childTabs, level + 1));
  });
  return flatList;
}

function _findTabById(tabs, tabId) {
  for (const tab of tabs) {
    if (tab.getId() === tabId) return tab;
    const foundInChild = _findTabById(tab.getChildTabs(), tabId);
    if (foundInChild) return foundInChild;
  }
  return null;
}

function createPreviewCard(markdownContent) {
  const section = CardService.newCardSection().addWidget(
    CardService.newTextParagraph().setText(markdownContent)
  );
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("Markdown プレビュー"))
    .addSection(section)
    .build();
  return card;
}

function handleSettingsAction() {
  const card = createSettingsCard();
  const navigation = CardService.newNavigation().pushCard(card);
  return CardService.newActionResponseBuilder()
    .setNavigation(navigation)
    .build();
}

function createSettingsCard() {
  const settings = PropertiesService.getDocumentProperties().getProperties();
  const saveAction = CardService.newAction()
    .setFunctionName("handleSaveSettingsAction")
    .setParameters({});
  const section = CardService.newCardSection()
    .setHeader("リポジトリ設定（全体）")
    .addWidget(
      CardService.newTextInput()
        .setFieldName("GITHUB_USER")
        .setTitle("GitHubユーザー名")
        .setValue(settings.GITHUB_USER || "")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("GITHUB_REPO")
        .setTitle("GitHubリポジトリ名")
        .setValue(settings.GITHUB_REPO || "")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("BRANCH_NAME")
        .setTitle("ブランチ名 (任意)")
        .setValue(settings.BRANCH_NAME || "")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("CONTENT_ROOT_PATH")
        .setTitle("コンテンツのルートディレクトリ")
        .setHint("例: content/posts")
        .setValue(settings.CONTENT_ROOT_PATH || "")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("IMAGE_PATH")
        .setTitle("画像保存フォルダ名")
        .setHint("コンテンツからの相対パス")
        .setValue(settings.IMAGE_PATH || "images")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("COMMIT_MESSAGE")
        .setTitle("デフォルトのコミットメッセージ")
        .setValue(settings.COMMIT_MESSAGE || "")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("GITHUB_TOKEN")
        .setTitle("GitHub アクセストークン (PAT)")
        .setValue("")
    );
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("設定"))
    .addSection(section)
    .setFixedFooter(
      CardService.newFixedFooter().setPrimaryButton(
        CardService.newTextButton()
          .setText("保存")
          .setOnClickAction(saveAction)
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      )
    )
    .build();
  return card;
}

function handleSaveSettingsAction(e) {
  if (!e || !e.formInputs)
    throw new Error(
      "UIから設定情報を取得できませんでした。ページを再読み込みしてお試しください。"
    );
  const formInputs = e.formInputs;
  const docProps = PropertiesService.getDocumentProperties();
  const currentSettings = docProps.getProperties();
  const newSettings = {};
  for (const key in formInputs) {
    newSettings[key] = formInputs[key][0];
  }
  if (!newSettings.GITHUB_TOKEN) {
    newSettings.GITHUB_TOKEN = currentSettings.GITHUB_TOKEN || "";
  }
  docProps.setProperties(newSettings);
  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText("設定を保存しました。")
    )
    .build();
}

function _processTextAttributes(textElement) {
  const text = textElement.getText();
  if (text === null || text.trim() === "") return text;
  const attributeIndices = textElement.getTextAttributeIndices();
  let markdown = "";
  let lastIndex = 0;
  for (let i = 0; i < attributeIndices.length; i++) {
    const startIndex = attributeIndices[i];
    const segment = text.substring(lastIndex, startIndex);
    if (segment.length > 0) {
      let styledSegment = segment;
      const attributes = textElement.getAttributes(lastIndex);
      const isBold = attributes[DocumentApp.Attribute.BOLD];
      const isItalic = attributes[DocumentApp.Attribute.ITALIC];
      if (isBold && isItalic) {
        styledSegment =
          `***${segment.trim()}***` + (segment.endsWith(" ") ? " " : "");
      } else if (isBold) {
        styledSegment =
          `**${segment.trim()}**` + (segment.endsWith(" ") ? " " : "");
      } else if (isItalic) {
        styledSegment =
          `*${segment.trim()}*` + (segment.endsWith(" ") ? " " : "");
      }
      markdown += styledSegment;
    }
    lastIndex = startIndex;
  }
  const lastSegment = text.substring(lastIndex);
  if (lastSegment.length > 0) {
    let styledSegment = lastSegment;
    const attributes = textElement.getAttributes(lastIndex);
    const isBold = attributes[DocumentApp.Attribute.BOLD];
    const isItalic = attributes[DocumentApp.Attribute.ITALIC];
    if (isBold && isItalic) {
      styledSegment =
        `***${styledSegment.trim()}***` +
        (styledSegment.endsWith(" ") ? " " : "");
    } else if (isBold) {
      styledSegment =
        `**${styledSegment.trim()}**` +
        (styledSegment.endsWith(" ") ? " " : "");
    } else if (isItalic) {
      styledSegment =
        `*${styledSegment.trim()}*` + (styledSegment.endsWith(" ") ? " " : "");
    }
    markdown += styledSegment;
  }
  return markdown;
}
