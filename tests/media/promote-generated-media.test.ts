import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: {
    stage: { id: string } | null;
    scenes: unknown[];
    updateScene: ReturnType<typeof vi.fn>;
  } = { stage: null, scenes: [], updateScene: vi.fn() };
  return {
    state,
    role: { value: 'admin' as string | null },
    put: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    listeners: [] as Array<(next: unknown, prev: unknown) => void>,
  };
});

vi.mock('@/lib/store/stage', () => ({
  useStageStore: {
    getState: () => mocks.state,
    subscribe: (listener: (next: unknown, prev: unknown) => void) => {
      mocks.listeners.push(listener);
      return () => {
        mocks.listeners.splice(mocks.listeners.indexOf(listener), 1);
      };
    },
  },
}));
vi.mock('@/lib/store/access-role', () => ({
  useAccessRoleStore: { getState: () => ({ role: mocks.role.value }) },
}));
vi.mock('@/lib/media/asset-pool', () => ({ getAssetPool: () => ({ put: mocks.put }) }));
vi.mock('@/lib/utils/database', () => ({
  mediaFileKey: (stageId: string, ref: string) => `${stageId}:${ref}`,
  db: { mediaFiles: { get: mocks.get, update: mocks.update } },
}));

import {
  collectImagePlaceholders,
  isPlaceholderAlreadyLinked,
  promoteGeneratedImage,
  promoteLocalGeneratedImages,
  replacePlaceholderInScenes,
} from '@/lib/media/promote-generated-media';
import type { Scene } from '@/lib/types/stage';

function slideScene(id: string, order: number, srcs: string[], whiteboardSrc?: string): Scene {
  return {
    id,
    stageId: 'stage-1',
    order,
    title: id,
    type: 'slide',
    content: {
      type: 'slide',
      canvas: {
        id: `${id}-canvas`,
        elements: srcs.map((src, index) => ({ id: `${id}-img-${index}`, type: 'image', src })),
      },
    },
    ...(whiteboardSrc
      ? {
          whiteboards: [
            { id: `${id}-wb`, elements: [{ id: 'wb-img', type: 'image', src: whiteboardSrc }] },
          ],
        }
      : {}),
  } as unknown as Scene;
}

function canvasSrcs(scene: Scene): string[] {
  if (scene.content.type !== 'slide') return [];
  return (scene.content.canvas.elements as Array<{ src?: string }>).map((e) => e.src ?? '');
}

beforeEach(() => {
  mocks.state.stage = { id: 'stage-1' };
  mocks.state.scenes = [];
  mocks.state.updateScene = vi.fn();
  mocks.role.value = 'admin';
  mocks.put.mockReset().mockResolvedValue('asset_abc');
  mocks.get.mockReset().mockResolvedValue(undefined);
  mocks.update.mockReset().mockResolvedValue(1);
  mocks.listeners.length = 0;
});

describe('replacePlaceholderInScenes', () => {
  it('rewrites every slot naming the placeholder, including whiteboards, without mutating input', () => {
    const scene = slideScene('s1', 1, ['gen_img_a', 'https://x/y.png'], 'gen_img_a');
    const { scenes, changedSceneIds } = replacePlaceholderInScenes([scene], 'gen_img_a', 'asset_1');
    expect(changedSceneIds).toEqual(['s1']);
    expect(canvasSrcs(scenes[0])).toEqual(['asset_1', 'https://x/y.png']);
    expect((scenes[0].whiteboards?.[0].elements[0] as unknown as { src: string }).src).toBe(
      'asset_1',
    );
    expect(canvasSrcs(scene)).toEqual(['gen_img_a', 'https://x/y.png']);
  });

  it('leaves unrelated scenes as the same object', () => {
    const other = slideScene('s2', 2, ['gen_img_b']);
    const { scenes, changedSceneIds } = replacePlaceholderInScenes([other], 'gen_img_a', 'asset_1');
    expect(changedSceneIds).toEqual([]);
    expect(scenes[0]).toBe(other);
  });
});

describe('collectImagePlaceholders', () => {
  it('lists only gen_img placeholders still in the document', () => {
    const scenes = [
      slideScene('s1', 1, ['gen_img_a', 'asset_9']),
      slideScene('s2', 2, ['gen_img_b', 'gen_vid_c', 'https://x/z.png']),
    ];
    expect([...collectImagePlaceholders(scenes)].sort()).toEqual(['gen_img_a', 'gen_img_b']);
  });
});

describe('isPlaceholderAlreadyLinked', () => {
  const scenes = [slideScene('s1', 1, ['asset_9']), slideScene('s2', 2, ['gen_img_b'])];
  it('is true when the slide exists and no longer names the placeholder', () => {
    expect(isPlaceholderAlreadyLinked(scenes, { order: 1 }, 'gen_img_a')).toBe(true);
  });
  it('is false while the placeholder is still on the slide', () => {
    expect(isPlaceholderAlreadyLinked(scenes, { order: 2 }, 'gen_img_b')).toBe(false);
  });
  it('is false before the slide has been generated', () => {
    expect(isPlaceholderAlreadyLinked(scenes, { order: 3 }, 'gen_img_c')).toBe(false);
  });
});

describe('promoteGeneratedImage', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

  it('uploads once and links the slide through updateScene', async () => {
    mocks.state.scenes = [slideScene('s1', 1, ['gen_img_a'])];
    mocks.get.mockResolvedValue({ id: 'stage-1:gen_img_a', blob });
    const ref = await promoteGeneratedImage('stage-1', 'gen_img_a', blob);
    expect(ref).toBe('asset_abc');
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith('stage-1:gen_img_a', { assetRef: 'asset_abc' });
    expect(mocks.state.updateScene).toHaveBeenCalledTimes(1);
    const [sceneId, patch] = mocks.state.updateScene.mock.calls[0];
    expect(sceneId).toBe('s1');
    expect(canvasSrcs({ content: patch.content } as Scene)).toEqual(['asset_abc']);
  });

  it('reuses a previously uploaded asset instead of uploading again', async () => {
    mocks.state.scenes = [slideScene('s1', 1, ['gen_img_a'])];
    mocks.get.mockResolvedValue({ id: 'stage-1:gen_img_a', blob, assetRef: 'asset_old' });
    const ref = await promoteGeneratedImage('stage-1', 'gen_img_a', blob);
    expect(ref).toBe('asset_old');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('defers the link until the slide appears', async () => {
    mocks.state.scenes = [];
    await promoteGeneratedImage('stage-1', 'gen_img_a', blob);
    expect(mocks.state.updateScene).not.toHaveBeenCalled();
    expect(mocks.listeners).toHaveLength(1);
    const previous = { scenes: mocks.state.scenes };
    mocks.state.scenes = [slideScene('s1', 1, ['gen_img_a'])];
    mocks.listeners[0](mocks.state, previous);
    expect(mocks.state.updateScene).toHaveBeenCalledTimes(1);
    expect(mocks.listeners).toHaveLength(0);
  });

  it('does nothing for learners', async () => {
    mocks.role.value = 'learner';
    mocks.state.scenes = [slideScene('s1', 1, ['gen_img_a'])];
    expect(await promoteGeneratedImage('stage-1', 'gen_img_a', blob)).toBeUndefined();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('never throws when the upload fails', async () => {
    mocks.state.scenes = [slideScene('s1', 1, ['gen_img_a'])];
    mocks.put.mockRejectedValue(new Error('offline'));
    expect(await promoteGeneratedImage('stage-1', 'gen_img_a', blob)).toBeUndefined();
    expect(mocks.state.updateScene).not.toHaveBeenCalled();
  });
});

describe('promoteLocalGeneratedImages', () => {
  it('promotes local blobs for placeholders the document still references', async () => {
    const blob = new Blob([new Uint8Array([9])], { type: 'image/png' });
    mocks.state.scenes = [slideScene('s1', 1, ['gen_img_a', 'gen_img_missing'])];
    mocks.get.mockImplementation(async (key: string) =>
      key === 'stage-1:gen_img_a' ? { id: key, blob } : undefined,
    );
    expect(await promoteLocalGeneratedImages('stage-1')).toBe(1);
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });

  it('skips failed records and other stages', async () => {
    mocks.state.scenes = [slideScene('s1', 1, ['gen_img_a'])];
    mocks.get.mockResolvedValue({ id: 'x', blob: new Blob([]), error: 'failed' });
    expect(await promoteLocalGeneratedImages('stage-1')).toBe(0);
    expect(await promoteLocalGeneratedImages('other-stage')).toBe(0);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
