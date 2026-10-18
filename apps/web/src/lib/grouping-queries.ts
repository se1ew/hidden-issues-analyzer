import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { EvidenceRange } from './evidence';

export interface GroupMetrics {
  support: number; mentionCount: number; prevalence: number | null; signal: boolean; hidden: boolean;
  highRatingCount: number; knownRatingCount: number; highRatingShare: number | null;
  positiveSentimentCount: number; sentimentDenominator: number; positiveSentimentShare: number | null;
  positiveContextCount: number;
  coverage: { total: number; succeeded: number; failed: number; remaining: number; ratio: number | null };
  recurrence?: boolean;
}
export interface GroupEvidence extends EvidenceRange { id: string; defect: string; text: string;
  rating: number | null; sentiment: string; reviewId: string; consequences: string | null }
export type ProblemStatus = 'new' | 'confirmed' | 'rejected' | 'resolved';
export interface RunGroup { id: string; title: string; defect: string; category: string; scope: string; needsReview: boolean;
  metrics: GroupMetrics; representatives: GroupEvidence[]; mentionIds: string[];
  candidateProblems: Array<{ id: string; title: string; status: ProblemStatus }>;
  problem: { id: string; stateVersion: number; status: ProblemStatus; events: Array<{ id: string; toStatus: ProblemStatus; reason: string | null; createdAt: string }> } | null }
export interface GroupingResponse { items: RunGroup[]; total: number; pageSize: number; currentPublicationId: string | null;
  publication: { id: string; runId: string; createdAt: string; sourceId: string | null; run: { total: number; succeeded: number; failed: number; status: string } } | null }
export type GroupingChange = { kind: 'merge'; snapshotIds: string[] } | { kind: 'split'; snapshotId: string; parts: string[][] }
  | { kind: 'restore' } | { kind: 'link'; snapshotId: string; problemId: string };
export interface EditGroupingInput { expectedPublicationId: string; reason: string; change: GroupingChange; commit: boolean }
export interface GroupingPreview { preview: Array<{ title: string; metrics: GroupMetrics; mentionIds: string[]; problemId: string | null }>; committed: boolean; publicationId: string }

export function useGroupings(productId: string | null, runId: string, publicationId: string, page: number) {
  return useQuery({ queryKey: ['groupings', productId, runId, publicationId, page], enabled: !!productId,
    queryFn: async () => (await api.get<GroupingResponse>('/api/issues/groupings', { params: { productId, page, pageSize: 20,
      ...(runId ? { runId } : {}), ...(publicationId ? { publicationId } : {}) } })).data });
}
export function useGroupingHistory(productId: string | null) {
  return useQuery({ queryKey: ['grouping-history', productId], enabled: !!productId,
    queryFn: async () => (await api.get<{ items: Array<{ id: string; runId: string; sourceId: string | null; action: { kind: string; reason?: string }; createdAt: string }> }>('/api/issues/groupings/history', { params: { productId } })).data });
}
export function useGroupEvidence(snapshotId: string, page: number) {
  return useQuery({ queryKey: ['group-evidence', snapshotId, page],
    queryFn: async () => (await api.get<{ items: GroupEvidence[]; total: number; pageSize: number; offsetUnit: string }>(`/api/issues/snapshots/${snapshotId}/evidence`, { params: { page, pageSize: 10 } })).data });
}
export function useEditGrouping() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ publicationId, input }: { publicationId: string; input: EditGroupingInput }) =>
    (await api.post<GroupingPreview>(`/api/issues/groupings/${publicationId}/edit`, input)).data,
    onSuccess: data => { if (data.committed) { void qc.invalidateQueries({ queryKey: ['groupings'] }); void qc.invalidateQueries({ queryKey: ['grouping-history'] }); } } });
}
export function useSetProblemState() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, ...input }: { id: string; status: ProblemStatus; expectedVersion: number; reason?: string }) =>
    (await api.patch(`/api/issues/problems/${id}/state`, input)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['groupings'] }); } });
}
export function useRecomputeGrouping() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (runId: string) => (await api.post('/api/issues/recompute', { runId })).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['groupings'] }); void qc.invalidateQueries({ queryKey: ['grouping-history'] }); } });
}
