// Plain-language answers to "what is this update, and how risky is it?" built from
// the update entry's tag kind (server/utils/versions-core.ts). The digest check can
// only say "the image behind this tag changed"; what that means depends on the tag.

export type TagKind = 'exact' | 'line' | 'floating'
export type Bump = 'major' | 'minor' | 'patch'

export interface UpdateExplain {
  title: string
  detail: string
  /** low: a rebuild or a step within a line; check: unknown; caution: could be anything */
  tone: 'low' | 'check' | 'caution'
}

/** `5-alpine` → `5.x`, `1.25` → `1.25.x`, `v3.1` → `v3.1.x` */
export function lineOf(tag: string): { label: string; parts: number } | undefined {
  const m = /^(v)?(\d+(?:\.\d+)*)/i.exec(tag)
  if (!m) return undefined
  return { label: `${m[1] || ''}${m[2]}.x`, parts: m[2].split('.').length }
}

export function explainUpdate(image: string, tagKind: TagKind | undefined): UpdateExplain {
  const tag = imageTag(image)
  if (tagKind === 'exact') {
    return {
      title: `Same version (${tag}), rebuilt`,
      detail: `The publisher rebuilt ${tag}, usually to pick up security fixes in the base image. The app itself stays on ${tag}, so this is a low-risk update.`,
      tone: 'low',
    }
  }
  const line = tagKind === 'line' ? lineOf(tag) : undefined
  if (line) {
    return {
      title: `A newer ${line.label} release`,
      detail: `The tag ${tag} always points at the newest ${line.label} release, so this is ${line.parts === 1 ? 'a minor or patch' : 'a patch'} update: usually low risk. The changelog lists what changed.`,
      tone: 'low',
    }
  }
  if (tagKind === 'floating') {
    return {
      title: `New image for ${tag}`,
      detail: `${tag} follows whatever the publisher releases next, which can be a new major version with breaking changes. Check the changelog before updating, or pin a version so you know what you get.`,
      tone: 'caution',
    }
  }
  return {
    title: `New image for ${tag}`,
    detail: `The publisher pushed a new image under ${tag}. The changelog says what changed.`,
    tone: 'check',
  }
}

export const BUMP_LABEL: Record<Bump, string> = { major: 'major', minor: 'minor', patch: 'patch' }

export const MAJOR_NOTE =
  'A major version can rename settings or change how data is stored, and going back afterwards may not work. Read the changelog and back up the app’s data first.'
