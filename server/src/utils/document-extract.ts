import { createRequire } from "module";
import { Buffer } from "buffer";
import { Readable } from "stream";

const require = createRequire(import.meta.url);

// File extension to format mapping
const FORMAT_MAP: Record<string, string> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "docx",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".pptx": "pptx",
  ".csv": "csv",
  ".tsv": "csv",
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
  ".rtf": "text",
  ".json": "text",
  ".xml": "text",
  ".html": "text",
  ".htm": "text",
  ".py": "text",
  ".js": "text",
  ".ts": "text",
  ".java": "text",
  ".c": "text",
  ".cpp": "text",
  ".h": "text",
  ".css": "text",
  ".sql": "text",
  ".yaml": "text",
  ".yml": "text",
  ".ini": "text",
  ".cfg": "text",
  ".log": "text",
  ".tex": "text",
  ".rs": "text",
  ".go": "text",
  ".rb": "text",
  ".php": "text",
  ".sh": "text",
  ".bat": "text",
  ".r": "text",
  ".m": "text",
};

const SUPPORTED_EXTENSIONS = Object.keys(FORMAT_MAP);

export function getSupportedExtensions(): string[] {
  return SUPPORTED_EXTENSIONS;
}

export function getFormatFromPath(filePath: string): string | null {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return null;
  return FORMAT_MAP[ext] || null;
}

/**
 * Extract text content from a document buffer.
 * Supports: PDF, DOCX, XLSX, PPTX, CSV, and plain text formats.
 */
export async function extractText(
  buffer: Buffer,
  filePath: string
): Promise<{ text: string; format: string; pageCount?: number }> {
  const format = getFormatFromPath(filePath);

  if (!format) {
    const ext = filePath.match(/\.[^.]+$/)?.[0] || "unknown";
    throw new Error(
      `Unsupported file format: ${ext}. Supported formats: PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, JSON, code files`
    );
  }

  switch (format) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "xlsx":
      return extractXlsx(buffer);
    case "pptx":
      return extractPptx(buffer);
    case "csv":
      return { text: buffer.toString("utf-8"), format: "csv" };
    case "text":
      return { text: buffer.toString("utf-8"), format: "text" };
    default:
      throw new Error(`Format handler not implemented: ${format}`);
  }
}

// ── PDF ──

async function extractPdf(
  buffer: Buffer
): Promise<{ text: string; format: string; pageCount: number }> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: unknown) => {
        const obj = item as Record<string, unknown>;
        return typeof obj.str === "string" ? obj.str : "";
      })
      .join(" ");
    pages.push(pageText);
  }

  return { text: pages.join("\n\n"), format: "pdf", pageCount: doc.numPages };
}

// ── DOCX ──

async function extractDocx(
  buffer: Buffer
): Promise<{ text: string; format: string }> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value, format: "docx" };
}

// ── XLSX ──

async function extractXlsx(
  buffer: Buffer
): Promise<{ text: string; format: string }> {
  const XLSX = require("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const sheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      sheets.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
  }

  return { text: sheets.join("\n\n"), format: "xlsx" };
}

// ── PPTX ──
// PPTX files are ZIP archives containing XML slides.
// We extract text from slide XML files without external dependencies.

async function extractPptx(
  buffer: Buffer
): Promise<{ text: string; format: string; pageCount: number }> {
  const { Readable: ReadableStream } = await import("stream");
  const unzipper = await loadUnzipper();

  if (unzipper) {
    return extractPptxWithUnzipper(buffer, unzipper);
  }

  // Fallback: use JSZip-style approach with built-in decompress
  return extractPptxManual(buffer);
}

async function loadUnzipper(): Promise<any | null> {
  try {
    return await import("unzipper");
  } catch {
    return null;
  }
}

async function extractPptxWithUnzipper(
  buffer: Buffer,
  unzipper: any
): Promise<{ text: string; format: string; pageCount: number }> {
  const { Readable: ReadableStream } = await import("stream");
  const directory = await unzipper.Open.buffer(buffer);

  const slideFiles = directory.files
    .filter((f: any) => /^ppt\/slides\/slide\d+\.xml$/.test(f.path))
    .sort((a: any, b: any) => {
      const numA = parseInt(a.path.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.path.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  const slides: string[] = [];
  for (const file of slideFiles) {
    const content = await file.buffer();
    const xml = content.toString("utf-8");
    const text = extractTextFromXml(xml);
    if (text.trim()) {
      slides.push(text);
    }
  }

  return {
    text: slides.map((s, i) => `--- Slide ${i + 1} ---\n${s}`).join("\n\n"),
    format: "pptx",
    pageCount: slides.length,
  };
}

async function extractPptxManual(
  buffer: Buffer
): Promise<{ text: string; format: string; pageCount: number }> {
  // Use Node.js built-in zlib to decompress ZIP entries
  const { createInflateRaw } = await import("zlib");

  const slides: string[] = [];
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  while (offset < buffer.length - 4) {
    // Look for local file header signature (PK\x03\x04)
    if (view.getUint32(offset, true) !== 0x04034b50) break;

    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const compressionMethod = view.getUint16(offset + 8, true);

    const fileName = buffer.subarray(offset + 30, offset + 30 + nameLen).toString("utf-8");
    const dataStart = offset + 30 + nameLen + extraLen;

    if (/^ppt\/slides\/slide\d+\.xml$/.test(fileName)) {
      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

      let xml: string;
      if (compressionMethod === 0) {
        xml = compressedData.toString("utf-8");
      } else {
        xml = await new Promise<string>((resolve, reject) => {
          const inflate = createInflateRaw();
          const chunks: Buffer[] = [];
          inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
          inflate.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
          inflate.on("error", reject);
          inflate.end(compressedData);
        });
      }

      const text = extractTextFromXml(xml);
      if (text.trim()) {
        const slideNum = parseInt(fileName.match(/slide(\d+)/)?.[1] || "0");
        slides.push({ num: slideNum, text } as any);
      }
    }

    offset = dataStart + compressedSize;
  }

  // Sort by slide number
  slides.sort((a: any, b: any) => a.num - b.num);
  const sortedTexts = slides.map(
    (s: any, i: number) => `--- Slide ${i + 1} ---\n${typeof s === "string" ? s : s.text}`
  );

  return {
    text: sortedTexts.join("\n\n"),
    format: "pptx",
    pageCount: sortedTexts.length,
  };
}

/**
 * Extract text content from PowerPoint XML by stripping tags
 * and pulling text from <a:t> elements.
 */
function extractTextFromXml(xml: string): string {
  // Extract all text from <a:t>...</a:t> tags (PowerPoint text elements)
  const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
  if (!textMatches) return "";

  const texts: string[] = [];
  let lastWasParagraphEnd = false;

  for (const match of textMatches) {
    const text = match.replace(/<[^>]+>/g, "").trim();
    if (text) {
      texts.push(text);
    }
  }

  // Join with spaces, but respect paragraph breaks (consecutive <a:t> in same <a:p>)
  return texts.join(" ").replace(/\s+/g, " ").trim();
}
