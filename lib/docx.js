// Generates ATS-friendly, single-column Word (.docx) documents.
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from 'docx';

const LABELS = {
  tr: {
    summary: 'Profesyonel Özet',
    skills: 'Yetkinlikler',
    experience: 'İş Deneyimi',
    education: 'Eğitim',
    projects: 'Projeler',
    certifications: 'Sertifikalar',
    languages: 'Yabancı Diller',
    present: 'Günümüz',
  },
  en: {
    summary: 'Professional Summary',
    skills: 'Skills',
    experience: 'Work Experience',
    education: 'Education',
    projects: 'Projects',
    certifications: 'Certifications',
    languages: 'Languages',
    present: 'Present',
  },
};

const FONT = 'Calibri';
const ACCENT = '2B3A67';

const page = {
  page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } },
};

const styles = {
  default: { document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { line: 276 } } } },
};

const run = (text, opts = {}) => new TextRun({ text, font: FONT, ...opts });

function heading(text, locale) {
  return new Paragraph({
    children: [run(text.toLocaleUpperCase(locale), { bold: true, size: 23, color: ACCENT })],
    spacing: { before: 260, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B8BFD6', space: 3 } },
  });
}

const bullet = (text) => new Paragraph({ children: [run(text)], bullet: { level: 0 }, spacing: { after: 40 } });
const range = (start, end) => [start, end].filter(Boolean).join(' – ');
const nonEmpty = (list) => (list || []).filter((x) => (typeof x === 'string' ? x.trim() : x));

export async function cvToDocx(cv) {
  const L = cv.language === 'en' ? LABELS.en : LABELS.tr;
  const locale = cv.language === 'en' ? 'en-US' : 'tr-TR';
  const children = [];

  children.push(new Paragraph({ children: [run(cv.name || 'Ad Soyad', { bold: true, size: 40 })], spacing: { after: 40 } }));
  if (cv.headline) children.push(new Paragraph({ children: [run(cv.headline, { size: 24, color: '444444' })], spacing: { after: 60 } }));
  const contact = [cv.email, cv.phone, cv.location, ...nonEmpty(cv.links)].filter(Boolean).join('  |  ');
  if (contact) children.push(new Paragraph({ children: [run(contact, { size: 19, color: '333333' })], spacing: { after: 120 } }));

  if (cv.summary) {
    children.push(heading(L.summary, locale), new Paragraph({ children: [run(cv.summary)], alignment: AlignmentType.JUSTIFIED }));
  }

  const skills = nonEmpty(cv.skills).filter((g) => nonEmpty(g.items).length);
  if (skills.length) {
    children.push(heading(L.skills, locale));
    for (const g of skills) {
      children.push(new Paragraph({
        children: [run(g.group ? `${g.group}: ` : '', { bold: true }), run(nonEmpty(g.items).join(', '))],
        spacing: { after: 50 },
      }));
    }
  }

  const experience = nonEmpty(cv.experience);
  if (experience.length) {
    children.push(heading(L.experience, locale));
    experience.forEach((job, i) => {
      children.push(new Paragraph({
        children: [run(job.role || '', { bold: true, size: 22 }), run(job.company ? `  |  ${job.company}` : '', { size: 22 })],
        spacing: { before: i ? 160 : 40, after: 20 },
      }));
      const meta = [job.location, range(job.start, job.end)].filter(Boolean).join('  ·  ');
      if (meta) children.push(new Paragraph({ children: [run(meta, { italics: true, size: 19, color: '555555' })], spacing: { after: 60 } }));
      for (const b of nonEmpty(job.bullets)) children.push(bullet(b));
    });
  }

  const education = nonEmpty(cv.education);
  if (education.length) {
    children.push(heading(L.education, locale));
    education.forEach((ed, i) => {
      children.push(new Paragraph({
        children: [run(ed.degree || '', { bold: true }), run(ed.school ? `  |  ${ed.school}` : '')],
        spacing: { before: i ? 120 : 40, after: 20 },
      }));
      const meta = [ed.location, range(ed.start, ed.end)].filter(Boolean).join('  ·  ');
      if (meta) children.push(new Paragraph({ children: [run(meta, { italics: true, size: 19, color: '555555' })] }));
      if (ed.details) children.push(new Paragraph({ children: [run(ed.details)], spacing: { after: 40 } }));
    });
  }

  const projects = nonEmpty(cv.projects);
  if (projects.length) {
    children.push(heading(L.projects, locale));
    for (const p of projects) {
      const tech = nonEmpty(p.tech).length ? ` (${nonEmpty(p.tech).join(', ')})` : '';
      children.push(new Paragraph({
        children: [run(`${p.name}${tech}: `, { bold: true }), run(p.description || '')],
        spacing: { after: 60 },
      }));
    }
  }

  const simpleSection = (title, items) => {
    if (!nonEmpty(items).length) return;
    children.push(heading(title, locale));
    for (const item of nonEmpty(items)) children.push(bullet(item));
  };
  simpleSection(L.certifications, cv.certifications);
  simpleSection(L.languages, cv.languages);
  for (const extra of nonEmpty(cv.extras)) simpleSection(extra.heading || '', extra.items);

  const doc = new Document({
    creator: 'CVPilot',
    title: `${cv.name || 'CV'} - CV`,
    styles,
    sections: [{ properties: page, children }],
  });
  return Packer.toBuffer(doc);
}

export async function letterToDocx({ text, title }) {
  const paragraphs = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      return new Paragraph({
        children: lines.map((line, i) => run(line, { break: i ? 1 : 0 })),
        spacing: { after: 220 },
      });
    });

  const doc = new Document({
    creator: 'CVPilot',
    title: title || 'Ön Yazı',
    styles: { default: { document: { run: { font: FONT, size: 23 }, paragraph: { spacing: { line: 300 } } } } },
    sections: [{ properties: { page: { margin: { top: 1300, bottom: 1300, left: 1300, right: 1300 } } }, children: paragraphs }],
  });
  return Packer.toBuffer(doc);
}
