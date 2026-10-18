import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAnalysisRun, useAnalysisRuns } from '../lib/queries';
import { useAnalysisStore } from '../store/analysis.store';
import { useProductStore } from '../store/product.store';
import { useOwnerId } from '../lib/data-scope';
import { invalidateProductData } from '../lib/invalidation';
import { connectSocket } from '../lib/socket';
import { Link } from 'react-router-dom';

/** Mounted by the authenticated shell, so restoration works on every page. */
export function AnalysisRunSync() {
  const productId = useProductStore(state => state.selectedProductId);
  const trackedId = useAnalysisStore(state => state.selectedRunId);
  const history = useAnalysisRuns(productId); const detail = useAnalysisRun(trackedId);
  const ownerId = useOwnerId(); const qc = useQueryClient();
  const previous = useRef<{ id: string; version: number; status: string } | null>(null);
  const scope = useRef({ ownerId, productId });
  const progress = useAnalysisStore(state => state.progress);
  useEffect(() => {
    if (scope.current.ownerId !== ownerId || scope.current.productId !== productId) {
      previous.current = null; useAnalysisStore.getState().clear(); scope.current = { ownerId, productId };
    }
  }, [ownerId, productId]);
  useEffect(() => {
    if (!history.data) return;
    if (trackedId && !history.data.items.some(run => run.id === trackedId) && !detail.data) return;
    const latest = history.data.items.find(run => ['queued', 'running'].includes(run.status))
      ?? history.data.items.find(run => run.id === useAnalysisStore.getState().selectedRunId)
      ?? history.data.items[0];
    if (!latest) return;
    const run = detail.data && ((!latest || detail.data.createdAt > latest.createdAt) || (detail.data.id === latest.id && detail.data.stateVersion > latest.stateVersion)) ? detail.data : latest;
    if (!run) return;
    if (productId && run.productId !== productId) return;
    useAnalysisStore.getState().syncRun(run);
    if (!previous.current && productId && ['queued', 'running'].includes(run.status) && !useProductStore.getState().selectedRunId) {
      useProductStore.getState().setDataScope({ runId: run.id, from: run.scope?.period?.from ?? null, to: run.scope?.period?.to ?? null });
    }
    if (previous.current?.id === run.id && previous.current.version === run.stateVersion) return;
    const was = previous.current; previous.current = { id: run.id, version: run.stateVersion, status: run.status };
    if (!['queued', 'running'].includes(run.status) && (!was || was.id !== run.id || ['queued', 'running'].includes(was.status))) {
      void invalidateProductData(qc, ownerId, run.productId, ['reviews', 'stats', 'timeseries', 'aspects', 'products', 'groupings', 'grouping-history']);
    }
  }, [history.data, detail.data, trackedId, productId, ownerId, qc]);
  useEffect(() => {
    const socket = connectSocket();
    const updated = (event: { productId?: string; runId?: string }) => {
      if (productId && event.productId && event.productId !== productId) return;
      void invalidateProductData(qc, ownerId, event.productId ?? productId, ['analysis-runs']);
      if (event.runId) void qc.invalidateQueries({ queryKey: ['analysis-run', ownerId, event.runId] });
    };
    socket.on('analysis:state', updated);
    const subscribe = () => {
      if (trackedId) socket.emit('job:subscribe', trackedId);
      void invalidateProductData(qc, ownerId, productId, ['analysis-runs']);
    };
    socket.on('connect', subscribe);
    if (trackedId) socket.emit('job:subscribe', trackedId);
    return () => { socket.off('analysis:state', updated); socket.off('connect', subscribe); };
  }, [productId, trackedId, qc, ownerId]);
  return progress ? <div role="status" className="card mb-4 flex flex-wrap gap-3 justify-between text-sm"><span>Анализ: {progress.label ?? progress.step ?? 'В работе'} · {progress.processed}/{progress.total}</span><Link className="underline" to="/reviews">Открыть состояние запуска</Link></div> : null;
}
