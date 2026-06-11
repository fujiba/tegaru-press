/**
 * GitHub API Interaction Logic
 * GitHub APIとの通信を担当します。
 */

/**
 * Pushes multiple files to GitHub as a single atomic commit.
 * @private
 */
function pushFilesAsSingleCommit_(files, commitMessage, settings) {
  const decryptedToken = decrypt_(settings.GITHUB_TOKEN);

  const { GITHUB_USER, GITHUB_REPO } = settings;
  const branch = settings.BRANCH_NAME || "main";

  const repoName = GITHUB_REPO.split("/")
    .pop()
    .replace(/\.git$/, "");
  const apiBase = `https://api.github.com/repos/${GITHUB_USER}/${repoName}`;

  const refData = githubApiRequest_(
    `${apiBase}/git/refs/heads/${branch}`,
    "GET",
    null,
    decryptedToken,
  );
  const latestCommitSha = refData.object.sha;
  const commitData = githubApiRequest_(
    `${apiBase}/git/commits/${latestCommitSha}`,
    "GET",
    null,
    decryptedToken,
  );
  const baseTreeSha = commitData.tree.sha;

  const treeElements = files.map((file) => {
    const blobData = githubApiRequest_(
      `${apiBase}/git/blobs`,
      "POST",
      {
        content: file.isBinary
          ? Utilities.base64Encode(file.content)
          : Utilities.base64Encode(file.content, Utilities.Charset.UTF_8),
        encoding: "base64",
      },
      decryptedToken,
    );

    return { path: file.path, mode: "100644", type: "blob", sha: blobData.sha };
  });

  const newTreeData = githubApiRequest_(
    `${apiBase}/git/trees`,
    "POST",
    {
      base_tree: baseTreeSha,
      tree: treeElements,
    },
    decryptedToken,
  );

  const newCommitData = githubApiRequest_(
    `${apiBase}/git/commits`,
    "POST",
    {
      message: commitMessage,
      tree: newTreeData.sha,
      parents: [latestCommitSha],
    },
    decryptedToken,
  );

  githubApiRequest_(
    `${apiBase}/git/refs/heads/${branch}`,
    "PATCH",
    {
      sha: newCommitData.sha,
    },
    decryptedToken,
  );
}

/**
 * A generic helper function to make requests to the GitHub API.
 * @private
 */
function githubApiRequest_(url, method, payload, token) {
  const options = {
    method: method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
    contentType: "application/json",
    muteHttpExceptions: true,
  };
  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode >= 200 && responseCode < 300) {
    return JSON.parse(responseBody);
  }
  throw new Error(`GitHub API Error (${url}, Code: ${responseCode}): ${responseBody}`);
}
