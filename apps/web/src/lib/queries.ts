import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useProductStore } from '../store/product.store';

export const UNASSIGNED_PRODUCT_ID = '__unassigned__';

export interface Product {
  id: string;
  name: string;
  sourceUrl: string | null;
  source?: string | null;
  externalId?: string | null;
  reviewsCount: number;
  analyzedCount: number;
  avgRating: number | null;
  createdAt: string;
}

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
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
}) {
  return useQuery({
    queryKey: ['reviews', params],
    queryFn: async () => {
      const { data } = await api.get<ReviewsListResponse>('/api/reviews', { params });
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => (await api.post<{ id: string; name: string }>('/api/products', { name })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); },
  });
}

export function useUploadCsv() {
  const qc = useQueryClient();
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useCreateManualReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { text: string; rating?: number; productName?: string; productId?: string }) => {
      const { data } = await api.post<{ id: string; productId: string }>('/api/reviews/upload/text', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// ===== Analysis =====
export function useStats(productId?: string | null) {
  return useQuery({
    queryKey: ['stats', productId ?? null],
    queryFn: async () => {
      const { data } = await api.get<OverviewStats>('/api/analysis/stats', {
        params: productId ? { productId } : {},
      });
      return data;
    },
  });
}

export function useTimeseries(
  params: { bucket?: 'day' | 'week' | 'month'; days?: number; productId?: string | null } = {},
) {
  return useQuery({
    queryKey: ['timeseries', params],
    queryFn: async () => {
      const { data } = await api.get<{ buckets: TimeseriesBucket[] }>('/api/analysis/timeseries', {
        params: {
          bucket: params.bucket,
          days: params.days,
          ...(params.productId ? { productId: params.productId } : {}),
        },
      });
      return data;
    },
  });
}

export function useRunAnalysis() {
  return useMutation({
    mutationFn: async (limit?: number) => {
      const productId = useProductStore.getState().selectedProductId;
      const { data } = await api.post<{ jobId: string }>('/api/analysis/run', { limit, ...(productId ? { productId } : {}) });
      return data;
    },
  });
}

export function useCancelAnalysis() {
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data } = await api.post(`/api/analysis/${jobId}/cancel`);
      return data;
    },
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
    queryKey: ['issues', productId ?? null, page, pageSize],
    queryFn: async () => {
      const { data } = await api.get<HiddenIssuesResponse>('/api/issues', {
        params: { ...(productId ? { productId } : {}), page, pageSize },
      });
      return data;
    },
  });
}

export function useRecomputeIssues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (productId?: string | null) => {
      const { data } = await api.post<{
        clustersCreated: number;
        reviewsAssigned: number;
        noisePoints: number;
      }>('/api/issues/recompute', productId ? { productId } : {});
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

// ===== Reports =====

export function useReports() {
  return useQuery({
    queryKey: ['reports'],
    queryFn: async () => {
      const { data } = await api.get<{ items: ReportItem[] }>('/api/reports');
      return data;
    },
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { format: 'pdf' | 'docx'; title?: string }) => {
      const { data } = await api.post<{ id: string; downloadUrl: string }>(
        '/api/reports/generate',
        input,
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
}

// ===== Parsing =====

export function useStartParsing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => {
      const { data } = await api.post<{ source: string; reviewsAdded: number }>(
        '/api/parsing/start',
        { url },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['parsing', 'history'] });
    },
  });
}

// ===== Profile =====

export function useProfileStats() {
  return useQuery({
    queryKey: ['profile', 'stats'],
    queryFn: async () => {
      const { data } = await api.get<{ uploads: number; reports: number }>('/api/profile/stats');
      return data;
    },
  });
}

// ===== Product mutations =====

export function useRenameProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data } = await api.patch(`/api/products/${id}`, { name });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/products/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

// ===== Review delete mutations =====

export function useDeleteReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/reviews/${id}`);
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['reviews'] });
      const snapshots = qc.getQueriesData<ReviewsListResponse>({ queryKey: ['reviews'] });
      qc.setQueriesData<ReviewsListResponse>({ queryKey: ['reviews'] }, (old) =>
        old ? { ...old, items: old.items.filter((r) => r.id !== id), total: old.total - 1 } : old,
      );
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, val]) => qc.setQueryData(key, val));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useDeleteReviewsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (productId?: string | null) => {
      const { data } = await api.delete<{ deleted: number }>('/api/reviews', {
        params: productId ? { productId } : {},
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

// ===== Issue detail (with reviews) =====

export function useIssueDetail(id: string | null) {
  return useQuery({
    queryKey: ['issues', 'detail', id],
    queryFn: async () => {
      const { data } = await api.get<IssueWithReviews>(`/api/issues/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ===== Toggle Issue resolved =====

export function useToggleResolved() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch<HiddenIssue>(`/api/issues/${id}/resolve`);
      return data;
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['issues'] });
      const snapshots = qc.getQueriesData<HiddenIssuesResponse>({ queryKey: ['issues'] });
      qc.setQueriesData<HiddenIssuesResponse>({ queryKey: ['issues'] }, (old) =>
        old ? { ...old, items: old.items.map((i) => i.id === id ? { ...i, resolved: !i.resolved } : i) } : old,
      );
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, val]) => qc.setQueryData(key, val));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['issues'] }),
  });
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
    queryKey: ['parsing', 'history'],
    queryFn: async () => {
      const { data } = await api.get<{ items: ParsingHistoryItem[] }>('/api/parsing/history');
      return data;
    },
  });
}
