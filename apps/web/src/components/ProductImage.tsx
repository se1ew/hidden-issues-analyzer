import { Package } from 'lucide-react';
import { useState } from 'react';

export function ProductImage({ url, name }: { url?: string | null; name: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className="h-20 w-16 rounded-xl bg-primary-100 flex items-center justify-center shrink-0 overflow-hidden">
    {url && failedUrl !== url
      ? <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain"
        onError={() => setFailedUrl(url)} />
      : <Package className="h-6 w-6 text-primary-700" aria-label="Фото недоступно" />}
  </div>;
}
