import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useProductStore } from '../store/product.store';
import type { EvidenceRange } from './evidence';
import { useDataScope, useOwnerId } from './data-scope';
import { invalidateProductData } from './invalidation';
import { useAnalysisStore } from '../store/analysis.store';

export interface AnalysisInputItem {
  id: string; sourceReviewId: string; text: string; rating: number | null;
  analysis: { status: string; sentiment: string | null; errorCode: string | null;
    aspects: Array<{ id: string; name: string; originalName: string | null; category: string; sentiment: string }>;
    issues: Array<EvidenceRange & { id: string; aspectId: string; scope: string; defect: string; consequences: string | null;
      masking: { positiveContext: boolean; reasons: string[]; highRating: boolean | null } | null }> } | null;
}

export function useAnalysisInputs(runId: string, page: number) {
  return useQuery({ queryKey: ['analysis-inputs', useOwnerId(), runId, page],
    queryFn: async () => (await api.get<{ items: AnalysisInputItem[]; total: number; pageSize: number; offsetUnit: string; runStatus: string }>(`/api/analysis/runs/${runId}/inputs`, {
      params: { page, pageSize: 10 },
    })).data,
    refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.runStatus ?? '') ? 2000 : false,
  });
}

export interface AnalysisRunItem {
  scope?: { period?: { from: string; to: string } };
  previousRunId?: string | null; resultsDisposition?: 'retained_unpublished' | 'run_scoped';
  id: string; runId: string; productId: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
  stage: string; total: number; succeeded: number; failed: number; processed: number; remaining: number;
  stateVersion: number; createdAt: string; startedAt: string | null; finishedAt: string | null;
  cancelRequestedAt: string | null; finishReason: string | null; provider: string; model: string;
}

export function useAnalysisRuns(productId?: string | null) {
  return useQuery({
    queryKey: ['analysis-runs', useOwnerId(), productId ?? null],
    queryFn: async () => (await api.get<{ items: AnalysisRunItem[]; total: number }>('/api/analysis/runs', {
      params: { ...(productId ? { productId } : {}), pageSize: 20 },
    })).data,
    refetchInterval: (query) => query.state.data?.items.some((run) => ['queued', 'running'].includes(run.status)) ? 1000 : 5000,
  });
}

export function useAnalysisRun(runId: string | null) {
  return useQuery({ queryKey: ['analysis-run', useOwnerId(), runId], enabled: !!runId,
    queryFn: async () => (await api.get<AnalysisRunItem>(`/api/analysis/runs/${runId}`)).data,
    refetchInterval: query => ['queued', 'running'].includes(query.state.data?.status ?? '') ? 1000 : false });
}
export function selectStartedRun(run: AnalysisRunItem) {
  if (useProductStore.getState().selectedProductId !== run.productId) return;
  useAnalysisStore.getState().syncRun(run);
  useProductStore.getState().setDataScope({ runId: run.id, from: run.scope?.period?.from ?? null, to: run.scope?.period?.to ?? null });
}
export function useRetryFailedAnalysis() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (runId: string) => (await api.post<AnalysisRunItem>(`/api/analysis/runs/${runId}/retry-failed`)).data,
    onSuccess: data => { selectStartedRun(data); void invalidateProductData(qc, ownerId, data.productId, ['analysis-runs']); },
  });
}

export const UNASSIGNED_PRODUCT_ID = '__unassigned__';

export interface Product {
  id: string;
  name: string;
  sourceUrl: string | null;
  source?: string | null;
  externalId?: string | null;
  reviewsCount: number;
  latestRun?: { id: string; status: string; total: number; succeeded: number; failed: number; createdAt: string; finishedAt: string | null } | null;
  analyzedCount: number;
  avgRating: number | null;
  createdAt: string;
}

export function useProducts() {
  return useQuery({
    queryKey: ['products', useOwnerId()],
    queryFn: async () => {
      const { data } = await api.get<{ items: Product[] }>('/api/products');
      return data;
    },
  });
}

// ===== Types =====

export interface OverviewStats {
  total: number;
  analyzed: number;
  pending: number;
  avgRating: number | null;
  sentiment: { positive: number; negative: number; neutral: number };
  negativePct: number;
  issuesCount: number;
}

export interface TimeseriesBucket {
  date: string;
  positive: number;
  negative: number;
  neutral: number;
  avgRating: number | null;
}

export interface IssueReview {
  id: string;
  text: string;
  rating: number | null;
  sentimentScore: number | null;
  createdAt: string;
}

export interface IssueWithReviews extends HiddenIssue {
  reviews: IssueReview[];
}

export interface ParsingHistoryItem {
  id: string;
  filename: string | null;
  count: number;
  createdAt: string;
}

export interface ReviewListItem {
  id: string;
  text: string;
  rating: number | null;
  sentiment: 'positive' | 'negative' | 'neutral' | null;
  sentimentScore: number | null;
  issues: string[] | null;
  aspects: Array<{ name: string; sentiment: string }> | null;
  hiddenIssueId: string | null;
  analyzedAt: string | null;
  createdAt: string;
  productId: string | null;
  product: { id: string; name: string } | null;
}

export interface ReviewsListResponse {
  items: ReviewListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HiddenIssue {
  id: string;
  title: string;
  description: string | null;
  keywords: string[] | null;
  size: number;
  severity: number;
  visibility: number;
  hiddenScore: number;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  productId: string | null;
  product: { id: string; name: string } | null;
}

export interface ReportItem {
  id: string;
  title: string;
  format: 'pdf' | 'docx';
  createdAt: string;
}

// ===== Reviews =====

export function useReviews(params: {
  page: number;
  pageSize: number;
  sentiment?: string;
  rating?: number;
  hasIssues?: boolean;
  search?: string;
  productId?: string | null;
  runId?: string; from?: string; to?: string;
}) {
  const scope = useDataScope(params.productId);
  return useQuery({
    queryKey: ['reviews', useOwnerId(), scope, params],
    queryFn: async () => {
      const { data } = await api.get<ReviewsListResponse>('/api/reviews', { params: { ...scope, ...params } });
      return data;
    },
  });
}

export type CsvField = 'text' | 'rating' | 'date' | 'externalId' | 'authorExternalId';
export type CsvMapping = Partial<Record<CsvField, string>>;
export interface CsvPreview {
  headers: string[];
  delimiter: ',' | ';' | '\t';
  mapping: CsvMapping;
  totalCount: number;
  validCount: number;
  errorCount: number;
  errors: Array<{ rowNumber: number; field: string; message: string }>;
  errorsTruncated: boolean;
  sample: Array<{ rowNumber: number; values: string[] }>;
}
export interface CsvImportResult {
  count: number; batchId: string; productId: string;
  totalCount: number; validCount: number; skippedCount: number; errorCount: number;
  status: 'completed' | 'partial';
}

export function usePreviewCsv() {
  return useMutation({
    mutationFn: async ({ file, delimiter, mapping }: { file: File; delimiter?: string; mapping?: CsvMapping }) => {
      const form = new FormData();
      form.append('file', file);
      if (delimiter) form.append('delimiter', delimiter);
      if (mapping) form.append('mapping', JSON.stringify(mapping));
      return (await api.post<CsvPreview>('/api/reviews/upload/csv/preview', form)).data;
    },
  });
}

export function useCreateProduct() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (name: string) => (await api.post<{ id: string; name: string }>('/api/products', { name })).data,
    onSuccess: data => { void invalidateProductData(qc, ownerId, data.id, ['products']); },
  });
}

export function useUploadCsv() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async ({ file, productName, productId, delimiter, mapping }: {
      file: File; productName?: string; productId?: string; delimiter?: string; mapping?: CsvMapping;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (productName?.trim()) formData.append('productName', productName.trim());
      if (productId) formData.append('productId', productId);
      if (delimiter) formData.append('delimiter', delimiter);
      if (mapping) formData.append('mapping', JSON.stringify(mapping));
      const { data } = await api.post<CsvImportResult>(
        '/api/reviews/upload/csv',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: data => { void invalidateProductData(qc, ownerId, data.productId, ['reviews', 'stats', 'timeseries', 'products', 'profile'], false); },
  });
}

export function useCreateManualReview() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (input: { text: string; rating?: number; productName?: string; productId?: string }) => {
      const { data } = await api.post<{ id: string; productId: string }>('/api/reviews/upload/text', input);
      return data;
    },
    onSuccess: data => { void invalidateProductData(qc, ownerId, data.productId, ['reviews', 'stats', 'timeseries', 'products', 'profile'], false); },
  });
}

// ===== Analysis =====
export interface LlmConfiguration {
  provider: 'local' | 'openrouter'; model: string; contextTokens: number;
  concurrency: number; responseFormat: string;
}
export function useLlmConfiguration() {
  return useQuery({
    queryKey: ['llm-configuration', useOwnerId()],
    queryFn: async () => (await api.get<LlmConfiguration>('/api/analysis/provider')).data,
  });
}
export function useCheckLlm() {
  return useMutation({
    mutationFn: async () => (await api.post<LlmConfiguration & { available: boolean }>('/api/analysis/provider/check')).data,
  });
}

export function useStats(productId?: string | null) {
  const scope = useDataScope(productId);
  return useQuery({
    queryKey: ['stats', useOwnerId(), scope],
    queryFn: async () => {
      const { data } = await api.get<OverviewStats>('/api/analysis/stats', {
        params: scope,
      });
      return data;
    },
  });
}

export function useTimeseries(
  params: { bucket?: 'day' | 'week' | 'month'; days?: number; productId?: string | null; runId?: string; from?: string; to?: string } = {},
) {
  const scope = useDataScope(params.productId);
  return useQuery({
    queryKey: ['timeseries', useOwnerId(), scope, params],
    queryFn: async () => {
      const { data } = await api.get<{ buckets: TimeseriesBucket[] }>('/api/analysis/timeseries', {
        params: {
          ...scope,
          bucket: params.bucket,
          days: params.days,
          ...(params.productId ? { productId: params.productId } : {}),
          ...(params.runId ? { runId: params.runId } : {}),
          ...(params.from ? { from: params.from, to: params.to } : {}),
        },
      });
      return data;
    },
  });
}

export function useAspects(productId: string | null) {
  const scope = useDataScope(productId);
  return useQuery({ queryKey: ['aspects', useOwnerId(), scope], enabled: !!scope.productId && !!scope.runId,
    queryFn: async () => (await api.get<{ items: Array<{ category: string; name: string; positive: number; negative: number; neutral: number }> }>('/api/analysis/aspects', { params: scope })).data });
}

export function useRunAnalysis() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (limit?: number) => {
      const { selectedProductId: productId, from, to } = useProductStore.getState();
      if (!productId) throw new Error('Выберите товар перед запуском анализа');
      return (await api.post<AnalysisRunItem & { jobId: string }>('/api/analysis/runs', { limit, productId,
        ...(from && to ? { period: { from, to } } : {}) })).data;
    },
    onSuccess: data => { selectStartedRun(data); void invalidateProductData(qc, ownerId, data.productId, ['analysis-runs']); },
  });
}

export function useCancelAnalysis() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data } = await api.post<AnalysisRunItem>(`/api/analysis/${jobId}/cancel`);
      return data;
    },
    onSuccess: data => { void invalidateProductData(qc, ownerId, data.productId, ['analysis-runs']); void qc.invalidateQueries({ queryKey: ['analysis-run', ownerId, data.id] }); },
  });
}

// ===== Issues =====

export interface HiddenIssuesResponse {
  items: HiddenIssue[];
  total: number;
  page: number;
  pageSize: number;
}

export function useHiddenIssues(productId?: string | null, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['issues', useOwnerId(), productId ?? null, page, pageSize],
    queryFn: async () => {
      const { data } = await api.get<HiddenIssuesResponse>('/api/issues', {
        params: { ...(productId ? { productId } : {}), page, pageSize },
      });
      return data;
    },
  });
}

export function useRecomputeIssues() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { data } = await api.post<{ id: string; runId: string; productId: string }>('/api/issues/recompute', { runId });
      return data;
    },
    onSuccess: data => { void invalidateProductData(qc, ownerId, data.productId, ['groupings', 'grouping-history', 'stats']); },
  });
}

// ===== Reports =====

export function useReports() {
  return useQuery({
    queryKey: ['reports', useOwnerId()],
    queryFn: async () => {
      const { data } = await api.get<{ items: ReportItem[] }>('/api/reports');
      return data;
    },
  });
}

export function useGenerateReport() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (input: { format: 'pdf' | 'docx'; title?: string }) => {
      const { data } = await api.post<{ id: string; downloadUrl: string }>(
        '/api/reports/generate',
        input,
      );
      return data;
    },
    onSuccess: () => { void invalidateProductData(qc, ownerId, null, ['reports', 'profile']); },
  });
}

// ===== Parsing =====

export function useStartParsing() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (url: string) => {
      const { data } = await api.post<{ source: string; reviewsAdded: number; internalProductId?: string }>(
        '/api/parsing/start',
        { url },
      );
      return data;
    },
    onSuccess: data => { if (data.internalProductId) void invalidateProductData(qc, ownerId, data.internalProductId, ['reviews', 'stats', 'timeseries', 'products', 'profile'], false); void qc.invalidateQueries({ queryKey: ['parsing', 'history', ownerId] }); },
  });
}

// ===== Profile =====

export function useProfileStats() {
  return useQuery({
    queryKey: ['profile', useOwnerId(), 'stats'],
    queryFn: async () => {
      const { data } = await api.get<{ uploads: number; reports: number }>('/api/profile/stats');
      return data;
    },
  });
}

// ===== Product mutations =====

export function useRenameProduct() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data } = await api.patch(`/api/products/${id}`, { name });
      return data;
    },
    onSuccess: (_data, input) => { void invalidateProductData(qc, ownerId, input.id, ['products', 'reviews']); },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/products/${id}`);
    },
    onSuccess: (_data, id) => { if (useProductStore.getState().selectedProductId === id) useProductStore.getState().setSelectedProductId(null); void invalidateProductData(qc, ownerId, id, ['products', 'reviews', 'stats', 'timeseries', 'groupings', 'grouping-history', 'analysis-runs']); },
  });
}

// ===== Review delete mutations =====

export function useDeleteReview() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({ mutationFn: async (id: string) => {
    const productId = useProductStore.getState().selectedProductId;
    await api.delete(`/api/reviews/${id}`); return productId;
  }, onSuccess: productId => { void invalidateProductData(qc, ownerId, productId, ['reviews', 'stats', 'timeseries', 'products'], false); } });
}
export function useDeleteReviewsBulk() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({ mutationFn: async (productId?: string | null) => {
    const data = (await api.delete<{ deleted: number }>('/api/reviews', { params: productId ? { productId } : {} })).data;
    return { ...data, productId };
  }, onSuccess: data => { void invalidateProductData(qc, ownerId, data.productId, ['reviews', 'stats', 'timeseries', 'products'], false); } });
}

// ===== Issue detail (with reviews) =====

export function useIssueDetail(id: string | null) {
  return useQuery({
    queryKey: ['issues', useOwnerId(), 'detail', id],
    queryFn: async () => {
      const { data } = await api.get<IssueWithReviews>(`/api/issues/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ===== Toggle Issue resolved =====

export function useToggleResolved() {
  const qc = useQueryClient(); const ownerId = useOwnerId();
  return useMutation({ mutationFn: async (id: string) => (await api.patch<HiddenIssue>(`/api/issues/${id}/resolve`)).data,
    onSuccess: data => { void invalidateProductData(qc, ownerId, data.productId, ['issues']); } });
}

// ===== AI Summary =====

export function useAiSummary(productId?: string | null) {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.get<{ summary: string }>('/api/analysis/summary', {
        params: productId ? { productId } : {},
      });
      return data.summary;
    },
  });
}

// ===== Parsing history =====

export function useParsingHistory() {
  return useQuery({
    queryKey: ['parsing', 'history', useOwnerId()],
    queryFn: async () => {
      const { data } = await api.get<{ items: ParsingHistoryItem[] }>('/api/parsing/history');
      return data;
    },
  });
}
