import './helpers.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { cleanText, extractCv, fixFileName } from '../lib/extract.js';
import { file, makePdf, SAMPLE_CV } from './helpers.js';

const PDF_LINES = [
  'Mehmet Demir - Backend Developer',
  'mehmet.demir@example.com  +90 532 000 00 00',
  'Experience: Built Go and PostgreSQL services handling 2 million requests per day.',
  'Led the migration of 14 services to Kubernetes and reduced cloud costs by 30 percent.',
  'Skills: Go, PostgreSQL, Kubernetes, Docker, gRPC, Redis',
];

describe('cleanText and fixFileName', () => {
  it('normalises whitespace from different sources', () => {
    assert.equal(cleanText('a\r\nb c  \n\n\n\nd  '), 'a\nb c\n\nd');
  });

  it('repairs UTF-8 file names that multer decoded as latin1', () => {
    const mangled = Buffer.from('Ömer_CV.pdf', 'utf8').toString('latin1');
    assert.equal(fixFileName(mangled), 'Ömer_CV.pdf');
    assert.equal(fixFileName('plain.pdf'), 'plain.pdf');
  });
});

describe('extractCv', () => {
  it('reads plain text and reports word counts', async () => {
    const result = await extractCv(file('cv.txt', SAMPLE_CV, 'text/plain'));
    assert.equal(result.source, 'txt');
    assert.equal(result.ocr, false);
    assert.ok(result.words > 100);
    assert.deepEqual(result.notes, []);
  });

  it('extracts text from a real PDF', async () => {
    const result = await extractCv(file('cv.pdf', makePdf(PDF_LINES), 'application/pdf'));
    assert.equal(result.source, 'pdf');
    assert.match(result.text, /Mehmet Demir/);
    assert.match(result.text, /Kubernetes/);
  });

  it('treats a PDF without selectable text as scanned', async () => {
    const scanned = makePdf(['Page 1']);
    await assert.rejects(extractCv(file('scan.pdf', scanned, 'application/pdf')), { status: 422 });
    const transcribe = async () => SAMPLE_CV;
    const result = await extractCv(file('scan.pdf', scanned, 'application/pdf'), { transcribe });
    assert.equal(result.ocr, true);
    assert.equal(result.notes[0].level, 'kritik');
  });

  it('flags tables in DOCX files, which many ATS parsers scramble', async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun(SAMPLE_CV.split('\n').slice(0, 6).join(' '))] }),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('React, TypeScript, Node.js')] })] })] }),
        ],
      }],
    });
    const result = await extractCv(file('cv.docx', await Packer.toBuffer(doc)));
    assert.equal(result.source, 'docx');
    assert.ok(result.notes.some((n) => n.text.includes('tablo')));
  });

  it('replaces icon-font glyphs and warns about them', async () => {
    const withIcons = ` ${SAMPLE_CV}\n Ankara  `;
    const result = await extractCv(file('cv.txt', withIcons, 'text/plain'));
    assert.ok(result.notes.some((n) => n.text.includes('ikon')));
    assert.doesNotMatch(result.text, /[-]/);
  });

  it('warns when no e-mail address can be found', async () => {
    const result = await extractCv(file('cv.txt', SAMPLE_CV.replace(/\S+@\S+/, ''), 'text/plain'));
    assert.ok(result.notes.some((n) => n.text.includes('e-posta')));
  });

  it('rejects unsupported and unreadable input with user-facing messages', async () => {
    await assert.rejects(extractCv(file('old.doc', 'x')), /\.doc formatı desteklenmiyor/);
    await assert.rejects(extractCv(file('cv.exe', 'x')), /Desteklenmeyen dosya türü/);
    await assert.rejects(extractCv(file('empty.txt', 'kısa', 'text/plain')), { status: 422 });
    await assert.rejects(extractCv(file('broken.docx', 'not a zip')), /DOCX dosyası okunamadı/);
  });

  it('needs the model to read images, and marks them as an ATS risk', async () => {
    const png = file('cv.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png');
    await assert.rejects(extractCv(png), { status: 422 });
    const result = await extractCv(png, { transcribe: async ({ mediaType }) => `${mediaType}\n${SAMPLE_CV}` });
    assert.equal(result.ocr, true);
    assert.match(result.text, /^image\/png/);
    assert.equal(result.notes[0].level, 'kritik');
  });
});
