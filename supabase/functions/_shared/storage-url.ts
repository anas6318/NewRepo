/**
 * Supabase Storage public-URL handling.
 *
 * WHY THIS EXISTS. A product's Real Product image was saved as
 *
 *     …/object/public/product-images/ac-milan-06-07-away-retro-front.png
 *
 * while the object actually in the bucket is
 *
 *     product-images(white background_/ac-milan-06-07-away-retro-front.png
 *
 * — the URL had been assembled by hand from the file name alone, and the
 * FOLDER SEGMENT was dropped. Storage returned 404, the photograph never
 * loaded, and the customer was left on the styled render with "the product
 * photo could not be loaded".
 *
 * An object path in Storage is a full key, not a file name: every segment
 * counts, and segments routinely contain spaces and parentheses that must be
 * percent-encoded. Building the URL here, from the bucket and the complete
 * object path, removes the step where a human flattens it.
 *
 * Runtime: no Deno access, so the unit tests exercise this exact module.
 */

const PUBLIC_MARKER = "/storage/v1/object/public/";

/**
 * Percent-encodes an object path WITHOUT destroying its folder structure.
 *
 * `encodeURIComponent` on the whole path would turn every "/" into "%2F" and
 * address a single oddly-named object instead of a nested one, so each
 * segment is encoded on its own and the separators are put back.
 */
export function encodeStorageObjectPath(objectPath: string): string {
  return objectPath
    .split("/")
    .filter((segment, i, all) => segment !== "" || i === all.length - 1)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Reverses {@link encodeStorageObjectPath}. */
export function decodeStorageObjectPath(encoded: string): string {
  return encoded
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

/**
 * The public URL for one object. `objectPath` is the COMPLETE key inside the
 * bucket, nested folders included — exactly what the Storage browser shows in
 * its breadcrumb, not just the file name.
 */
export function storagePublicUrl(supabaseUrl: string, bucket: string, objectPath: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  const key = objectPath.replace(/^\/+/, "");
  if (!bucket.trim() || !key) return "";
  return `${base}${PUBLIC_MARKER}${encodeURIComponent(bucket.trim())}/${encodeStorageObjectPath(key)}`;
}

export interface ParsedStorageUrl {
  bucket: string;
  /** Decoded, with folder structure intact. */
  objectPath: string;
  /** How many folder levels precede the file name. */
  depth: number;
}

/** Pulls the bucket and object path back out of a public URL, or undefined. */
export function parseStoragePublicUrl(url: string): ParsedStorageUrl | undefined {
  const at = url.indexOf(PUBLIC_MARKER);
  if (at === -1) return undefined;
  const rest = url.slice(at + PUBLIC_MARKER.length).split(/[?#]/)[0] ?? "";
  const [rawBucket, ...rawKey] = rest.split("/");
  if (!rawBucket || rawKey.length === 0) return undefined;
  const objectPath = decodeStorageObjectPath(rawKey.join("/"));
  if (!objectPath) return undefined;
  return { bucket: decodeURIComponent(rawBucket), objectPath, depth: rawKey.length - 1 };
}

export type StorageUrlProblem = "missing_object_path" | "unencoded_space" | "flattened_path";

/**
 * Static problems detectable in a Storage URL. Deliberately conservative: it
 * cannot know which objects exist, so it only reports what is wrong on the
 * face of the URL. Whether the object is really there is answered by actually
 * requesting it — see `probeImage` in src/lib/image-probe.ts, which is what
 * Admin runs before saving.
 */
export function storageUrlProblem(url: string): StorageUrlProblem | undefined {
  const at = url.indexOf(PUBLIC_MARKER);
  if (at === -1) return undefined; // not a Storage URL; other rules apply
  // A bucket with nothing after it never addresses an object. Checked before
  // parsing, because parse deliberately refuses to return an empty key.
  const rest = (url.slice(at + PUBLIC_MARKER.length).split(/[?#]/)[0] ?? "").replace(/^\/+/, "");
  const slash = rest.indexOf("/");
  if (slash === -1 || rest.slice(slash + 1).trim() === "") return "missing_object_path";
  const parsed = parseStoragePublicUrl(url);
  if (!parsed) return "missing_object_path";
  if (parsed.objectPath.endsWith("/")) return "missing_object_path";
  // A literal space survives in a hand-pasted URL and breaks some clients.
  const raw = url.slice(url.indexOf(PUBLIC_MARKER));
  if (/\s/.test(raw)) return "unencoded_space";
  return undefined;
}

/** Operator-facing English, for the Admin product editor. */
export function storageUrlProblemMessage(problem: StorageUrlProblem): string {
  switch (problem) {
    case "missing_object_path":
      return "This Storage URL has a bucket but no object path. Copy the object's FULL path from the Storage browser, including every folder.";
    case "unencoded_space":
      return "This Storage URL contains a literal space. Folder or file names with spaces must be percent-encoded (a space becomes %20).";
    case "flattened_path":
      return "This Storage URL looks like it was built from the file name alone. Include every folder in the object's path.";
  }
}
