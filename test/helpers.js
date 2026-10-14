import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Tests never call the real API: make sure no credentials leak in from the environment, and keep
// tracker data out of the project folder. Import this module before anything from lib/ or app.js.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.CVPILOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cvpilot-test-'));

export const DATA_DIR = process.env.CVPILOT_DATA_DIR;

export const SAMPLE_CV = `Ayşe Yılmaz
Frontend Developer
ayse.yilmaz@example.com | +90 555 123 45 67 | linkedin.com/in/ayseyilmaz | İstanbul

Özet
React ve TypeScript ile ölçeklenebilir web uygulamaları geliştiren, 5 yıllık deneyime sahip frontend geliştirici.

İş Deneyimi
Frontend Developer | Acme Yazılım | 03/2021 - Günümüz
- React ve TypeScript ile müşteri panelini baştan geliştirdim; sayfa yüklenme süresini %40 azalttım.
- 4 kişilik ekibe liderlik ettim ve kod inceleme sürecini kurdum.
- Jest ile birim testleri yazarak hata oranını %25 düşürdüm.

Junior Developer | Beta Ajans | 06/2019 - 02/2021
- 12 kurumsal web sitesini HTML, CSS ve JavaScript ile geliştirdim.
- Müşteri taleplerine yardımcı oldum ve bakım işlerinden sorumluydum.

Eğitim
Bilgisayar Mühendisliği, Lisans | Örnek Üniversitesi | 2015 - 2019

Yetenekler
JavaScript, TypeScript, React, Node.js, Git, Docker, Jest, HTML, CSS

Yabancı Diller
İngilizce (C1)
`;

export const SAMPLE_JOB = `Senior Frontend Developer - Gama Teknoloji
Ekibimize React ve TypeScript konusunda deneyimli bir frontend geliştirici arıyoruz.
Aranan nitelikler: React, TypeScript, GraphQL, Cypress, AWS, CI/CD, erişilebilirlik.
Next.js deneyimi tercih sebebidir.`;

/**
 * Builds a minimal but valid single-page PDF (Helvetica, ASCII text) with a correct xref table,
 * so text extraction is tested against a real PDF parser rather than a mock.
 */
export function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 11 Tf 72 740 Td ${lines.map((l, i) => `${i ? '0 -14 Td ' : ''}(${esc(l)}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export const file = (originalname, buffer, mimetype = 'application/octet-stream') => ({
  originalname,
  mimetype,
  buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
});
