/// <reference types="vite/client" />

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const getDocument: any;
  export const GlobalWorkerOptions: { workerSrc: string };
  export const version: string;
  const _default: any;
  export default _default;
}
