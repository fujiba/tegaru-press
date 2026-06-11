/**
 * Settings Functions
 * 設定の取得と保存を担当します。
 *
 * PATはドキュメントプロパティではなく、ライブラリ自身のScriptPropertiesに
 * ドキュメントIDをキーとして保存する。ライブラリのScriptPropertiesは
 * 呼び出し元スクリプトと共有されない(not-shared)ため、ドキュメントの
 * 編集権限だけではトークンを取り出せない。詳細はREADMEの「セキュリティ」参照。
 */

/**
 * ドキュメントごとのトークン保存キーを生成します。
 * @param {string} docId ドキュメントID
 * @returns {string} ScriptPropertiesのキー
 * @private
 */
function githubTokenKey_(docId) {
  return `GITHUB_TOKEN_${docId}`;
}

/**
 * 平文トークンを含む全設定を取得します。(ライブラリ内部用)
 * @returns {object} 保存されている設定オブジェクト。
 * @private
 */
function getSettingsInternal_() {
  const settings = PropertiesService.getDocumentProperties().getProperties();
  const docId = DocumentApp.getActiveDocument().getId();
  settings.GITHUB_TOKEN =
    PropertiesService.getScriptProperties().getProperty(githubTokenKey_(docId)) || "";
  return settings;
}

/**
 * 設定を取得します。
 * (Public API)
 * トークンはライブラリ外に出さず、設定済みかどうかをHAS_TOKENフラグで返す。
 * @returns {object} トークンを除いた設定オブジェクト。
 */
function getSettings() {
  const { GITHUB_TOKEN, ...settings } = getSettingsInternal_();
  settings.HAS_TOKEN = Boolean(GITHUB_TOKEN);
  return settings;
}

/**
 * 設定を保存します。(UIから呼ばれる)
 * (Public API)
 * トークン以外はドキュメントプロパティへ、トークンはライブラリの
 * ScriptPropertiesへ保存する。トークン欄が空の場合は既存の値を維持する。
 * @param {object} formObject HTMLフォームから渡される設定オブジェクト。
 * @returns {boolean} 成功したかどうか。
 */
function saveSettings(formObject) {
  const docProps = PropertiesService.getDocumentProperties();

  // トークンはドキュメントプロパティに含めない
  const { GITHUB_TOKEN, ...newSettings } = { ...docProps.getProperties(), ...formObject };

  if (formObject.GITHUB_TOKEN) {
    const docId = DocumentApp.getActiveDocument().getId();
    PropertiesService.getScriptProperties().setProperty(
      githubTokenKey_(docId),
      formObject.GITHUB_TOKEN,
    );
  }

  docProps.setProperties(newSettings);
  // 旧バージョンがトークンをドキュメントプロパティに保存していたため、残骸を掃除する
  docProps.deleteProperty("GITHUB_TOKEN");
  return true;
}
