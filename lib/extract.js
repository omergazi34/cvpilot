// Extracts text from an uploaded CV (PDF, DOCX, TXT, image) and flags formatting that
// commonly breaks ATS parsers.
import path from 'node:path';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { UserError } from './errors.js';

async function readPdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const TEXT_TYPES = new Set(['.txt', '.md']);

// Multer decodes UTF-8 file names as latin1 ("Ã¶" instead of "ö"); undo that.
export function fixFileName(name = '') {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

export function cleanText(text = '') {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ') // non-breaking spaces from Word/PDF
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const countWords = (text) => (text.match(/\S+/g) || []).length;

/**
 * @param {{ originalname: string, mimetype: string, buffer: Buffer }} file
 * @param {{ transcribe?: (doc: {mediaType: string, data: string}) => Promise<string> }} options
 */
export async function extractCv(file, { transcribe } = {}) {
  const fileName = fixFileName(file.originalname);
  const ext = path.extname(fileName).toLowerCase();
  const notes = []; // formatting findings, shown to the user and passed to the model
  let text = '';
  let source;
  let ocr = false;

  if (ext === '.pdf' || file.mimetype === 'application/pdf') {
    source = 'pdf';
    let parseFailed = false;
    try {
      text = cleanText(await readPdfText(file.buffer));
    } catch {
      // Non-standard PDF: fall back to reading it with the model, if available.
      if (!transcribe) throw new UserError('PDF okunamadı. Dosya bozuk veya şifreli olabilir.');
      parseFailed = true;
    }
    if (parseFailed) {
      text = cleanText(await transcribe({ mediaType: 'application/pdf', data: file.buffer.toString('base64') }));
      ocr = true;
    } else if (text.replace(/\s/g, '').length < 150) {
      notes.push({
        level: 'kritik',
        text: 'PDF içinde seçilebilir metin bulunamadı (taranmış görsel olabilir). Çoğu ATS bu dosyayı boş olarak okur; metin tabanlı PDF veya DOCX kullanın.',
      });
      if (!transcribe) {
        throw new UserError('Bu PDF taranmış bir görsel gibi görünüyor ve metin içermiyor. Yapay zekâ ile okumak için API anahtarı gerekli; ya da metin tabanlı PDF/DOCX yükleyin.', 422);
      }
      text = cleanText(await transcribe({ mediaType: 'application/pdf', data: file.buffer.toString('base64') }));
      ocr = true;
    }
  } else if (ext === '.docx') {
    source = 'docx';
    try {
      const [raw, html] = await Promise.all([
        mammoth.extractRawText({ buffer: file.buffer }),
        mammoth.convertToHtml({ buffer: file.buffer }),
      ]);
      text = cleanText(raw.value);
      if (/<table/i.test(html.value)) {
        notes.push({ level: 'orta', text: 'Belgede tablo kullanılmış. Bazı ATS sistemleri tablo içindeki metni karışık sırayla okur veya atlar.' });
      }
      if (/<img/i.test(html.value)) {
        notes.push({ level: 'dusuk', text: 'Belgede görsel (fotoğraf/logo/ikon) var. ATS görselleri okuyamaz; önemli bilgileri görsel içine koymayın.' });
      }
    } catch {
      throw new UserError('DOCX dosyası okunamadı. Dosya bozuk olabilir.');
    }
  } else if (ext === '.doc') {
    throw new UserError('Eski .doc formatı desteklenmiyor. Word\'de "Farklı Kaydet → .docx" ya da PDF olarak kaydedip tekrar yükleyin.');
  } else if (TEXT_TYPES.has(ext) || file.mimetype?.startsWith('text/')) {
    source = 'txt';
    text = cleanText(file.buffer.toString('utf8'));
  } else if (IMAGE_TYPES[ext] || file.mimetype?.startsWith('image/')) {
    source = 'image';
    notes.push({ level: 'kritik', text: 'CV bir görsel dosyası. ATS sistemleri görsellerdeki metni okuyamaz; başvuruda metin tabanlı PDF veya DOCX kullanın.' });
    if (!transcribe) {
      throw new UserError('Görsel CV\'leri okumak için yapay zekâ gerekli (API anahtarı). Alternatif olarak PDF/DOCX yükleyin.', 422);
    }
    const mediaType = IMAGE_TYPES[ext] || file.mimetype;
    if (!Object.values(IMAGE_TYPES).includes(mediaType)) {
      throw new UserError('Desteklenen görsel türleri: PNG, JPG, WEBP.');
    }
    text = cleanText(await transcribe({ mediaType, data: file.buffer.toString('base64') }));
    ocr = true;
  } else {
    throw new UserError('Desteklenmeyen dosya türü. PDF, DOCX, TXT veya görsel (PNG/JPG) yükleyin.');
  }

  if (text.replace(/\s/g, '').length < 40) {
    throw new UserError('Dosyadan yeterli metin çıkarılamadı. Farklı bir dosya deneyin veya metni elle yapıştırın.', 422);
  }

  // Private Use Area characters usually come from icon fonts and show up as garbage in an ATS.
  const iconChars = (text.match(/[-]/g) || []).length;
  if (iconChars > 2) {
    notes.push({ level: 'orta', text: `Metinde ${iconChars} adet ikon/simge karakteri bulundu. ATS bunları bozuk karakter olarak okuyabilir; ikon yerine düz metin kullanın.` });
    text = text.replace(/[-]/g, '•');
  }
  if (!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) {
    notes.push({ level: 'orta', text: 'Metinde e-posta adresi bulunamadı. İletişim bilgileri üst bilgi (header) alanında veya görsel içinde olabilir; ATS bunları okumayabilir.' });
  }

  return {
    fileName,
    source,
    ocr,
    text,
    words: countWords(text),
    chars: text.length,
    notes,
  };
}
