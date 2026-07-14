declare module 'pdf-parse' {
  interface PdfData {
    numpages: number;
    info: Record<string, unknown>;
    text: string;
  }
  function pdf(buffer: Buffer, options?: Record<string, unknown>): Promise<PdfData>;
  export default pdf;
}
