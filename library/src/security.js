/**
 * Security Helpers
 * 暗号化・復号化に関する処理を担当します。
 */

/**
 * ScriptPropertiesから暗号化キーを取得します。
 * キーが存在しない場合は自動生成して保存します。
 * @returns {string} 暗号化キー
 * @private
 */
function getEncryptionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty("ENCRYPTION_SECRET");
  if (secret) {
    return secret;
  }

  // 初回実行時など、キーがない場合はUUIDを生成して保存する。
  // 同時実行でキーが二重生成されると、先に保存されたトークンが復号不能になるためロックする
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    secret = props.getProperty("ENCRYPTION_SECRET");
    if (!secret) {
      secret = Utilities.getUuid();
      props.setProperty("ENCRYPTION_SECRET", secret);
      console.log("Initialized new encryption secret.");
    }
  } finally {
    lock.releaseLock();
  }

  return secret;
}

/**
 * AES暗号化 (CryptoJS使用)
 * @param {string} text 平文
 * @returns {string} 暗号化された文字列
 * @private
 */
function encrypt_(text) {
  if (!text) return "";
  try {
    const secret = getEncryptionSecret_();
    return cCryptoGS.CryptoJS.AES.encrypt(text, secret).toString();
  } catch (e) {
    console.error("Encryption failed:", e);
    throw new Error("暗号化処理に失敗しました。");
  }
}

/**
 * AES復号化 (CryptoJS使用)
 * @param {string} encryptedText 暗号文
 * @returns {string} 復号された平文
 * @private
 */
function decrypt_(encryptedText) {
  if (!encryptedText) return "";
  try {
    const secret = getEncryptionSecret_();
    const bytes = cCryptoGS.CryptoJS.AES.decrypt(encryptedText, secret);
    const originalText = bytes.toString(cCryptoGS.CryptoJS.enc.Utf8);

    // 復号結果が空（キー不一致などでゴミデータになった場合）のチェック
    if (!originalText && encryptedText.length > 0) {
      throw new Error("Invalid decryption result");
    }
    return originalText;
  } catch (e) {
    console.error("Decryption failed:", e);
    throw new Error(
      "GitHubトークンの復号に失敗しました。ScriptPropertiesのキーが変更された可能性があります。",
    );
  }
}
