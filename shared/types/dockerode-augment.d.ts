// @types/dockerode lags behind Docker and dockerode. Docker's volume inspect
// returns CreatedAt, and image inspect accepts the { abortSignal } options that
// homeport's oneShot() timeouts pass. dockerode's types use `export =`, so these
// merge into its namespace at the top level of the augmentation. (Methods of the
// client class itself can't be extended this way: see the helpers in docker.ts.)
import 'dockerode'

declare module 'dockerode' {
  interface VolumeInspectInfo {
    CreatedAt?: string
  }
  interface ImageInspectOptions {
    abortSignal?: AbortSignal
  }
}
