/**
 * Promote classic-mode generated images from this browser into the shared
 * asset pool, then point the slide at the pooled asset.
 *
 * Classic generation used to keep generated image bytes only in this
 * browser's IndexedDB (`db.mediaFiles`) and leave the slide element's `src`
 * as its `gen_img_*` placeholder. Any other browser (a colleague, a learner,
 * a fresh device) then had nothing to load: the server answered 404 for the
 * placeholder, and a viewer without image generation saw "Generation disabled
 * in settings". The browser that generated the course silently re-bought the
 * image on every visit.
 *
 * Here the bytes go to the asset pool (server-backed under persistence, like
 * TTS audio) and the placeholder is rewritten to the allocated ref, so the
 * normal stage save carries the link to everyone.
 */
import { slideMediaReferenceSlots } from '@/lib/media/slide-media-slots';
import { isGeneratedMediaPlaceholder } from '@/lib/media/media-ref';
import { getAssetPool } from '@/lib/media/asset-pool';
import { useStageStore } from '@/lib/store/stage';
import { useAccessRoleStore } from '@/lib/store/access-role';
import { db, mediaFileKey } from '@/lib/utils/database';
import type { Scene } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import { createLogger } from '@/lib/logger';

const log = createLogger('PromoteGeneratedMedia');

/** Longest edge after compression. Slides render far below this. */
export const PROMOTED_IMAGE_MAX_EDGE = 1600;
/** WebP/JPEG quality used for promoted slide images. */
export const PROMOTED_IMAGE_QUALITY = 0.82;

type SlideLike = Parameters<typeof slideMediaReferenceSlots>[0];

function sceneSlides(scene: Scene): SlideLike[] {
  const slides: SlideLike[] = [];
  if (scene.content.type === 'slide') slides.push(scene.content.canvas);
  for (const slide of scene.whiteboards ?? []) slides.push(slide);
  return slides;
}

/** Whether any image slot of the scene still names `placeholder`. */
export function sceneReferencesPlaceholder(scene: Scene, placeholder: string): boolean {
  for (const slide of sceneSlides(scene)) {
    for (const slot of slideMediaReferenceSlots(slide)) {
      if (slot.read() === placeholder) return true;
    }
  }
  return false;
}

/**
 * Pure rewrite: returns copies of the scenes in which every slot naming
 * `placeholder` now names `assetRef`. Scenes without the placeholder are
 * returned untouched (same object) and not listed in `changedSceneIds`.
 */
export function replacePlaceholderInScenes(
  scenes: readonly Scene[],
  placeholder: string,
  assetRef: string,
): { scenes: Scene[]; changedSceneIds: string[] } {
  const changedSceneIds: string[] = [];
  const next = scenes.map((scene) => {
    if (!sceneReferencesPlaceholder(scene, placeholder)) return scene;
    const copy = structuredClone(scene);
    for (const slide of sceneSlides(copy)) {
      for (const slot of slideMediaReferenceSlots(slide)) {
        if (slot.read() === placeholder) slot.write(assetRef);
      }
    }
    changedSceneIds.push(scene.id);
    return copy;
  });
  return { scenes: next, changedSceneIds };
}

/** All `gen_img_*` placeholders the document still references. */
export function collectImagePlaceholders(scenes: readonly Scene[]): Set<string> {
  const refs = new Set<string>();
  for (const scene of scenes) {
    for (const slide of sceneSlides(scene)) {
      for (const slot of slideMediaReferenceSlots(slide)) {
        const ref = slot.read();
        if (ref && isGeneratedMediaPlaceholder(ref) && /^gen_img_/i.test(ref)) refs.add(ref);
      }
    }
  }
  return refs;
}

/**
 * True when the outline's slide already exists and no longer names this
 * placeholder, i.e. its image is already linked to a pooled asset and must
 * not be generated (and paid for) again. While the slide has not been
 * generated yet the answer is false, so first-time generation is unaffected.
 */
export function isPlaceholderAlreadyLinked(
  scenes: readonly Scene[],
  outline: Pick<SceneOutline, 'order'>,
  placeholder: string,
): boolean {
  const scene = scenes.find((candidate) => candidate.order === outline.order);
  if (!scene) return false;
  if (scene.content.type !== 'slide') return false;
  return !sceneReferencesPlaceholder(scene, placeholder);
}

/** Learners never write course documents; only editors promote. */
function mayWriteDocument(): boolean {
  return useAccessRoleStore.getState().role !== 'learner';
}

/**
 * Shrink a generated image before upload. Falls back to the original bytes
 * whenever the browser cannot decode/encode, or the result would not be
 * smaller.
 */
export async function compressImageBlob(blob: Blob): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return blob;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, PROMOTED_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return blob;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, PROMOTED_IMAGE_QUALITY));
    let out = await encode('image/webp');
    if (!out || out.type !== 'image/webp') out = await encode('image/jpeg');
    if (!out || out.size === 0 || out.size >= blob.size) return blob;
    return out;
  } catch (error) {
    log.warn('Image compression skipped:', error);
    return blob;
  }
}

// Allocations whose slide had not materialized yet when the bytes landed
// (images can finish before their scene). Applied on the next scene change.
const pendingLinks = new Map<string, { stageId: string; placeholder: string; assetRef: string }>();
let unsubscribePending: (() => void) | undefined;

function applyLink(stageId: string, placeholder: string, assetRef: string): boolean {
  const state = useStageStore.getState();
  if (state.stage?.id !== stageId) return false;
  const { scenes, changedSceneIds } = replacePlaceholderInScenes(
    state.scenes,
    placeholder,
    assetRef,
  );
  if (changedSceneIds.length === 0) return false;
  for (const sceneId of changedSceneIds) {
    const scene = scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) continue;
    state.updateScene(sceneId, { content: scene.content, whiteboards: scene.whiteboards });
  }
  log.info(`Linked ${placeholder} → ${assetRef} in ${changedSceneIds.length} scene(s)`);
  return true;
}

function flushPendingLinks(): void {
  for (const [key, link] of pendingLinks) {
    if (applyLink(link.stageId, link.placeholder, link.assetRef)) pendingLinks.delete(key);
  }
  if (pendingLinks.size === 0 && unsubscribePending) {
    unsubscribePending();
    unsubscribePending = undefined;
  }
}

function deferLink(stageId: string, placeholder: string, assetRef: string): void {
  pendingLinks.set(`${stageId}:${placeholder}`, { stageId, placeholder, assetRef });
  unsubscribePending ??= useStageStore.subscribe((state, previous) => {
    if (state.scenes !== previous.scenes) flushPendingLinks();
  });
}

/**
 * Upload one generated image (once) and link it into the open document.
 * Never throws: a failed promotion leaves the old browser-local behaviour.
 */
export async function promoteGeneratedImage(
  stageId: string,
  placeholder: string,
  blob: Blob,
): Promise<string | undefined> {
  if (!mayWriteDocument() || blob.size === 0) return undefined;
  try {
    const key = mediaFileKey(stageId, placeholder);
    const record = await db.mediaFiles.get(key);
    let assetRef = record?.assetRef;
    if (!assetRef) {
      const compressed = await compressImageBlob(blob);
      assetRef = String(
        await getAssetPool().put(compressed, { contentType: compressed.type || 'image/png' }),
      );
      if (record) {
        await db.mediaFiles.update(key, { assetRef }).catch(() => {});
      }
    }
    if (!applyLink(stageId, placeholder, assetRef)) deferLink(stageId, placeholder, assetRef);
    return assetRef;
  } catch (error) {
    log.warn(`Could not promote ${placeholder}:`, error);
    return undefined;
  }
}

/**
 * One-time repair for courses generated before promotion existed: upload
 * every image this browser still holds for a placeholder the document still
 * references. Runs serially; safe to call on every classroom open.
 */
export async function promoteLocalGeneratedImages(stageId: string): Promise<number> {
  if (!mayWriteDocument()) return 0;
  const state = useStageStore.getState();
  if (state.stage?.id !== stageId) return 0;
  const placeholders = collectImagePlaceholders(state.scenes);
  if (placeholders.size === 0) return 0;
  let promoted = 0;
  for (const placeholder of placeholders) {
    const record = await db.mediaFiles
      .get(mediaFileKey(stageId, placeholder))
      .catch(() => undefined);
    if (!record || record.error || !record.blob || record.blob.size === 0) continue;
    if (await promoteGeneratedImage(stageId, placeholder, record.blob)) promoted += 1;
  }
  if (promoted > 0) log.info(`Promoted ${promoted} local image(s) for ${stageId}`);
  return promoted;
}
