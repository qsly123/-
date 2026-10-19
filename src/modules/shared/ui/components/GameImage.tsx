"use client";

import Image, { type ImageProps } from "next/image";
import { useResolvedAssetUrl } from "@/modules/shared/ui/hooks/useResolvedAssetUrl";
import { shouldUseUnoptimizedImage } from "@/modules/shared/ui/utils/image";

type GameImageProps = Omit<ImageProps, "src"> & {
  src?: string | null;
};

export default function GameImage({ src, unoptimized, ...props }: GameImageProps) {
  const resolvedSrc = useResolvedAssetUrl(src);

  if (!resolvedSrc) {
    return null;
  }

  return (
    <Image
      {...props}
      alt={props.alt ?? ""}
      src={resolvedSrc}
      unoptimized={unoptimized ?? (shouldUseUnoptimizedImage(resolvedSrc) || shouldUseUnoptimizedImage(src))}
    />
  );
}
