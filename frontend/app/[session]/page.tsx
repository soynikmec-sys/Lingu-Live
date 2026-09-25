'use client';

import { useParams } from 'next/navigation';
import SessionViewer from '../components/SessionViewer';

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.session as string;

  return <SessionViewer sessionId={sessionId} />;
}
