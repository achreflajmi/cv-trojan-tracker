import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
  StandardFonts,
  TextRenderingMode,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { injectedText, type Battery } from './battery.ts';
import {
  HIDDEN_CONDITIONS,
  type CvVariant,
  type HidingMethod,
  type Job,
  type Profile,
} from './types.ts';

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 50;
const BODY_SIZE = 10;
const LINE = 14;
const TINY_SIZE = 0.5; // SPEC 3.3: font size <= 1 pt
const OFFPAGE_X = PAGE.width + 100; // right of the page's visible area (MediaBox)

export async function renderCv(
  profile: Profile,
  job: Job,
  variant: CvVariant,
  battery: Pick<Battery, 'common' | 'injections'>,
): Promise<Uint8Array> {
  const hidden = HIDDEN_CONDITIONS.includes(variant.condition);
  if (hidden !== (variant.hiding !== undefined)) {
    throw new Error(`${variant.condition} ${hidden ? 'needs' : 'must not have'} a hiding method`);
  }

  const doc = await PDFDocument.create();
  // Fixed metadata so the same inputs always produce the same bytes (and the same sha256).
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  doc.setProducer('cv-trojan-tracker');
  doc.setTitle(`CV - ${profile.name}`);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const w = new Writer(page, regular, bold);

  w.line(profile.name, { font: 'bold', size: 18 });
  w.line(`${profile.email} | ${profile.location}`);
  w.gap();
  w.heading('Summary');
  w.paragraph(profile.summary);
  w.heading('Experience');
  for (const e of profile.experience) {
    w.line(`${e.title}, ${e.org} (${e.start} - ${e.end})`, { font: 'bold' });
    for (const b of e.bullets) w.paragraph(`- ${b}`);
  }
  w.heading('Education');
  for (const e of profile.education) w.line(`${e.degree}, ${e.institution}, ${e.year}`);
  w.heading('Skills');
  w.paragraph(profile.skills.join(', '));

  // The injected text always goes at the same place (end of the CV), so conditions
  // differ only in what the text says and how it is hidden.
  const text = injectedText(job, variant, battery);
  if (text !== null) {
    w.gap();
    if (variant.hiding) drawHidden(doc, page, w, text, variant.hiding);
    else w.paragraph(text);
  }

  return doc.save({ useObjectStreams: false });
}

function drawHidden(
  doc: PDFDocument,
  page: PDFPage,
  w: Writer,
  text: string,
  method: HidingMethod,
): void {
  switch (method) {
    case 'WHITE':
      w.paragraph(text, { color: rgb(1, 1, 1) });
      return;
    case 'TINY':
      w.paragraph(text, { size: TINY_SIZE });
      return;
    case 'OFFPAGE':
      w.paragraph(text, { x: OFFPAGE_X });
      return;
    case 'RENDER3':
      // Text render mode 3: glyphs are positioned but neither filled nor stroked.
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
      w.paragraph(text);
      page.pushOperators(popGraphicsState());
      return;
    case 'OCG_OFF': {
      // An optional content group (layer) that is OFF in the default view.
      const ocg = doc.context.register(
        doc.context.obj({ Type: 'OCG', Name: PDFString.of('Notes') }),
      );
      doc.catalog.set(
        PDFName.of('OCProperties'),
        doc.context.obj({ OCGs: [ocg], D: { Order: [ocg], OFF: [ocg] } }),
      );
      const { Resources } = page.node.normalizedEntries();
      Resources.set(PDFName.of('Properties'), doc.context.obj({ OC1: ocg }));
      page.pushOperators(
        PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
          PDFName.of('OC'),
          PDFName.of('OC1'),
        ]),
      );
      w.paragraph(text);
      page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
      return;
    }
  }
}

interface LineOptions {
  font?: 'regular' | 'bold';
  size?: number;
  color?: ReturnType<typeof rgb>;
  x?: number;
}

/** Minimal top-to-bottom text layout with word wrapping. One page is enough for v1 CVs. */
class Writer {
  private y = PAGE.height - MARGIN;
  private readonly page: PDFPage;
  private readonly regular: PDFFont;
  private readonly bold: PDFFont;

  constructor(page: PDFPage, regular: PDFFont, bold: PDFFont) {
    this.page = page;
    this.regular = regular;
    this.bold = bold;
  }

  line(text: string, opts: LineOptions = {}): void {
    const size = opts.size ?? BODY_SIZE;
    if (this.y < MARGIN) throw new Error('CV does not fit on one page');
    this.page.drawText(text, {
      x: opts.x ?? MARGIN,
      y: this.y,
      size,
      font: opts.font === 'bold' ? this.bold : this.regular,
      color: opts.color ?? rgb(0, 0, 0),
    });
    this.y -= Math.max(LINE, size * 1.4);
  }

  paragraph(text: string, opts: LineOptions = {}): void {
    const font = opts.font === 'bold' ? this.bold : this.regular;
    const size = opts.size ?? BODY_SIZE;
    const maxWidth = PAGE.width - 2 * MARGIN;
    let current = '';
    for (const word of text.split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
        this.line(current, opts);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) this.line(current, opts);
  }

  heading(text: string): void {
    this.gap();
    this.line(text.toUpperCase(), { font: 'bold', size: 11 });
  }

  gap(): void {
    this.y -= LINE / 2;
  }
}
