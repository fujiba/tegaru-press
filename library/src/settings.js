/**
 * Settings Functions
 * 設定の取得と保存を担当します。
 */

/**
 * 暗号化済みトークンを含む全設定を取得します。(ライブラリ内部用)
 * @returns {object} 保存されている設定オブジェクト。
 * @private
 */
function getSettingsInternal_() {
  return PropertiesService.getDocumentProperties().getProperties();
}

/**
 * 設定を取得します。
 * (Public API)
 * トークンは暗号文であってもライブラリ外に出さず、設定済みかどうかをHAS_TOKENフラグで返す。
 * @returns {object} トークンを除いた設定オブジェクト。
 */
function getSettings() {
  const { GITHUB_TOKEN, ...settings } = getSettingsInternal_();
  settings.HAS_TOKEN = Boolean(GITHUB_TOKEN);
  return settings;
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

  // 既存の設定とマージ
  const newSettings = { ...currentSettings, ...formObject };

  // GITHUB_TOKENの処理
  if (formObject.GITHUB_TOKEN) {
    // ユーザーが新しく入力した場合 -> 暗号化して保存
    // 暗号化キーがない場合はここで自動生成される
    newSettings.GITHUB_TOKEN = encrypt_(formObject.GITHUB_TOKEN);
  } else {
    // 空欄の場合 -> 既存の値を維持 (暗号化済みのまま)
    newSettings.GITHUB_TOKEN = currentSettings.GITHUB_TOKEN || "";
  }

  docProps.setProperties(newSettings);
  return true;
}
