/**
 * @fileoverview Google Docs to GitHub Markdown Publisher - Library
 * @version 3.1.0
 * Fixed a character encoding issue (UTF-8) that caused garbled text for Japanese content.
 */

/**
 * Main function to execute the push process. (Public API)
 * @param {Array<Object>} documentData An array of objects representing the document's content.
 * @param {object} settings The settings object from the document's properties.
 */
function push(documentData, settings) {
  const filePath = settings.FILE_PATH || "untitled.md";
  const markdownFilePrefix = filePath
    .split("/")
    .pop()
    .replace(/\.[^/.]+$/, "");
  const imageSubDir = settings.IMAGE_PATH || "images";
  const markdownDir = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/"))
    : "";

  const { markdown, images } = _convertDataToMarkdown(
    documentData,
    markdownDir,
    imageSubDir,
    markdownFilePrefix
  );

  if (!markdown) {
    throw new Error("The document data is empty.");
  }

  const filesToCommit = [];
  images.forEach((imageFile) => {
    filesToCommit.push({
      path: imageFile.path,
      content: imageFile.bytes,
      isBinary: true, // Mark as binary
    });
  });
  filesToCommit.push({
    path: filePath,
    content: markdown,
    isBinary: false, // Mark as text
  });

  const commitMessage =
    settings.COMMIT_MESSAGE || "Updated content from Google Docs";
  _pushFilesAsSingleCommit(filesToCommit, commitMessage, settings);
}

/**
 * Returns the generated Markdown for preview purposes. (Public API)
 * @param {Array<Object>} documentData An array of objects representing the document's content.
 * @return {string} The generated Markdown content.
 */
function getMarkdown(documentData) {
  const { markdown } = _convertDataToMarkdown(
    documentData,
    "",
    "images",
    "image"
  );
  return markdown;
}

// --- Data Conversion Logic (Internal) ---

/**
 * Converts the data array from the caller into Markdown text and a list of images.
 * @private
 */
function _convertDataToMarkdown(
  data,
  markdownBaseDir,
  imageSubDir,
  markdownFilePrefix
) {
  const images = [];
  let imageCounter = 0;

  const markdownContent = data
    .map((element) => {
      switch (element.type) {
        case "PARAGRAPH":
          switch (element.heading) {
            case "HEADING1":
              return `# ${element.text}`;
            case "HEADING2":
              return `## ${element.text}`;
            case "HEADING3":
              return `### ${element.text}`;
            default:
              return element.text;
          }
        case "LIST_ITEM":
          const indent = "  ".repeat(element.nestingLevel || 0);
          const marker = element.isNumbered ? "1." : "-";
          return `${indent}${marker} ${element.text}`;
        case "IMAGE":
          imageCounter++;
          const extension = element.contentType
            .split("/")[1]
            .replace("jpeg", "jpg");
          const imageName = `${markdownFilePrefix}_${imageCounter}.${extension}`;

          const linkPath = `./${imageSubDir}/${imageName}`;
          const uploadPath =
            (markdownBaseDir ? `${markdownBaseDir}/` : "") +
            `${imageSubDir}/${imageName}`;

          images.push({ path: uploadPath, bytes: element.bytes });
          return `![${element.alt || imageName}](${linkPath})`;
        default:
          return "";
      }
    })
    .join("\n\n");

  return { markdown: markdownContent, images: images };
}

// --- Git Trees API Implementation (Internal) ---
/**
 * Pushes multiple files to GitHub as a single atomic commit.
 * @private
 */
function _pushFilesAsSingleCommit(files, commitMessage, settings) {
  const { GITHUB_USER, GITHUB_REPO, GITHUB_TOKEN } = settings;
  const branch = settings.BRANCH_NAME || "main";

  const repoName = GITHUB_REPO.split("/")
    .pop()
    .replace(/\.git$/, "");
  const apiBase = `https://api.github.com/repos/${GITHUB_USER}/${repoName}`;

  const refData = __githubApiRequest(
    `${apiBase}/git/refs/heads/${branch}`,
    "GET",
    null,
    GITHUB_TOKEN
  );
  const latestCommitSha = refData.object.sha;
  const commitData = __githubApiRequest(
    `${apiBase}/git/commits/${latestCommitSha}`,
    "GET",
    null,
    GITHUB_TOKEN
  );
  const baseTreeSha = commitData.tree.sha;

  const treeElements = files.map((file) => {
    // FIX: Specify UTF-8 for text files, but not for binary (image) files.
    const encodedContent = file.isBinary
      ? Utilities.base64Encode(file.content)
      : Utilities.base64Encode(file.content, Utilities.Charset.UTF_8);

    const blobData = __githubApiRequest(
      `${apiBase}/git/blobs`,
      "POST",
      {
        content: encodedContent,
        encoding: "base64",
      },
      GITHUB_TOKEN
    );

    return { path: file.path, mode: "100644", type: "blob", sha: blobData.sha };
  });

  const newTreeData = __githubApiRequest(
    `${apiBase}/git/trees`,
    "POST",
    {
      base_tree: baseTreeSha,
      tree: treeElements,
    },
    GITHUB_TOKEN
  );

  const newCommitData = __githubApiRequest(
    `${apiBase}/git/commits`,
    "POST",
    {
      message: commitMessage,
      tree: newTreeData.sha,
      parents: [latestCommitSha],
    },
    GITHUB_TOKEN
  );

  __githubApiRequest(
    `${apiBase}/git/refs/heads/${branch}`,
    "PATCH",
    {
      sha: newCommitData.sha,
    },
    GITHUB_TOKEN
  );
}

/**
 * A generic helper function to make requests to the GitHub API.
 * @private
 */
function __githubApiRequest(url, method, payload, token) {
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
  } else {
    throw new Error(
      `GitHub API Error (${url}, Code: ${responseCode}): ${responseBody}`
    );
  }
}
