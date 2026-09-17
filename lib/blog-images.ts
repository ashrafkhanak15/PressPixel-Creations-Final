const RESPONSIVE_WIDTHS = [480, 768, 1200, 1600];

export function cloudinaryImageUrl(value: string, width: number) {
  if (!Number.isInteger(width) || width < 1) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') return value;
    const marker = '/image/upload/';
    const index = url.pathname.indexOf(marker);
    if (index === -1) return value;
    const before = url.pathname.slice(0, index + marker.length);
    const after = url.pathname.slice(index + marker.length);
    url.pathname = `${before}f_auto,q_auto,c_limit,w_${width}/${after}`;
    return url.toString();
  } catch {
    return value;
  }
}

export function cloudinaryImageSrcSet(value: string, sourceWidth: number) {
  if (cloudinaryImageUrl(value, Math.min(sourceWidth, 480)) === value) return '';
  const widths = RESPONSIVE_WIDTHS.filter((width) => width < sourceWidth);
  if (!widths.includes(sourceWidth)) widths.push(sourceWidth);
  return widths
    .filter((width) => width > 0)
    .map((width) => `${cloudinaryImageUrl(value, width)} ${width}w`)
    .join(', ');
}
