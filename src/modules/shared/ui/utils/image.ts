function normalizeImageUrl(value: string) {
  return value.trim().toLowerCase();
}

function isNativeManagedAssetUrl(value: string) {
  return (
    value.startsWith("http://localhost/_capacitor_file_")
    || value.startsWith("capacitor://localhost/_capacitor_file_")
    || value.startsWith("content://")
    || value.startsWith("file://")
  );
}

export function shouldUseUnoptimizedImage(src?: string | null) {
  if (!src) {
    return false;
  }

  const normalized = normalizeImageUrl(src);
  if (!normalized) {
    return false;
  }

  if (isNativeManagedAssetUrl(normalized)) {
    return true;
  }

  if (normalized.startsWith("/uploads/")) {
    return true;
  }

  return (
    normalized.endsWith(".gif")
    || normalized.endsWith(".webp")
    || normalized.endsWith(".apng")
    || normalized.endsWith(".avif")
  );
}
