const pdfParse = require('pdf-parse/lib/pdf-parse.js');

// pdf.js v1.10.100 會忽略 Node Buffer 的 byteOffset，
// 若傳入 multer 的記憶體池切片會讀到錯誤位移，因此先複製成精確長度的位元組。
function toExactBytes(input) {
  if (Buffer.isBuffer(input)) {
    return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  }
  return input;
}

function pageToText(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((tc) => {
    let text = '';
    let lastY;
    for (const item of tc.items) {
      const y = item.transform ? item.transform[5] : undefined;
      if (lastY === undefined || lastY === y) {
        text += item.str;
      } else {
        text += '\n' + item.str;
      }
      lastY = y;
    }
    return text;
  });
}

async function extractPdf(buffer) {
  const pages = [];
  const data = await pdfParse(toExactBytes(buffer), {
    pagerender: async (pageData) => {
      const text = await pageToText(pageData);
      pages.push(text);
      return text;
    },
  });

  if (!pages.length && data.text) pages.push(data.text);

  return {
    pages,
    numpages: data.numpages || pages.length,
    text: data.text || pages.join('\n'),
  };
}

module.exports = { extractPdf };
