import { api } from './api';
export async function downloadFile(url: string, filename: string, params?: object) {
  const response = await api.get<Blob>(url, { responseType: 'blob', params });
  const blobUrl = URL.createObjectURL(response.data);
  const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
