/**
 * @fileoverview Global functions accessible from the Google Docs UI and HTML dialogs.
 * This script acts as a minimal wrapper that delegates UI and core logic to the library.
 */

/**
 * Adds the custom menu to the Google Docs UI when the document is opened.
 */
function onOpen() {
  // メニューの作成とハンドリングはすべてCallerが担う
  DocumentApp.getUi()
    .createMenu("サイト更新")
    .addItem("GitHubへPush", "showPushDialogHandler")
    .addItem("Markdownプレビュー", "showPreviewDialogHandler")
    .addSeparator()
    .addItem("フロントマターを挿入", "insertFrontMatterHandler")
    .addSeparator()
    .addItem("設定", "showSettingsDialogHandler")
    .addToUi();
}

/**
 * HTMLダイアログから呼び出され、設定を保存します。
 * @param {object} formObject HTMLフォームから渡される設定オブジェクト。
 * @returns {boolean}
 */
function saveSettings(formObject) {
  return TegaruPress.saveSettings(formObject);
}

/**
 * HTMLダイアログから呼び出され、Push処理をライブラリに依頼します。
 * @param {Array<string>|null} selectedTabIds 選択されたタブIDの配列。
 */
function executePushFromDialog(selectedTabIds) {
  TegaruPress.executePushFromDialog(selectedTabIds);
}

/**
 * HTMLダイアログから呼び出され、プレビュー処理をライブラリに依頼します。
 * @param {string|null} selectedTabId 選択された単一のタブID。
 */
function executePreviewFromDialog(selectedTabId) {
  try {
    TegaruPress.executePreviewFromDialog(selectedTabId);
  } catch (e) {
    Logger.log(e);
    DocumentApp.getUi().alert(`プレビュー中にエラーが発生しました:\n${e.message}`);
  }
}

/**
 * Handles the 'GitHubへPush' menu item click.
 */
function showPushDialogHandler() {
  const doc = DocumentApp.getActiveDocument();
  const tabs = TegaruPress.getFlattenedTabs(doc); // タブ情報取得はライブラリに依頼

  if (tabs.length > 1) {
    const htmlTemplate = HtmlService.createTemplateFromFile("TabSelectionDialog");
    htmlTemplate.tabs = tabs;
    htmlTemplate.action = "push"; // ダイアログのモードを'push'に設定
    const htmlOutput = htmlTemplate.evaluate().setWidth(400).setHeight(350);
    DocumentApp.getUi().showModalDialog(htmlOutput, "Pushするタブを選択");
  } else {
    // タブがない、または1つだけの場合は直接実行
    executePushFromDialog(null);
  }
}

/**
 * Handles the 'Markdownプレビュー' menu item click.
 */
function showPreviewDialogHandler() {
  const doc = DocumentApp.getActiveDocument();
  const tabs = TegaruPress.getFlattenedTabs(doc); // タブ情報取得はライブラリに依頼

  if (tabs.length > 0) {
    const htmlTemplate = HtmlService.createTemplateFromFile("TabSelectionDialog");
    htmlTemplate.tabs = tabs;
    htmlTemplate.action = "preview"; // ダイアログのモードを'preview'に設定
    const htmlOutput = htmlTemplate.evaluate().setWidth(400).setHeight(350);
    DocumentApp.getUi().showModalDialog(htmlOutput, "プレビューするタブを選択");
  } else {
    executePreviewFromDialog(null);
  }
}

/**
 * Handles the 'フロントマターを挿入' menu item click.
 * This now shows a dialog to get initial data.
 */
function insertFrontMatterHandler() {
  const html = HtmlService.createTemplateFromFile("NewPageDialog").evaluate()
      .setTitle("フロントマター設定");
  DocumentApp.getUi().showModalDialog(html, "フロントマター設定");
}

/**
 * UIから呼び出され、データ付きでフロントマター挿入をライブラリに依頼します。
 */
function executeInsertFrontMatter(formObject) {
  TegaruPress.executeInsertFrontMatter(formObject);
}

/**
 * Handles the '設定' menu item click.
 */
function showSettingsDialogHandler() {
  const htmlTemplate = HtmlService.createTemplateFromFile("SettingsDialog");
  // 設定値の取得はライブラリに依頼
  htmlTemplate.settings = TegaruPress.getSettings();
  const htmlOutput = htmlTemplate.evaluate().setWidth(400).setHeight(550);
  DocumentApp.getUi().showModalDialog(htmlOutput, "設定");
}