/**
 * Settings Functions
 * 設定の取得と保存を担当します。
 */

/**
 * 設定を取得します。
 * (Public API)
 * @returns {object} 保存されている設定オブジェクト。
 */
function getSettings() {
  // 暗号化されたトークンを含むプロパティをそのまま返す
  // UI側ではパスワードフィールドに入力されるか、そもそも表示されないため安全
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

  // 既存の設定とマージ
  const newSettings = { ...currentSettings, ...formObject };

  // GITHUB_TOKENの処理
  if (formObject.GITHUB_TOKEN) {
    // ユーザーが新しく入力した場合 -> 暗号化して保存
    // 暗号化キーがない場合はここで自動生成される
    newSettings.GITHUB_TOKEN = _encrypt(formObject.GITHUB_TOKEN);
  } else {
    // 空欄の場合 -> 既存の値を維持 (暗号化済みのまま)
    newSettings.GITHUB_TOKEN = currentSettings.GITHUB_TOKEN || "";
  }

  docProps.setProperties(newSettings);
  return true;
}
