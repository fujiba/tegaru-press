/**
 * @fileoverview Google Workspace Add-on implementation for Tegaru Press.
 * This file handles the Card-based UI for the add-on sidebar.
 * New feature: Supports updating multiple files from a single document using Document Tabs (Named Ranges).
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
 * Creates the main card for the add-on, allowing users to select a tab and perform actions.
 * @returns {Card} The main card UI.
 */
function createMainCard() {
  const doc = DocumentApp.getActiveDocument();
  const namedRanges = doc.getNamedRanges(); // これがドキュメントタブの実体です

  const tabSelection = CardService.newSelectionInput()
    .setFieldName("selected_tab")
    .setTitle("更新するタブを選択")
    .setType(CardService.SelectionInputType.DROPDOWN);

  if (namedRanges.length > 0) {
    namedRanges.forEach((range) => {
      tabSelection.addItem(range.getName(), range.getName(), false);
    });
  } else {
    // タブがない場合は、ドキュメント全体を対象とする
    tabSelection.addItem("ドキュメント全体", "DOCUMENT_ROOT", true);
  }

  const pushAction =
    CardService.newAction().setFunctionName("handlePushAction");
  const previewAction = CardService.newAction().setFunctionName(
    "handlePreviewAction"
  );
  const settingsAction = CardService.newAction().setFunctionName(
    "handleSettingsAction"
  );

  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("Tegaru Press"))
    .addSection(
      CardService.newCardSection()
        .addWidget(tabSelection) // ★ タブ選択用のドロップダウンを追加
        .addWidget(
          CardService.newButtonSet()
            .addButton(
              CardService.newTextButton()
                .setText("GitHubへPush")
                .setOnClickAction(pushAction)
                .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            )
            .addButton(
              CardService.newTextButton()
                .setText("Markdownプレビュー")
                .setOnClickAction(previewAction)
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
 * Action handler for the "Push to GitHub" button.
 * @param {Object} e The event object containing form inputs.
 * @returns {ActionResponse} A response that shows a notification.
 */
function handlePushAction(e) {
  try {
    const selectedTabName = e.formInputs.selected_tab[0];
    const documentData = _buildDocumentData(selectedTabName);
    const settings = PropertiesService.getDocumentProperties().getProperties();

    let finalPath = "";
    // タブが選択されている場合、ルートディレクトリとタブ名を結合
    if (selectedTabName && selectedTabName !== "DOCUMENT_ROOT") {
      const contentRoot = settings.CONTENT_ROOT_PATH || "";
      finalPath = [contentRoot, selectedTabName].filter(Boolean).join("/");
    } else {
      // 「ドキュメント全体」が選択されている場合は、設定されたファイルパスを使用
      finalPath = settings.FILE_PATH;
    }

    if (!finalPath) {
      throw new Error(
        "Push先のファイルパスが設定されていません。タブを選択するか、設定画面でファイルパスを指定してください。"
      );
    }

    // ライブラリに渡す設定オブジェクトのファイルパスを最終的なパスで上書き
    settings.FILE_PATH = finalPath;

    LIB.push(documentData, settings);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText("GitHubへのPushが完了しました。")
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
 * Action handler for the "Preview Markdown" button.
 * @param {Object} e The event object containing form inputs.
 * @returns {ActionResponse}
 */
function handlePreviewAction(e) {
  try {
    const selectedTabName = e.formInputs.selected_tab[0];
    const documentData = _buildDocumentData(selectedTabName);
    const markdownContent = LIB.getMarkdown(documentData);

    if (!markdownContent) {
      return CardService.newActionResponseBuilder()
        .setNotification(
          CardService.newNotification().setText("選択された範囲は空です。")
        )
        .build();
    }

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
 * Parses the active Google Doc into a serializable data array,
 * focusing only on the content within the selected named range (tab).
 * @param {string} rangeName The name of the tab (NamedRange) to parse.
 * @returns {Array<Object>} A data array representing the document content.
 * @private
 */
function _buildDocumentData(rangeName) {
  const doc = DocumentApp.getActiveDocument();
  const data = [];
  let elements = [];

  if (rangeName && rangeName !== "DOCUMENT_ROOT") {
    const range = doc.getNamedRange(rangeName);
    if (range) {
      elements = range
        .getRange()
        .getRangeElements()
        .map((re) => re.getElement());
    }
  } else {
    const body = doc.getBody();
    for (let i = 0; i < body.getNumChildren(); i++) {
      elements.push(body.getChild(i));
    }
  }

  elements.forEach((element) => {
    const type = element.getType();
    let elementData = null;

    switch (type) {
      case DocumentApp.ElementType.PARAGRAPH:
        const paragraph = element.asParagraph();
        const inlineImage = paragraph.findElement(
          DocumentApp.ElementType.INLINE_IMAGE
        );

        if (inlineImage) {
          const imageElement = inlineImage.getElement().asInlineImage();
          const blob = imageElement.getBlob();
          elementData = {
            type: "IMAGE",
            bytes: blob.getBytes(),
            contentType: blob.getContentType(),
            alt: imageElement.getAltDescription(),
          };
        } else if (paragraph.getText().trim() !== "") {
          elementData = {
            type: "PARAGRAPH",
            text: _processTextAttributes(paragraph.asText()),
            heading: paragraph.getHeading().toString(),
          };
        }
        break;

      case DocumentApp.ElementType.LIST_ITEM:
        const listItem = element.asListItem();
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
        break;
    }

    if (elementData) {
      data.push(elementData);
    }
  });
  return data;
}

// --- 以下、ヘルパー関数とUI関数 ---

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
  const saveAction = CardService.newAction().setFunctionName(
    "handleSaveSettingsAction"
  );
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
        .setTitle("コンテンツのルートディレクトリ (タブ使用時)")
        .setHint("例: content/posts")
        .setValue(settings.CONTENT_ROOT_PATH || "")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("FILE_PATH")
        .setTitle("ファイルパス (タブ不使用時)")
        .setHint("「ドキュメント全体」を更新する場合のフルパス")
        .setValue(settings.FILE_PATH || "")
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
  if (text === null || text.trim() === "") {
    return text;
  }
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
