import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { resolveCachedImageUrl } from '../../utils/imageCache';

interface CachedImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackIconClassName?: string;
}

export const CachedImage: React.FC<CachedImageProps> = ({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackIconClassName = 'w-5 h-5 text-slate-600',
}) => {
  const [resolvedSrc, setResolvedSrc] = useState<string>(src || '');
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!src) {
      setResolvedSrc('');
      return;
    }
    setResolvedSrc(src);
    resolveCachedImageUrl(src).then((cached) => {
      if (active && cached) {
        setResolvedSrc(cached);
        setFailed(false);
      }
    });
    return () => {
      active = false;
    };
  }, [src]);

  if (!resolvedSrc || failed) {
    return <Package className={fallbackIconClassName} />;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
};
