import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CvVariant, Job, Profile } from './types.ts';

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 50;
const BODY_SIZE = 10;
const LINE = 14;

/** The exact text hidden in a CV for a given variant (used later to check survival). */
export function injectedText(job: Job, variant: CvVariant): string | null {
  switch (variant.condition) {
    case 'CLEAN':
      return null;
    case 'DATA':
      return job.key_requirements.join(', ');
    default:
      throw new Error(`Condition ${variant.condition} is implemented in Stage 2`);
  }
}

export async function renderCv(
  profile: Profile,
  job: Job,
  variant: CvVariant,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Fixed metadata so the same inputs always produce the same bytes (and the same sha256).
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  doc.setProducer('cv-trojan-tracker');
  doc.setTitle(`CV - ${profile.name}`);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc.addPage([PAGE.width, PAGE.height]), regular, bold);

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

  const hidden = injectedText(job, variant);
  if (hidden !== null) {
    if (variant.hiding !== 'WHITE') {
      throw new Error(`Hiding method ${variant.hiding ?? '(none)'} is implemented in Stage 2`);
    }
    w.gap();
    w.paragraph(hidden, { color: rgb(1, 1, 1) }); // white on the white page
  }

  return doc.save({ useObjectStreams: false });
}

interface LineOptions {
  font?: 'regular' | 'bold';
  size?: number;
  color?: ReturnType<typeof rgb>;
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
      x: MARGIN,
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
