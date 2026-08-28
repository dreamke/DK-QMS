import { useState } from 'react';
import AppLayout from './components/AppLayout';
import ImportPage from './pages/ImportPage';
import SettingsPage from './pages/SettingsPage';
import ResultPage from './pages/ResultPage';
import type { Annotation, ReviewQuestion, ReviewStats } from './api/client';

export interface DocState {
  name: string;
  size: number;
  buffer: ArrayBuffer;
  kind?: 'docx' | 'pdf';
}

export interface ReviewResult {
  annotations: Annotation[];
  questions: ReviewQuestion[];
  stats: ReviewStats | null;
}

export type PageKey = 'import' | 'settings' | 'result';

export default function App() {
  const [page, setPage] = useState<PageKey>('import');
  const [doc, setDoc] = useState<DocState | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);

  return (
    <AppLayout page={page} onChange={setPage} hasResult={!!result}>
      {page === 'import' && (
        <ImportPage
          doc={doc}
          onDoc={(d) => {
            setDoc(d);
            if (!d) setResult(null);
          }}
          onReviewed={(r) => {
            setResult(r);
            setPage('result');
          }}
        />
      )}
      {page === 'settings' && <SettingsPage />}
      {page === 'result' && (
        <ResultPage doc={doc} result={result} onResultChange={setResult} onBack={() => setPage('import')} />
      )}
    </AppLayout>
  );
}
