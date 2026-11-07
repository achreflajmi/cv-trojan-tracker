import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const PDFJS_VERSION: string = version;

// pdf.js needs its standard font data to read PDFs that use the 14 built-in fonts.
const require = createRequire(import.meta.url);
const standardFontDataUrl = new URL(
  'standard_fonts/',
  pathToFileURL(require.resolve('pdfjs-dist/package.json')),
).href;

/** Extract text the way a typical screening pipeline would: all text items, in order. */
export async function extractWithPdfjs(pdf: Uint8Array): Promise<string> {
  // pdf.js takes ownership of the buffer it is given, so pass a copy.
  const task = getDocument({ data: pdf.slice(), standardFontDataUrl, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
      }
      pages.push(text.trim());
    }
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}
