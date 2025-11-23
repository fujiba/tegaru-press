/**
 * @fileoverview Google Docs to GitHub Markdown Publisher - Library
 * @version 3.2.0
 * The push function now accepts an array of data objects to commit multiple files at once.
 */

/**
 * Main function to execute the push process. (Public API)
 * @param {Array<object>} dataObjects An array of objects, each containing frontMatter and documentData.
 * @param {object} settings The settings object from the document's properties.
 */
function push(dataObjects, settings) {
  const allFilesToCommit = [];
  const contentRoot = settings.CONTENT_ROOT_PATH || "";

  dataObjects.forEach((dataObject) => {
    if (!dataObject.frontMatter.file_path) {
      // This should be caught by the caller, but as a safeguard:
      throw new Error(
        "An item was passed without a 'file_path' in its front matter."
      );
    }

    const finalPath = [contentRoot, dataObject.frontMatter.file_path]
      .filter(Boolean)
      .join("/");
    const markdownFilePrefix = finalPath
      .split("/")
      .pop()
      .replace(/\.[^/.]+$/, "");
    const imageSubDir = settings.IMAGE_PATH || "images";
    const markdownDir = finalPath.includes("/")
      ? finalPath.substring(0, finalPath.lastIndexOf("/"))
      : "";

    const { markdown, images } = _convertDataToMarkdown(
      dataObject,
      markdownDir,
      imageSubDir,
      markdownFilePrefix
    );

    if (!markdown) return; // Skip empty sections

    // Add images for this section to the main list
    images.forEach((imageFile) => {
      allFilesToCommit.push({
        path: imageFile.path,
        content: imageFile.bytes,
        isBinary: true,
      });
    });

    // Add the markdown file for this section to the main list
    allFilesToCommit.push({
      path: finalPath,
      content: markdown,
      isBinary: false,
    });
  });

  if (allFilesToCommit.length === 0) {
    throw new Error("No content to push.");
  }

  const commitMessage =
    settings.COMMIT_MESSAGE ||
    `Update ${allFilesToCommit.length} file(s) from Google Docs`;
  _pushFilesAsSingleCommit(allFilesToCommit, commitMessage, settings);
}

/**
 * Returns the generated Markdown for preview purposes. (Public API)
 * @param {object} dataObject Contains frontMatter (object) and documentData (array).
 * @return {string} The generated Markdown content.
 */
function getMarkdown(dataObject) {
  const { markdown } = _convertDataToMarkdown(
    dataObject,
    "",
    "images",
    "preview"
  );
  return markdown;
}

// --- Data Conversion Logic (Internal) ---

/**
 * Converts the data object from the caller into a complete Markdown file content.
 * @private
 */
function _convertDataToMarkdown(
  dataObject,
  markdownBaseDir,
  imageSubDir,
  markdownFilePrefix
) {
  const { frontMatter, documentData } = dataObject;
  const images = [];
  let imageCounter = 0;

  let frontMatterString = "";
  if (frontMatter && Object.keys(frontMatter).length > 0) {
    frontMatterString += "---\n";

    // Handle date: Parse user input or set to current ISO 8601 time if empty.
    if (frontMatter.date === undefined || frontMatter.date === "") {
      frontMatter.date = new Date().toISOString();
    } else {
      const parsedDate = new Date(frontMatter.date);
      // Check if the parsed date is valid.
      if (!isNaN(parsedDate.getTime())) {
        frontMatter.date = parsedDate.toISOString();
      } // If parsing fails, the original string is kept, which might cause an error in the SSG, alerting the user.
    }

    for (const key in frontMatter) {
      const value = frontMatter[key];
      const arrayKeys = ["tags", "authors", "categories"];

      if (arrayKeys.includes(key) && value && value.includes(",")) {
        frontMatterString += `${key}:\n`;
        value.split(",").forEach((item) => {
          frontMatterString += `  - "${item.trim()}"\n`;
        });
      } else if (key === "draft" && (value === "true" || value === "false")) {
        frontMatterString += `${key}: ${value}\n`; // Don't quote boolean values
      } else {
        frontMatterString += `${key}: "${value}"\n`;
      }
    }
    frontMatterString += "---\n\n";
  }

  const markdownBody = documentData.reduce((acc, element, index) => {
    let markdownChunk = "";
    switch (element.type) {
      case "PARAGRAPH":
        switch (element.heading) {
          case "HEADING1":
            markdownChunk = `# ${_applyMarkdownToSegments(element.text)}`;
            break;
          case "HEADING2":
            markdownChunk = `## ${_applyMarkdownToSegments(element.text)}`;
            break;
          case "HEADING3":
            markdownChunk = `### ${_applyMarkdownToSegments(element.text)}`;
            break;
          default:
            markdownChunk = _applyMarkdownToSegments(element.text);
        }
        break;
      case "LIST_ITEM":
        const indent = "  ".repeat(element.nestingLevel || 0);
        const marker = element.isNumbered ? "1." : "-";
        markdownChunk = `${indent}${marker} ${_applyMarkdownToSegments(element.text)}`;
        break;
      case "IMAGE":
        imageCounter++;
        const extension = element.contentType.split("/")[1].replace("jpeg", "jpg");
        const imageName = `${markdownFilePrefix}_${imageCounter}.${extension}`;
        const linkPath = `./${imageSubDir}/${imageName}`;
        const uploadPath = (markdownBaseDir ? `${markdownBaseDir}/` : "") + `${imageSubDir}/${imageName}`;
        images.push({ path: uploadPath, bytes: element.bytes });
        markdownChunk = `!${element.alt || imageName}`;
        break;
    }

    if (!markdownChunk) {
      return acc; // If the current chunk is empty, do nothing.
    }
    if (!acc) {
      return markdownChunk; // If accumulator is empty (first element), just return the chunk.
    }

    // Determine the separator. Use a single newline between consecutive list items.
    const prevElement = documentData[index - 1];
    const separator = (prevElement && prevElement.type === "LIST_ITEM" && element.type === "LIST_ITEM") ? "\n" : "\n\n";
    return `${acc}${separator}${markdownChunk}`;
  }, "");

  return { markdown: frontMatterString + markdownBody, images: images };
}

/**
 * Applies markdown styling to a text segment based on its attributes.
 * @param {Array<Object>} textSegments An array of text segments with attributes.
 * @returns {string} The fully styled markdown text.
 * @private
 */
function _applyMarkdownToSegments(textSegments) {
  // Handle plain string for backward compatibility or if data is malformed.
  if (!textSegments || !Array.isArray(textSegments)) return textSegments || "";

  return textSegments.map(segment => {
    let styledText = segment.text;
    const attributes = segment.attributes || {};
    if (attributes["BOLD"] && attributes["ITALIC"]) {
      styledText = `***${styledText}***`;
    } else if (attributes["BOLD"]) {
      styledText = `**${styledText}**`;
    } else if (attributes["ITALIC"]) {
      styledText = `*${styledText}*`;
    }
    if (attributes["LINK_URL"]) {
      styledText = `[${styledText}](${attributes["LINK_URL"]})`;
    }
    return styledText;
  }).join("");
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
    const blobData = __githubApiRequest(
      `${apiBase}/git/blobs`,
      "POST",
      {
        content: file.isBinary
          ? Utilities.base64Encode(file.content)
          : Utilities.base64Encode(file.content, Utilities.Charset.UTF_8),
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
