/**
 * Markdown Builder Logic
 * 解析されたデータオブジェクトをMarkdown形式に変換します。
 */

/**
 * Returns the generated Markdown and images for preview purposes.
 * Internal helper for executePreviewFromDialog.
 * @return {object} { markdown: string, images: Array }
 */
function getPreviewData_(doc, selectedTabId) {
  const dataObject = buildDocumentData_(doc, selectedTabId);
  return convertDataToMarkdown_(dataObject, "", "images", "preview");
}

function applyMarkdownWithHardBreaks_(textSegments) {
  const markdownText = applyMarkdownToSegments_(textSegments);
  // パラグラフやリストアイテム内でも改行コードがあれば強制改行(  \n)に変換
  return markdownText.replace(/[\r\n\v]+/g, "  \n");
}

/**
 * Converts the data object from the caller into a complete Markdown file content.
 * @private
 */
function convertDataToMarkdown_(dataObject, markdownBaseDir, imageSubDir, markdownFilePrefix) {
  const { frontMatter, documentData } = dataObject;
  const images = [];
  let imageCounter = 0;

  let frontMatterString = "";
  if (frontMatter && Object.keys(frontMatter).length > 0) {
    frontMatterString += "---\n";

    if (frontMatter.date === undefined || frontMatter.date === "") {
      frontMatter.date = new Date().toISOString();
    } else {
      const parsedDate = new Date(frontMatter.date);
      if (!Number.isNaN(parsedDate.getTime())) {
        frontMatter.date = parsedDate.toISOString();
      }
    }

    for (const key in frontMatter) {
      const value = frontMatter[key];
      const arrayKeys = ["tags", "authors", "categories"];

      if (arrayKeys.includes(key)) {
        frontMatterString += `${key}:\n`;
        if (value?.includes(",")) {
          value.split(",").forEach((item) => {
            frontMatterString += `  - "${item.trim()}"\n`;
          });
        }
      } else if (key === "draft" && (value === "true" || value === "false")) {
        frontMatterString += `${key}: ${value}\n`;
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
          case "TITLE":
          case "HEADING1":
            markdownChunk = `# ${applyMarkdownToSegments_(element.text)}`;
            break;
          case "HEADING2":
            markdownChunk = `## ${applyMarkdownToSegments_(element.text)}`;
            break;
          case "HEADING3":
            markdownChunk = `### ${applyMarkdownToSegments_(element.text)}`;
            break;
          default:
            // パラグラフ内でも改行コードがあれば強制改行(  \n)に変換しておくのが親切
            markdownChunk = applyMarkdownWithHardBreaks_(element.text);
        }
        break;
      case "LIST_ITEM": {
        const indent = "  ".repeat(element.nestingLevel || 0);
        const marker = element.isNumbered ? "1." : "-";

        // リストアイテム内でのShift+Enter(垂直タブ等)を Markdownの強制改行(スペース2つ+改行)に変換
        markdownChunk = `${indent}${marker} ${applyMarkdownWithHardBreaks_(element.text)}`;
        break;
      }
      case "IMAGE": {
        imageCounter++;
        const extension = element.contentType.split("/")[1].replace("jpeg", "jpg");
        const imageName = `${markdownFilePrefix}_${imageCounter}.${extension}`;
        const linkPath = `./${imageSubDir}/${imageName}`;
        const uploadPath = [markdownBaseDir, imageSubDir, imageName].filter(Boolean).join("/");

        images.push({ path: uploadPath, bytes: element.bytes });
        markdownChunk = `![${element.alt || imageName}](${linkPath})`;
        break;
      }
      case "TABLE": {
        const formatCell = (segments) => {
          // segmentsは配列なので applyMarkdownToSegments_ でMarkdown化
          let md = applyMarkdownToSegments_(segments);
          // Markdownテーブル内で壊れる文字をエスケープ/置換
          // パイプ | はエスケープ
          md = md.replace(/\|/g, "\\|");
          // 改行は <br> タグに置換 (Markdownのテーブルセル内では改行コードが使えないため)
          // \r, \n, \v (垂直タブ) をすべてキャッチして変換
          md = md.replace(/[\r\n\v]+/g, "<br>");
          return md;
        };

        if (element.rows && element.rows.length > 0) {
          // テーブルの各行を処理
          const tableMarkdown = element.rows
            .map((row, rowIndex) => {
              // セルごとのフォーマット関数
              // 行の組み立て: | cell1 | cell2 | ... |
              const formattedRow = `| ${row.map(formatCell).join(" | ")} |`;

              // 1行目の直後にヘッダー区切り (---|---|...) を挿入
              if (rowIndex === 0) {
                // 全カラムに対して '---' を生成
                const separator = `| ${row.map(() => "---").join(" | ")} |`;
                return `${formattedRow}\n${separator}`;
              }
              return formattedRow;
            })
            .join("\n");
          markdownChunk = tableMarkdown;
        }
        break;
      }
    }

    if (!markdownChunk) {
      return acc;
    }
    if (!acc) {
      return markdownChunk;
    }

    const prevElement = documentData[index - 1];
    const separator =
      prevElement && prevElement.type === "LIST_ITEM" && element.type === "LIST_ITEM"
        ? "\n"
        : "\n\n";
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
function applyMarkdownToSegments_(textSegments) {
  if (!textSegments || !Array.isArray(textSegments)) return textSegments || "";

  return textSegments
    .map((segment) => {
      let styledText = segment.text;
      const attributes = segment.attributes || {};
      if (attributes.BOLD && attributes.ITALIC) {
        styledText = `***${styledText}***`;
      } else if (attributes.BOLD) {
        styledText = `**${styledText}**`;
      } else if (attributes.ITALIC) {
        styledText = `*${styledText}*`;
      }
      if (attributes.LINK_URL) {
        styledText = `[${styledText}](${attributes.LINK_URL})`;
      }
      return styledText;
    })
    .join("");
}
