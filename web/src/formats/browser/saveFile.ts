/**
 * Putting a file in front of the person: a name that a file system takes, and a link with a
 * `download` attribute that is clicked once. Nothing is uploaded and nothing waits on the server.
 * Documents (`download.ts`) and spreadsheets (`sheetsDownload.ts`) save the same way.
 */

/** A file name from a title: what a file system takes, nothing it does not. */
export function fileNameOf(title: string, extension: string): string {
  const base = title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[\s.]+/, '').slice(0, 120).trim();
  return `${base || 'Untitled'}.${extension}`;
}

export function save(bytes: Uint8Array, mime: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // After the browser has taken the link; revoking at once can cancel the save.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
