'use strict';

/**
 * GitHubリポジトリのファイルを更新します。
 *
 * @param {string} content 更新するファイルの内容。
 * @param {string} path リポジトリ内のファイルパス。
 * @param {string} commitMessage コミットメッセージ。
 * @returns {object} GitHub APIからのレスポンス。
 */
function updateGitHubFile(content, path, commitMessage) {
  // スクリプトプロパティから設定を読み込む
  const props = PropertiesService.getScriptProperties();
  const githubToken = props.getProperty('GITHUB_TOKEN');
  const repoOwner = props.getProperty('REPO_OWNER');
  const repoName = props.getProperty('REPO_NAME');
  const branch = props.getProperty('BRANCH');

  if (!githubToken || !repoOwner || !repoName || !branch) {
    throw new Error('必要なスクリプトプロパティ（GITHUB_TOKEN, REPO_OWNER, REPO_NAME, BRANCH）が設定されていません。');
  }

  const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${path}`;
  const headers = {
    'Authorization': `token ${githubToken}`,
    'Accept': 'application/vnd.github.v3+json',
  };

  // ファイルの現在のSHAを取得
  const getFileResponse = UrlFetchApp.fetch(apiUrl, { headers: headers, muteHttpExceptions: true });
  const fileData = JSON.parse(getFileResponse.getContentText());

  const payload = {
    message: commitMessage,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: branch,
    sha: fileData.sha, // 既存のファイルを更新する場合はSHAが必要
  };

  const options = {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  return JSON.parse(response.getContentText());
}
