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
    .addItem("設定", "showSettingsDialog")
    .addToUi();
}

function main() {
  try {
    const documentData = _buildDocumentData();
    const settings = PropertiesService.getDocumentProperties().getProperties();
    LIB.push(documentData, settings);
    DocumentApp.getUi().alert("GitHubへのPushが完了しました。");
  } catch (e) {
    Logger.log(e);
    DocumentApp.getUi().alert(`エラーが発生しました:\n${e.message}`);
  }
}

function previewMarkdown() {
  try {
    const documentData = _buildDocumentData();
    const markdownContent = LIB.getMarkdown(documentData);
    if (!markdownContent) {
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
 * Parses the active Google Doc into a serializable data array.
 * @returns {Array<Object>} A data array representing the document.
 * @private
 */
function _buildDocumentData() {
  const body = DocumentApp.getActiveDocument().getBody();
  const numChildren = body.getNumChildren();
  const data = [];

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    const type = child.getType();
    let elementData = null;

    switch (type) {
      case DocumentApp.ElementType.PARAGRAPH:
        const paragraph = child.asParagraph();
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
        const listItem = child.asListItem();
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
  }
  return data;
}

/**
 * Processes text attributes (bold, italic) for a text element.
 * @private
 */
function _processTextAttributes(textElement) {
  const text = textElement.getText();
  if (!text || text.trim() === "") return text;

  let styledText = "";
  for (let i = 0; i < text.length; i++) {
    const attributes = textElement.getAttributes(i);
    const char = text[i];

    let prefix = "";
    let suffix = "";

    if (attributes[DocumentApp.Attribute.BOLD]) {
      // Logic to handle bold tags correctly at boundaries
      if (i === 0 || !textElement.isBold(i - 1)) prefix += "**";
      if (i === text.length - 1 || !textElement.isBold(i + 1))
        suffix = "**" + suffix;
    }
    // Similar logic can be added for italic

    styledText += prefix + char + suffix;
  }
  return styledText;
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
