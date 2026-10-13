'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';
import { STATUS_LABEL, type StageKey, type StageStatus } from '@/lib/stages';

export default function StageApproval({
  tripId,
  stage,
  status,
  isOwner,
}: {
  tripId: string;
  stage: StageKey;
  status: StageStatus;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    setError('');
    const { error } = await supabaseBrowser().rpc('approve_stage', { p_trip: tripId, p_stage: stage });
    setBusy(false);
    if (error) return setError(error.message);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="panel">
      <p>
        Status da etapa: <strong>{STATUS_LABEL[status]}</strong>
      </p>
      {status === 'needs_review' && <p className="error">Algo anterior mudou. Revise e aprove novamente.</p>}
      {isOwner && status !== 'approved' && (
        <button className="btn" onClick={approve} disabled={busy}>
          Aprovar e continuar
        </button>
      )}
      {!isOwner && status !== 'approved' && (
        <p className="muted">Somente o proprietário da viagem pode aprovar esta etapa.</p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
    </div>
  );
}
